const { Router } = require('express');
const crypto = require('crypto');
const log = require('../logger');
const db = require('../db');
const { getSnaptrade } = require('../services/snaptradeClient');
const { performSync } = require('../services/syncService');

const router = Router();
const keyLog = log.make('snaptrade-keys');

const MAX_KEY_INDEX = 10;

// GET /api/snaptrade-keys — only returns keys that are actually configured
router.get('/', (req, res) => {
  const keys = [];
  const countStmt = db.db.prepare('SELECT COUNT(*) as count FROM connections WHERE key_index = ?');

  for (let i = 1; i <= MAX_KEY_INDEX; i++) {
    const clientId = db.getSetting(`SNAPTRADE_CLIENT_ID_${i}`) || (i === 1 ? db.getSetting('SNAPTRADE_CLIENT_ID') : null);
    if (!clientId) continue;

    const consumerKey = db.getSetting(`SNAPTRADE_CONSUMER_KEY_${i}`) || (i === 1 ? db.getSetting('SNAPTRADE_CONSUMER_KEY') : null);
    const userId = db.getSetting(`SNAPTRADE_USER_ID_${i}`) || (i === 1 ? db.getSetting('SNAPTRADE_USER_ID') : null);
    const userSecret = db.getSetting(`SNAPTRADE_USER_SECRET_${i}`) || (i === 1 ? db.getSetting('SNAPTRADE_USER_SECRET') : null);

    keys.push({
      keyIndex: i,
      clientId,
      name: db.getSetting(`SNAPTRADE_KEY_NAME_${i}`) || `Key ${i}`,
      registered: !!(userId && userSecret),
      isConfigured: !!(clientId && consumerKey),
      connectionCount: countStmt.get(i).count
    });
  }

  res.json(keys);
});

// DELETE /api/snaptrade-keys/:keyIndex
router.delete('/:keyIndex', (req, res) => {
  const keyIndex = parseInt(req.params.keyIndex);
  if (isNaN(keyIndex) || keyIndex < 1 || keyIndex > MAX_KEY_INDEX) {
    return res.status(400).json({ error: 'Invalid key index' });
  }

  const confirmDelete = req.headers['x-confirm-delete'] === 'true';
  if (!confirmDelete) {
    return res.status(400).json({ error: 'Deletion must be confirmed with X-Confirm-Delete header' });
  }

  try {
    const connections = db.db.prepare('SELECT id FROM connections WHERE key_index = ?').all(keyIndex);
    for (const conn of connections) {
      db.db.prepare('DELETE FROM connections WHERE id = ?').run(conn.id);
      db.db.prepare('DELETE FROM brokerage_accounts WHERE connection_id = ?').run(conn.id);
    }

    if (keyIndex === 1) {
      db.db.prepare("DELETE FROM settings WHERE key IN ('SNAPTRADE_USER_ID', 'SNAPTRADE_USER_SECRET', 'SNAPTRADE_USER_ID_1', 'SNAPTRADE_USER_SECRET_1')").run();
    } else {
      db.db.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(`SNAPTRADE_USER_ID_${keyIndex}`, `SNAPTRADE_USER_SECRET_${keyIndex}`);
    }

    keyLog.info('SnapTrade key deleted', { keyIndex, connectionsDeleted: connections.length });
    res.json({ success: true, connectionsDeleted: connections.length });
  } catch (err) {
    keyLog.error('Failed to delete SnapTrade key', { keyIndex, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/snaptrade-keys/:keyIndex — rename a key
router.patch('/:keyIndex', (req, res) => {
  const keyIndex = parseInt(req.params.keyIndex);
  const { name } = req.body;

  if (isNaN(keyIndex) || keyIndex < 1 || keyIndex > MAX_KEY_INDEX) {
    return res.status(400).json({ error: 'Invalid key index' });
  }
  if (name === undefined) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    db.setSetting(`SNAPTRADE_KEY_NAME_${keyIndex}`, name);
    keyLog.info('SnapTrade key name updated', { keyIndex, name });
    res.json({ success: true, name });
  } catch (err) {
    keyLog.error('Failed to update SnapTrade key name', { keyIndex, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/snaptrade-keys/:keyIndex
// Flow:
//   1. Validate inputs
//   2. Save clientId + consumerKey to DB
//   3. List existing SnapTrade users for this clientId
//   4a. If DB already has a userId that appears in the list → reuse it (preserved DB)
//   4b. Otherwise → register a fresh user
//   5. Trigger background sync (picks up any existing brokerage connections)
router.post('/:keyIndex', async (req, res) => {
  const keyIndex = parseInt(req.params.keyIndex);
  const { clientId, consumerKey, name } = req.body;

  if (isNaN(keyIndex) || keyIndex < 1 || keyIndex > MAX_KEY_INDEX) {
    return res.status(400).json({ error: 'Invalid key index' });
  }
  if (!clientId || !consumerKey) {
    return res.status(400).json({ error: 'Client ID and Consumer Key are both required' });
  }

  const keySuffix     = keyIndex === 1 ? '' : `_${keyIndex}`;
  const userIdKey     = `SNAPTRADE_USER_ID${keySuffix}`;
  const userSecretKey = `SNAPTRADE_USER_SECRET${keySuffix}`;

  // Step 1: save credentials so getSnaptrade() can build the signed client
  try {
    db.setSetting(`SNAPTRADE_CLIENT_ID${keySuffix}`, clientId);
    db.setSetting(`SNAPTRADE_CONSUMER_KEY${keySuffix}`, consumerKey);
    if (name) db.setSetting(`SNAPTRADE_KEY_NAME${keySuffix}`, name);
    keyLog.info('[key-save] Step 1: credentials saved to DB', { keyIndex });
  } catch (dbErr) {
    keyLog.error('[key-save] Step 1 failed: DB write error', { keyIndex, error: dbErr.message });
    return res.status(500).json({ error: 'Failed to save credentials to database', detail: dbErr.message });
  }

  const snap = getSnaptrade(keyIndex);

  // Step 2: list users already registered under this clientId on SnapTrade
  let registeredUsers = [];
  try {
    const listRes = await snap.authentication.listSnapTradeUsers();
    registeredUsers = listRes.data || [];
    keyLog.info('[key-save] Step 2: SnapTrade user list', { keyIndex, count: registeredUsers.length, users: registeredUsers });
  } catch (listErr) {
    const status = listErr.response?.status;
    const detail = listErr.response?.data || listErr.message;
    keyLog.warn('[key-save] Step 2: could not list SnapTrade users', { keyIndex, status, detail });

    if (status === 401 || status === 403) {
      return res.status(401).json({
        error: 'SnapTrade authentication failed — verify your Client ID and Consumer Key',
        detail
      });
    }
    // Non-auth failure (network, etc.) — continue and attempt registration anyway
  }

  // Step 3: determine userId / userSecret to use
  let userId     = db.getSetting(userIdKey);
  let userSecret = db.getSetting(userSecretKey);
  let action     = '';

  if (userId && userSecret && registeredUsers.includes(userId)) {
    // DB preserved from a previous run — our user still exists on SnapTrade
    action = 'reused';
    keyLog.info('[key-save] Step 3: reusing existing user', { keyIndex, userId });
  } else {
    // Need to register fresh
    if (userId && !registeredUsers.includes(userId)) {
      keyLog.warn('[key-save] Step 3: stored userId not found in SnapTrade — registering fresh', { keyIndex, storedUserId: userId });
    } else if (registeredUsers.length > 0 && !userId) {
      keyLog.warn('[key-save] Step 3: SnapTrade has existing users but no local credentials. ' +
        'Secrets cannot be recovered via API — registering a new user. ' +
        'Existing brokerage connections (if any) will need to be relinked via OAuth.',
        { keyIndex, existingUsers: registeredUsers });
    }

    userId = `cf-k${keyIndex}-${crypto.randomUUID().split('-')[0]}`;
    keyLog.info('[key-save] Step 4: registering new SnapTrade user', { keyIndex, userId });

    try {
      const regRes = await snap.authentication.registerSnapTradeUser({ userId });
      userSecret = regRes.data?.userSecret;
      if (!userSecret) {
        keyLog.error('[key-save] Step 4: registration returned no userSecret', { keyIndex, data: regRes.data });
        return res.status(500).json({ error: 'SnapTrade registration succeeded but returned no userSecret', detail: regRes.data });
      }
      db.setSetting(userIdKey, userId);
      db.setSetting(userSecretKey, userSecret);
      action = registeredUsers.length > 0 ? 'registered_fresh_existing_found' : 'registered_fresh';
      keyLog.info('[key-save] Step 4: user registered and stored', { keyIndex, userId, action });
    } catch (regErr) {
      const detail = regErr.response?.data || regErr.message;
      keyLog.error('[key-save] Step 4: registration failed', {
        keyIndex, error: regErr.message, status: regErr.response?.status, detail
      });
      return res.status(500).json({ error: 'SnapTrade user registration failed', detail });
    }
  }

  // Step 5: background sync — fetches brokerage connections + accounts
  keyLog.info('[key-save] Step 5: triggering background sync', { keyIndex, userId, action });
  performSync().catch(err =>
    keyLog.error('[key-save] Step 5: background sync failed', { keyIndex, error: err.message })
  );

  const messages = {
    reused:                        'Key saved. Existing user confirmed — syncing connections.',
    registered_fresh:              'Key saved. New user registered — use Connect Brokerage to link your accounts.',
    registered_fresh_existing_found: 'Key saved. New user registered (prior users found but secrets unrecoverable) — use Connect Brokerage to relink accounts.'
  };

  res.json({ success: true, keyIndex, userId, action, message: messages[action] || 'Key saved.' });
});

module.exports = router;

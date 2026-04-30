const { Router } = require('express');
const crypto = require('crypto');
const log = require('../logger');
const db = require('../db');
const configManager = require('../configManager');
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
    const isPersonal = clientId.startsWith('PERS-');

    keys.push({
      keyIndex: i,
      clientId,
      name: db.getSetting(`SNAPTRADE_KEY_NAME_${i}`) || `Key ${i}`,
      registered: !!(userId && userSecret),
      isPersonal,
      isConfigured: !!(clientId && (isPersonal || consumerKey)),
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
    // 1. Delete associated connections and their accounts
    const connections = db.db.prepare('SELECT id FROM connections WHERE key_index = ?').all(keyIndex);
    for (const conn of connections) {
      db.db.prepare('DELETE FROM connections WHERE id = ?').run(conn.id);
      db.db.prepare('DELETE FROM brokerage_accounts WHERE connection_id = ?').run(conn.id);
    }

    // 2. Clear user credentials for this key
    if (keyIndex === 1) {
      db.db.prepare("DELETE FROM settings WHERE key IN ('SNAPTRADE_USER_ID', 'SNAPTRADE_USER_SECRET', 'SNAPTRADE_USER_ID_1', 'SNAPTRADE_USER_SECRET_1')").run();
    } else {
      db.db.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(`SNAPTRADE_USER_ID_${keyIndex}`, `SNAPTRADE_USER_SECRET_${keyIndex}`);
    }

    keyLog.info('SnapTrade key and associated data removed', { keyIndex, connectionsDeleted: connections.length });
    res.json({ success: true, connectionsDeleted: connections.length });
  } catch (err) {
    keyLog.error('Failed to delete SnapTrade key', { keyIndex, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/snaptrade-keys/:keyIndex
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
// Saves credentials, probes SnapTrade for an existing registered user,
// reuses local creds if valid, registers fresh otherwise, then syncs.
router.post('/:keyIndex', async (req, res) => {
  const keyIndex = parseInt(req.params.keyIndex);
  const { clientId, consumerKey, name } = req.body;

  if (isNaN(keyIndex) || keyIndex < 1 || keyIndex > MAX_KEY_INDEX) {
    return res.status(400).json({ error: 'Invalid key index' });
  }
  if (!clientId) {
    return res.status(400).json({ error: 'Client ID is required' });
  }
  const isPersonal = clientId.startsWith('PERS-');
  if (!isPersonal && !consumerKey) {
    return res.status(400).json({ error: 'Consumer Key is required for non-personal keys' });
  }

  const keySuffix    = keyIndex === 1 ? '' : `_${keyIndex}`;
  const userIdKey    = `SNAPTRADE_USER_ID${keySuffix}`;
  const userSecretKey = `SNAPTRADE_USER_SECRET${keySuffix}`;

  keyLog.info('Saving SnapTrade key', { keyIndex, isPersonal, hasConsumerKey: !!consumerKey });

  try {
    // 1. Persist credentials so getSnaptrade(keyIndex) can build the client
    db.setSetting(`SNAPTRADE_CLIENT_ID${keySuffix}`, clientId);
    if (consumerKey) db.setSetting(`SNAPTRADE_CONSUMER_KEY${keySuffix}`, consumerKey);
    if (name)        db.setSetting(`SNAPTRADE_KEY_NAME${keySuffix}`, name);
    keyLog.info('Credentials written to DB', { keyIndex });

    const snapClient = getSnaptrade(keyIndex);

    // 2. Load any userId/userSecret we already have locally
    let userId     = db.getSetting(userIdKey);
    let userSecret = db.getSetting(userSecretKey);
    let userSource = 'existing_local';

    // 3. Probe SnapTrade for users registered under this clientId
    let snapUsers = [];
    try {
      const listRes = await snapClient.authentication.listSnapTradeUsers();
      snapUsers = listRes.data || [];
      keyLog.info('SnapTrade user list fetched', { keyIndex, count: snapUsers.length, users: snapUsers });
    } catch (listErr) {
      keyLog.warn('Could not list SnapTrade users (will register new)', { keyIndex, error: listErr.message });
    }

    // 4. Decide whether to reuse local credentials or register fresh
    if (userId && userSecret) {
      if (snapUsers.includes(userId)) {
        // Local creds confirmed valid on SnapTrade — nothing to do
        keyLog.info('Local userId confirmed in SnapTrade — reusing', { keyIndex, userId });
      } else {
        // Our stored userId no longer exists on SnapTrade (deleted externally, wrong key, etc.)
        keyLog.warn('Local userId not found in SnapTrade user list — credentials stale, will register new', { keyIndex, storedUserId: userId });
        userId = null;
        userSecret = null;
      }
    }

    if (!userId || !userSecret) {
      if (snapUsers.length > 0) {
        keyLog.warn(
          `SnapTrade has ${snapUsers.length} existing user(s) but no matching local credentials. ` +
          'Cannot recover secrets for those users — registering a fresh user. ' +
          'Existing brokerage connections under old users will need to be relinked.',
          { keyIndex, existingUsers: snapUsers }
        );
      }

      // Register a brand-new user
      userId = `centralfolio-k${keyIndex}-${crypto.randomUUID().split('-')[0]}`;
      keyLog.info('Registering new SnapTrade user', { keyIndex, userId });

      const regRes = await snapClient.authentication.registerSnapTradeUser({ userId });
      userSecret = regRes.data?.userSecret;

      if (!userSecret) {
        keyLog.error('registerSnapTradeUser response missing userSecret', { keyIndex, data: regRes.data });
        return res.status(500).json({ error: 'SnapTrade registration did not return a userSecret', detail: regRes.data });
      }

      db.setSetting(userIdKey, userId);
      db.setSetting(userSecretKey, userSecret);
      userSource = snapUsers.length > 0 ? 'new_after_existing' : 'new_registration';
      keyLog.info('User registered and credentials stored', { keyIndex, userId, source: userSource });
    }

    // 5. Fire background sync so brokerage connections appear immediately
    keyLog.info('Kicking off background sync', { keyIndex });
    performSync().catch(err =>
      keyLog.error('Background sync after key save failed', { keyIndex, error: err.message })
    );

    const messages = {
      existing_local:       'Key saved. Existing local credentials reconfirmed. Background sync started.',
      new_registration:     'Key saved and new user registered. Background sync started.',
      new_after_existing:   'Key saved. SnapTrade had existing users but no matching local credentials — registered a new user. Background sync started. You may need to reconnect brokerages.'
    };

    res.json({
      success: true,
      keyIndex,
      userId,
      registered: true,
      userSource,
      existingUsersFound: snapUsers.length,
      message: messages[userSource] || 'Key saved.'
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    keyLog.error('Failed to save/register SnapTrade key', { keyIndex, error: err.message, detail });
    res.status(500).json({ error: 'Failed to save key', detail });
  }
});

module.exports = router;

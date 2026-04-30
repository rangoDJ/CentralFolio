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

// POST /api/snaptrade-keys/:keyIndex - Save key credentials
router.post('/:keyIndex', (req, res) => {
  const keyIndex = parseInt(req.params.keyIndex);
  const { clientId, consumerKey, name } = req.body;

  if (isNaN(keyIndex) || keyIndex < 1 || keyIndex > MAX_KEY_INDEX) {
    return res.status(400).json({ error: 'Invalid key index' });
  }

  if (!clientId) {
    return res.status(400).json({ error: 'Client ID is required' });
  }

  try {
    const keySuffix = keyIndex === 1 ? '' : `_${keyIndex}`;
    db.setSetting(`SNAPTRADE_CLIENT_ID${keySuffix}`, clientId);
    if (consumerKey) {
      db.setSetting(`SNAPTRADE_CONSUMER_KEY${keySuffix}`, consumerKey);
    }
    if (name) {
      db.setSetting(`SNAPTRADE_KEY_NAME${keySuffix}`, name);
    }
    keyLog.info('SnapTrade key saved', { keyIndex, hasConsumerKey: !!consumerKey });
    res.json({ success: true, keyIndex, clientId: clientId.substring(0, 8) + '...' });
  } catch (err) {
    keyLog.error('Failed to save SnapTrade key', { keyIndex, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

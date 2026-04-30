const { Router } = require('express');
const log = require('../logger');
const db = require('../db');
const configManager = require('../configManager');

const router = Router();
const keyLog = log.make('snaptrade-keys');

// GET /api/snaptrade-keys
router.get('/', (req, res) => {
  const settings = configManager.getSettings();
  const keys = [];

  // SnapTrade supports up to 3 keys in this app's logic
  for (let i = 1; i <= 3; i++) {
    const clientId = process.env[`SNAPTRADE_CLIENT_ID_${i}`] || (i === 1 ? process.env.SNAPTRADE_CLIENT_ID : null);
    const consumerKey = process.env[`SNAPTRADE_CONSUMER_KEY_${i}`] || (i === 1 ? process.env.SNAPTRADE_CONSUMER_KEY : null);

    if (clientId && consumerKey) {
      // Check if user is registered for this key
      // For now, we assume key 1 uses the global user ID if no specific one exists
      const userId = db.getSetting(`SNAPTRADE_USER_ID_${i}`) || (i === 1 ? db.getSetting('SNAPTRADE_USER_ID') : null);
      const userSecret = db.getSetting(`SNAPTRADE_USER_SECRET_${i}`) || (i === 1 ? db.getSetting('SNAPTRADE_USER_SECRET') : null);

      // Count connections for this key
      const connectionCountStmt = db.db.prepare('SELECT COUNT(*) as count FROM connections WHERE key_index = ?');
      const connectionCount = connectionCountStmt.get(i).count;

      // Get custom name for this key
      const keyName = db.getSetting(`SNAPTRADE_KEY_NAME_${i}`) || `Key ${i}`;

      keys.push({
        keyIndex: i,
        clientId: clientId,
        name: keyName,
        registered: !!(userId && userSecret),
        connectionCount: connectionCount
      });
    }
  }

  res.json(keys);
});

// DELETE /api/snaptrade-keys/:keyIndex
router.delete('/:keyIndex', (req, res) => {
  const keyIndex = parseInt(req.params.keyIndex);
  if (isNaN(keyIndex) || keyIndex < 1 || keyIndex > 3) {
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

  if (isNaN(keyIndex) || keyIndex < 1 || keyIndex > 3) {
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

module.exports = router;

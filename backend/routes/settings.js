const { Router } = require('express');
const log = require('../logger');
const db = require('../db');
const configManager = require('../configManager');

const router = Router();
const cfgLog = log.make('settings');

const ALLOWED_SETTING_KEYS = new Set([
  'SNAPTRADE_USER_ID', 'SNAPTRADE_USER_SECRET',
  'SNAPTRADE_CLIENT_ID', 'SNAPTRADE_CONSUMER_KEY',
  'SNAPTRADE_CLIENT_ID_1', 'SNAPTRADE_CONSUMER_KEY_1',
  'SNAPTRADE_CLIENT_ID_2', 'SNAPTRADE_CONSUMER_KEY_2',
  'SNAPTRADE_CLIENT_ID_3', 'SNAPTRADE_CONSUMER_KEY_3',
  'SNAPTRADE_CLIENT_ID_4', 'SNAPTRADE_CONSUMER_KEY_4',
  'SNAPTRADE_CLIENT_ID_5', 'SNAPTRADE_CONSUMER_KEY_5',
  'SNAPTRADE_CLIENT_ID_6', 'SNAPTRADE_CONSUMER_KEY_6',
  'SNAPTRADE_CLIENT_ID_7', 'SNAPTRADE_CONSUMER_KEY_7',
  'SNAPTRADE_CLIENT_ID_8', 'SNAPTRADE_CONSUMER_KEY_8',
  'SNAPTRADE_CLIENT_ID_9', 'SNAPTRADE_CONSUMER_KEY_9',
  'SNAPTRADE_CLIENT_ID_10', 'SNAPTRADE_CONSUMER_KEY_10',
  'TRANSACTION_SYNC_TIME', 'AUTOMATION_WAIT_TIME'
]);

// GET /api/settings
router.get('/', (_req, res) => {
  res.json(db.getAllSettings());
});

// POST /api/settings
router.post('/', (req, res) => {
  const { key, value } = req.body;
  if (!key || !ALLOWED_SETTING_KEYS.has(key)) {
    return res.status(400).json({ error: `Unknown setting key: ${key}` });
  }
  db.setSetting(key, value);
  cfgLog.info('Setting updated', { key });
  res.json({ success: true });
});

// GET /api/config
router.get('/config', (_req, res) => {
  const settings = configManager.getSettings();
  
  // Also check database for keys
  const dbKeys = [];
  for (let i = 1; i <= 10; i++) {
    const clientId = db.getSetting(`SNAPTRADE_CLIENT_ID_${i}`) || (i === 1 ? db.getSetting('SNAPTRADE_CLIENT_ID') : null);
    if (clientId) {
      dbKeys.push({ index: i, clientId, source: 'database' });
    }
  }

  // Combine unique indices
  const allIndices = new Set([
    ...settings.ENV_KEYS.map(k => k.index),
    ...dbKeys.map(k => k.index)
  ]);

  const combinedKeys = Array.from(allIndices).map(idx => {
    const envKey = settings.ENV_KEYS.find(k => k.index === idx);
    const dbKey = dbKeys.find(k => k.index === idx);
    return {
      index: idx,
      clientId: envKey?.clientId || dbKey?.clientId,
      source: envKey ? 'environment' : 'database'
    };
  });

  res.json({ 
    ...settings, 
    COMBINED_KEYS: combinedKeys,
    HAS_KEYS: combinedKeys.length > 0,
    isPersonal: combinedKeys.some(k => k.clientId.startsWith('PERS-'))
  });
});

// POST /api/config
router.post('/config', (req, res) => {
  configManager.updateSettings(req.body);
  cfgLog.info('Config updated', { keys: Object.keys(req.body) });
  res.json({ success: true });
});

module.exports = router;

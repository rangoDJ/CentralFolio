const { Router } = require('express');
const log = require('../logger');
const db = require('../db');
const configManager = require('../configManager');

const router = Router();
const cfgLog = log.make('settings');

const ALLOWED_SETTING_KEYS = new Set([
  'SNAPTRADE_USER_ID', 'SNAPTRADE_USER_SECRET',
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
  res.json({ ...settings, isPersonal: (settings.SNAPTRADE_CLIENT_ID || '').startsWith('PERS-') });
});

// POST /api/config
router.post('/config', (req, res) => {
  configManager.updateSettings(req.body);
  cfgLog.info('Config updated', { keys: Object.keys(req.body) });
  res.json({ success: true });
});

module.exports = router;

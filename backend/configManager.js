const fs = require('fs');
const path = require('path');
require('dotenv').config(); // Load existing .env once to fetch defaults
const log = require('./logger');
const cfgLog = log.make('config');

// All persistent data lives under DATA_DIR so a single Docker volume covers everything.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'user_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const configManager = {
  settings: {},

  async init() {
    this.load();
    await this.validateOrPrompt();
    this.injectIntoEnv(); // Expose keys safely to existing environment-based logic
  },

  load() {
    if (!fs.existsSync(CONFIG_PATH)) {
      cfgLog.info('First-time launch: initializing config defaults');
      this.settings = {};
      this.save();
    } else {
      try {
        const fileData = fs.readFileSync(CONFIG_PATH, 'utf-8');
        this.settings = JSON.parse(fileData);
        
        // Remove legacy keys from file if they exist
        if (this.settings.SNAPTRADE_CLIENT_ID || this.settings.SNAPTRADE_CONSUMER_KEY || this.settings.MOCK_MODE !== undefined) {
          delete this.settings.SNAPTRADE_CLIENT_ID;
          delete this.settings.SNAPTRADE_CONSUMER_KEY;
          delete this.settings.MOCK_MODE;
          this.save();
        }

        cfgLog.info('Config loaded', { path: CONFIG_PATH });
      } catch (err) {
        cfgLog.error('Failed to parse config, resetting to defaults', { error: err.message });
        this.settings = {};
      }
    }
  },

  save() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.settings, null, 2), 'utf-8');
  },

  injectIntoEnv() {
    // No-op: we now assume they are already in the environment
  },

  async validateOrPrompt() {
    const keys = this.parseMultiKeyEnv();
    if (keys.length === 0) {
      cfgLog.warn('SnapTrade credentials not found in environment variables — live brokerage sync disabled');
    }
  },

  parseMultiKeyEnv() {
    const keys = [];
    // Try numbered format first
    for (let i = 1; i <= 3; i++) {
      const clientId = process.env[`SNAPTRADE_CLIENT_ID_${i}`];
      const consumerKey = process.env[`SNAPTRADE_CONSUMER_KEY_${i}`];
      if (clientId && consumerKey) {
        keys.push({ index: i, clientId, hasConsumerKey: true });
      }
    }
    // Fall back to legacy format
    if (keys.length === 0) {
      const legacyClientId = process.env.SNAPTRADE_CLIENT_ID;
      const legacyConsumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
      if (legacyClientId && legacyConsumerKey) {
        keys.push({ index: 1, clientId: legacyClientId, hasConsumerKey: true });
      }
    }
    return keys;
  },

  getSettings() {
    const envKeys = this.parseMultiKeyEnv();
    const envSettings = {};
    for (const key of envKeys) {
      envSettings[`SNAPTRADE_CLIENT_ID_${key.index}`] = key.clientId;
      // We don't expose consumer keys to the frontend, but snaptrade-keys.js is backend-only
      // However, it's safer to just provide what's needed.
    }
    // Also include legacy keys if they exist in env
    if (process.env.SNAPTRADE_CLIENT_ID) envSettings.SNAPTRADE_CLIENT_ID = process.env.SNAPTRADE_CLIENT_ID;
    if (process.env.SNAPTRADE_CONSUMER_KEY) envSettings.SNAPTRADE_CONSUMER_KEY = process.env.SNAPTRADE_CONSUMER_KEY;

    return {
      ...this.settings,
      ...envSettings,
      HAS_ENV_VARS: envKeys.length > 0,
      ENV_KEYS: envKeys
    };
  },

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.save();
  }
};

module.exports = configManager;

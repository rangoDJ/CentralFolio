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
    const hasKeys = !!(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY);
    if (!hasKeys) {
      cfgLog.warn('SnapTrade credentials not found in environment variables — live brokerage sync disabled');
    }
  },
  
  getSettings() {
    return {
      ...this.settings,
      HAS_ENV_VARS: !!(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY)
    };
  },

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.save();
  }
};

module.exports = configManager;

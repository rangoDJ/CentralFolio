const fs = require('fs');
const path = require('path');
const readline = require('readline');
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
      cfgLog.info('First-time launch: initializing config from environment/defaults');
      this.settings = {
        SNAPTRADE_CLIENT_ID: process.env.SNAPTRADE_CLIENT_ID || '',
        SNAPTRADE_CONSUMER_KEY: process.env.SNAPTRADE_CONSUMER_KEY || '',
        MOCK_MODE: false
      };
      this.save();
    } else {
      try {
        const fileData = fs.readFileSync(CONFIG_PATH, 'utf-8');
        this.settings = JSON.parse(fileData);
        const presentKeys = Object.keys(this.settings || {}).filter(k => !!this.settings[k]);
        cfgLog.info('Config loaded', { path: CONFIG_PATH, presentKeys });
        if (this.settings.MOCK_MODE === undefined) {
          this.settings.MOCK_MODE = false;
          this.save();
        }
      } catch (err) {
        cfgLog.error('Failed to parse config, resetting to defaults', { error: err.message });
        this.settings = {};
      }
    }
  },

  save() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.settings, null, 2), 'utf-8');
    this.injectIntoEnv();
  },

  injectIntoEnv() {
    if (this.settings.SNAPTRADE_CLIENT_ID) {
      process.env.SNAPTRADE_CLIENT_ID = this.settings.SNAPTRADE_CLIENT_ID.trim();
      cfgLog.debug('Injected SNAPTRADE_CLIENT_ID into process env');
    }
    if (this.settings.SNAPTRADE_CONSUMER_KEY) {
      process.env.SNAPTRADE_CONSUMER_KEY = this.settings.SNAPTRADE_CONSUMER_KEY.trim();
      cfgLog.debug('Injected SNAPTRADE_CONSUMER_KEY into process env');
    }
  },

  async validateOrPrompt() {
    const missingKeys = ['SNAPTRADE_CLIENT_ID', 'SNAPTRADE_CONSUMER_KEY'].filter(
      key => !this.settings[key] || this.settings[key].trim() === ''
    );
    if (missingKeys.length > 0) {
      cfgLog.warn('SnapTrade credentials not set — live brokerage sync disabled', { missingKeys });
    }
  },
  
  getSettings() {
    return this.settings;
  },

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.save();
  }
};

module.exports = configManager;

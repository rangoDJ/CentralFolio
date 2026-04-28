const fs = require('fs');
const path = require('path');
const log = require('../logger');

const cacheLog = log.make('cache');

const CACHE_FILE = path.join(__dirname, '..', '..', 'user_data', 'cache.json');

// Single shared cache object — mutated in place so all modules see updates.
const queryCache = { accounts: null, positions: null, lastUpdate: null };

function loadFromDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (cached.accounts && cached.positions) {
        queryCache.accounts = cached.accounts;
        queryCache.positions = cached.positions;
        queryCache.lastUpdate = cached.lastUpdate;
        cacheLog.info('Cache restored from disk', {
          accounts: cached.accounts.length,
          positionGroups: cached.positions.length,
          lastUpdate: cached.lastUpdate
        });
      } else {
        cacheLog.debug('Cache file found but incomplete, starting fresh');
      }
    } else {
      cacheLog.debug('No cache file found, starting fresh');
    }
  } catch (e) {
    cacheLog.warn('Cache restore failed (non-fatal)', { error: e.message });
  }
}

function saveToDisk() {
  if (!queryCache.accounts || !queryCache.positions) return;
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(queryCache));
    cacheLog.verbose('Cache persisted to disk', {
      accounts: queryCache.accounts.length,
      positionGroups: queryCache.positions.length
    });
  } catch (e) {
    cacheLog.error('Failed to persist cache to disk', { error: e.message });
  }
}

function invalidate() {
  queryCache.accounts = null;
  queryCache.positions = null;
}

module.exports = { queryCache, loadFromDisk, saveToDisk, invalidate };

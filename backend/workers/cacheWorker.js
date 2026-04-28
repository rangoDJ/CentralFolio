const log = require('../logger');
const { queryCache } = require('../services/cache');

const cacheLog = log.make('cache');

const CACHE_EVICTION_INTERVAL_MS = 15 * 60 * 1000;

function start() {
  setInterval(() => {
    cacheLog.info('Scheduled cache eviction');
    queryCache.accounts = null;
    queryCache.positions = null;
  }, CACHE_EVICTION_INTERVAL_MS);

  cacheLog.info('Cache eviction worker started', { intervalMs: CACHE_EVICTION_INTERVAL_MS });
}

module.exports = { start };

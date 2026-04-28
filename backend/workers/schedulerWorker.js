const log = require('../logger');
const db = require('../db');
const { syncTransactions } = require('../services/txService');

const txLog = log.make('transactions');

const SYNC_SCHEDULER_INTERVAL_MS = 10 * 1000;

function start() {
  setInterval(() => {
    const syncTime = db.getSetting('TRANSACTION_SYNC_TIME') || '02:00';
    const now = new Date();
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (currentTimeStr === syncTime && now.getSeconds() < 10) {
      txLog.info('Scheduled transaction sync triggered', { time: currentTimeStr });
      syncTransactions();
    }
  }, SYNC_SCHEDULER_INTERVAL_MS);

  txLog.info('Transaction scheduler worker started', { intervalMs: SYNC_SCHEDULER_INTERVAL_MS });
}

module.exports = { start };

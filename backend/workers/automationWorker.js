const log = require('../logger');
const db = require('../db');
const { getCredentials } = require('../services/snaptradeClient');
const { executeAutomationOrder } = require('../services/txService');

const autoLog = log.make('automation');

const AUTOMATION_WORKER_INTERVAL_MS = 60 * 1000;

function start() {
  setInterval(async () => {
    const ready = db.getReadyPendingAutomations();
    if (ready.length === 0) return;

    const { userId, userSecret } = getCredentials();
    if (!userId) return;

    for (const item of ready) {
      try {
        const automations = db.getAutomations();
        const automation = automations.find(a => a.id === item.automation_id);
        if (!automation || !automation.is_active) {
          db.deletePendingAutomation(item.id);
          continue;
        }

        const reinvestAmount = item.amount * (automation.percentage / 100);
        autoLog.info('Processing queued reinvestment', {
          symbol: item.symbol, amount: reinvestAmount, automationId: item.automation_id
        });

        const orderData = await executeAutomationOrder(
          automation, item.transaction_id, item.symbol, reinvestAmount, userId, userSecret
        );
        const orderId = orderData?.brokerage_order_id || 'N/A';
        db.logAutomationAction(automation.id, item.transaction_id, orderId, reinvestAmount, 'Success');
        db.deletePendingAutomation(item.id);
        autoLog.info('Reinvestment order placed', { symbol: item.symbol, amount: reinvestAmount, orderId });
      } catch (err) {
        autoLog.error('Pending automation failed', { symbol: item.symbol, error: err.message, itemId: item.id });
        db.updatePendingStatus(item.id, 'FAILED');
        db.logAutomationAction(item.automation_id, item.transaction_id, null, 0, `Error: ${err.message}`);
      }
    }
  }, AUTOMATION_WORKER_INTERVAL_MS);

  autoLog.info('Automation worker started', { intervalMs: AUTOMATION_WORKER_INTERVAL_MS });
}

module.exports = { start };

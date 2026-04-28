const { Router } = require('express');
const log = require('../logger');
const db = require('../db');
const { getCredentials } = require('../services/snaptradeClient');
const { executeAutomationOrder } = require('../services/txService');

const router = Router();
const autoLog = log.make('automation');

// GET /api/automations
router.get('/', (_req, res) => {
  res.json(db.getAutomations());
});

// POST /api/automations
router.post('/', (req, res) => {
  const { account_id, percentage, excluded_symbols } = req.body;
  db.upsertAutomation(account_id, percentage, excluded_symbols);
  autoLog.info('Automation rule saved', { account_id, percentage });
  res.json({ success: true });
});

// DELETE /api/automations/:id
router.delete('/:id', (req, res) => {
  db.deleteAutomation(req.params.id);
  autoLog.info('Automation rule deleted', { id: req.params.id });
  res.json({ success: true });
});

// GET /api/automations/logs
router.get('/logs', (_req, res) => {
  res.json(db.getAutomationLogs());
});

// POST /api/automations/trigger  (manual reinvestment trigger)
router.post('/trigger', async (req, res) => {
  const { transaction_id } = req.body;
  try {
    const tx = db.db.prepare('SELECT * FROM transactions WHERE id = ?').get(transaction_id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const { userId, userSecret } = getCredentials();
    if (!userId) throw new Error('SnapTrade credentials missing.');

    const automations = db.getAutomations();
    const automation = automations.find(a => a.account_id === tx.account_id);

    if (!automation) {
      const acc = db.getAllBrokerageAccounts().find(a => a.id === tx.account_id);
      const accName = acc ? `${acc.account_name} (${acc.brokerage})` : 'Unknown Account';
      return res.status(400).json({ error: `No automation rule found for account: ${accName}. Please create one in the Automations tab.` });
    }

    if (!automation.is_active) {
      return res.status(400).json({ error: 'Automation rule for this account is currently disabled.' });
    }

    const symbol = tx.symbol;
    const exclusions = automation.excluded_symbols
      ? automation.excluded_symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];
    if (exclusions.includes(symbol.toUpperCase())) {
      return res.status(400).json({ error: `Symbol ${symbol} is excluded in this account's automation rules.` });
    }

    const amount = tx.amount * (automation.percentage / 100);
    autoLog.info('Manual automation trigger', { symbol, amount, accountId: tx.account_id });

    const orderData = await executeAutomationOrder(automation, tx.id, symbol, amount, userId, userSecret);
    const orderId = orderData?.brokerage_order_id || 'N/A';
    db.logAutomationAction(automation.id, tx.id, orderId, amount, 'Manual Trigger Success');
    autoLog.info('Manual trigger succeeded', { symbol, orderId, amount });
    res.json({ success: true, order_id: orderId });
  } catch (err) {
    autoLog.error('Manual automation trigger failed', { error: err.message, detail: err.response?.data });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/automation-history  (legacy alias)
router.get('/history', (_req, res) => {
  res.json(db.getAutomationLogs());
});

module.exports = router;

const log = require('../logger');
const db = require('../db');
const { getSnaptrade, getCredentials, safeGetQuotes, getKeyIndexForAccount } = require('./snaptradeClient');

const txLog   = log.make('transactions');
const autoLog = log.make('automation');

async function executeAutomationOrder(automation, transaction_id, symbol, amount, userId, userSecret) {
  const keyIndex = getKeyIndexForAccount(automation.account_id);
  const quotesRes = await safeGetQuotes(userId, userSecret, automation.account_id, symbol, keyIndex);
  const price = quotesRes.data?.[0]?.last_trade_price;
  const symId = quotesRes.data?.[0]?.symbol?.id;
  autoLog.debug('Executing automation order', { symbol, price, amount, accountId: automation.account_id, keyIndex });

  if (amount < 1.00) {
    throw new Error(`Amount ($${amount.toFixed(2)}) is lower than the $1.00 minimum for fractional orders.`);
  }

  const orderRes = await getSnaptrade(keyIndex).trading.placeForceOrder({
    userId, userSecret,
    account_id: automation.account_id,
    action: 'BUY',
    universal_symbol_id: symId,
    order_type: 'Market',
    time_in_force: 'Day',
    notional_value: amount
  });
  return orderRes.data;
}

async function processAutomations(activities) {
  const automations = db.getAutomations();
  if (automations.length === 0) return;

  for (const act of activities) {
    if (act.type !== 'DIVIDEND') continue;
    if (db.isTransactionProcessed(act.id)) continue;
    if (db.isTransactionQueued(act.id)) continue;

    const symbol = act.symbol?.symbol?.symbol || '';
    const automation = automations.find(a => a.account_id === act.account_id);

    if (automation && automation.is_active && symbol) {
      const exclusions = automation.excluded_symbols
        ? automation.excluded_symbols.split(',').map(s => s.trim().toUpperCase()).filter(s => s !== '')
        : [];
      if (exclusions.includes(symbol.toUpperCase())) {
        autoLog.info('Skipping reinvestment — symbol excluded', { symbol, accountId: act.account_id });
        continue;
      }

      const waitSeconds = parseInt(db.getSetting('AUTOMATION_WAIT_TIME') || '120');
      const processAfter = new Date(Date.now() + waitSeconds * 1000).toISOString().replace('T', ' ').replace('Z', '');

      db.addPendingAutomation(automation.id, act.id, act.amount, symbol, act.account_id, processAfter);
      autoLog.info('Reinvestment queued', { symbol, accountId: act.account_id, amount: act.amount, waitSeconds, processAfter });
    }
  }
}

async function syncTransactions() {
  const t0 = Date.now();
  try {
    txLog.info('Starting transaction sync');
    
    const accounts = db.getAllBrokerageAccounts();
    let imported = 0;
    let allActivities = [];

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];

    txLog.debug('Syncing transactions', { accounts: accounts.length, startDate });
    for (const account of accounts) {
      const keyIndex = getKeyIndexForAccount(account.id);
      const { userId, userSecret } = getCredentials(keyIndex);
      
      if (!userId) {
        txLog.warn('Skipping account sync — credentials missing', { accountId: account.id, keyIndex });
        continue;
      }

      txLog.debug('Fetching account activities', { accountId: account.id, keyIndex });
      try {
        const res = await getSnaptrade(keyIndex).accountInformation.getAccountActivities({
          userId, userSecret, accountId: account.id, startDate
        });

        let activities = res.data;
        if (activities && !Array.isArray(activities) && Array.isArray(activities.data)) {
          activities = activities.data;
        }
        if (!Array.isArray(activities)) activities = [];

        for (const act of activities) {
          const amount = act.amount !== undefined ? act.amount : (act.units * (act.price || 0));
          db.upsertTransaction({
            id: act.id,
            account_id: account.id,
            trade_date: act.trade_date,
            type: act.type,
            amount,
            currency: act.currency?.code || 'CAD',
            symbol: act.symbol?.symbol || '',
            description: act.description,
            category: act.type
          });
          imported++;
        }
        txLog.verbose('Account activities fetched', { accountId: account.id, count: activities.length });
        allActivities = allActivities.concat(activities);
      } catch (accErr) {
        txLog.error('Failed to sync transactions for account', { accountId: account.id, error: accErr.message });
      }
    }

    processAutomations(allActivities).catch(err =>
      autoLog.error('Automation processing failed after transaction sync', { error: err.message })
    );

    txLog.info('Transaction sync complete', { imported, durationMs: Date.now() - t0 });
    return { success: true, count: imported };
  } catch (error) {
    txLog.error('Transaction sync failed', { error: error.message, detail: error.response?.data });
    return { success: false, error: 'Transaction sync failed' };
  }
}

module.exports = { syncTransactions, processAutomations, executeAutomationOrder };

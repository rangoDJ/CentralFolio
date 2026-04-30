const { Router } = require('express');
const log = require('../logger');
const db = require('../db');
const { getSnaptrade, getCredentials, safeGetQuotes } = require('../services/snaptradeClient');
const { queryCache } = require('../services/cache');
const { performSync } = require('../services/syncService');

const router = Router();
const orderLog = log.make('orders');

// POST /api/orders
router.post('/', async (req, res) => {
  const { accountId, symbol, universalSymbolId, side, orderType, quantity, limitPrice } = req.body;

  if (!accountId || !symbol || !side || !quantity) {
    return res.status(400).json({ error: 'accountId, symbol, side, and quantity are required' });
  }
  if (!['BUY', 'SELL'].includes(String(side).toUpperCase())) {
    return res.status(400).json({ error: 'side must be BUY or SELL' });
  }
  const parsedQty = parseFloat(quantity);
  if (isNaN(parsedQty) || parsedQty <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive number' });
  }
  if (orderType === 'LIMIT' && (!limitPrice || parseFloat(limitPrice) <= 0)) {
    return res.status(400).json({ error: 'limitPrice must be a positive number for LIMIT orders' });
  }
  if (!/^[A-Za-z0-9.\-]{1,10}$/.test(String(symbol))) {
    return res.status(400).json({ error: 'invalid symbol format' });
  }

  try {
    const keyIndex = getKeyIndexForAccount(accountId);
    const { userId, userSecret } = getCredentials(keyIndex);
    if (!userId) {
      return res.status(400).json({ error: 'SnapTrade credentials not configured. Please link an account in Settings.' });
    }

    let symId = universalSymbolId;
    if (!symId) {
      const quotesRes = await safeGetQuotes(userId, userSecret, accountId, symbol, keyIndex);
      symId = quotesRes.data?.[0]?.symbol?.id;
      if (!symId) return res.status(404).json({ error: `Symbol "${symbol}" not found for this account` });
    }

    const payload = {
      userId, userSecret,
      account_id: accountId,
      action: side.toUpperCase(),
      order_type: orderType === 'LIMIT' ? 'Limit' : 'Market',
      time_in_force: 'Day',
      units: parsedQty,
      universal_symbol_id: symId,
      ...(orderType === 'LIMIT' && limitPrice ? { price: parseFloat(limitPrice) } : {})
    };

    const orderRes = await getSnaptrade(keyIndex).trading.placeForceOrder(payload);
    orderLog.info('Order placed', { side, quantity, symbol, accountId, orderType, keyIndex });

    queryCache.accounts = null;
    queryCache.positions = null;
    performSync().catch(err => orderLog.error('Post-order sync failed', { error: err.message }));

    res.json({ success: true, order: orderRes.data });
  } catch (err) {
    const detail = err.responseBody || err.response?.data || err.message;
    orderLog.error('Order placement failed', { side, quantity, symbol, accountId, detail });
    res.status(500).json({ error: 'Order placement failed', detail });
  }
});

// GET /api/orders
router.get('/', async (_req, res) => {
  try {
    const accounts = db.getAllBrokerageAccounts();
    const allOrders = [];

    for (const account of accounts) {
      try {
        const keyIndex = getKeyIndexForAccount(account.id);
        const { userId, userSecret } = getCredentials(keyIndex);
        if (!userId) continue;

        const ordersRes = await getSnaptrade(keyIndex).accountInformation.getUserAccountOrders({
          userId, userSecret, accountId: account.id, days: 30
        });
        if (Array.isArray(ordersRes.data)) {
          allOrders.push(...ordersRes.data.map(o => ({
            ...o, accountId: account.id, accountName: account.accountName, person: account.person
          })));
        }
      } catch (accErr) {
        orderLog.warn('Failed to fetch orders for account', { accountId: account.id, error: accErr.message });
      }
    }

    allOrders.sort((a, b) => new Date(b.time_placed || b.timestamp) - new Date(a.time_placed || a.timestamp));
    res.json(allOrders);
  } catch (err) {
    orderLog.error('GET /api/orders failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

module.exports = router;

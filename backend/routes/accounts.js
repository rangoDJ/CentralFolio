const { Router } = require('express');
const log = require('../logger');
const db = require('../db');
const { getFxRate } = require('../fx');
const { getDividendData } = require('../dividends');
const { getSnaptrade, getCredentials } = require('../services/snaptradeClient');
const { queryCache } = require('../services/cache');
const { performSync } = require('../services/syncService');
const configManager = require('../configManager');

const router = Router();
const acctLog = log.make('accounts');
const divLog  = log.make('dividends');

// GET /api/fx-rate
router.get('/fx-rate', async (_req, res) => {
  try {
    const rate = await getFxRate();
    res.json({ rate });
  } catch {
    res.status(500).json({ error: 'Failed to fetch FX rate' });
  }
});

// GET /api/accounts
router.get('/accounts', async (req, res) => {
  if (queryCache.accounts) {
    acctLog.verbose('Accounts served from cache');
    return res.json(queryCache.accounts);
  }

  try {
    const { userId, userSecret, isPersonal } = getCredentials();
    if (!isPersonal && (!userId || !userSecret)) return res.json([]);

    acctLog.debug('Fetching accounts from SnapTrade');
    const accountsRes = await getSnaptrade().accountInformation.listUserAccounts({ userId, userSecret });
    const allAccountsMeta = db.getAllBrokerageAccounts();
    const selectedAccountIds = allAccountsMeta.filter(a => Number(a.is_selected) === 1).map(a => a.id);
    const accountMetaMap = Object.fromEntries(allAccountsMeta.map(a => [a.id, a]));

    const formatted = accountsRes.data
      .filter(acc => selectedAccountIds.includes(acc.id))
      .map(acc => ({
        id: acc.id,
        brokerage_name: acc.institution_name || 'SnapTrade Account',
        accountName: acc.name || 'Brokerage Account',
        accountNumber: acc.number || '',
        person: accountMetaMap[acc.id]?.portfolio || acc.name || 'Unassigned',
        currency: acc.currency || 'CAD',
        value: acc.balance?.total?.amount || 0,
        dayChange: 0, dayChangePercent: 0, allocation: 0
      }));

    queryCache.accounts = formatted;
    queryCache.lastUpdate = Date.now();
    acctLog.info('Accounts fetched and cached', { count: formatted.length });
    res.json(formatted);
  } catch (error) {
    acctLog.error('Failed to load accounts', { error: error.message, detail: error.response?.data });
    res.status(500).json({ error: 'Failed to load accounts' });
  }
});

// GET /api/positions
router.get('/positions', async (_req, res) => {
  if (queryCache.positions) {
    acctLog.verbose('Positions served from cache');
    return res.json(queryCache.positions);
  }

  try {
    const { userId, userSecret, isPersonal } = getCredentials();
    if (!isPersonal && (!userId || !userSecret)) return res.json([]);

    const accountsRes = await getSnaptrade().accountInformation.listUserAccounts({ userId, userSecret });
    const allAccountsMeta = db.getAllBrokerageAccounts();
    const selectedAccountIds = allAccountsMeta.filter(a => Number(a.is_selected) === 1).map(a => a.id);
    const accountMetaMap = Object.fromEntries(allAccountsMeta.map(a => [a.id, a]));

    const selectedAccounts = accountsRes.data.filter(acc => acc.id && selectedAccountIds.includes(acc.id));
    acctLog.debug('Fetching holdings in parallel', { accounts: selectedAccounts.length });

    const holdingResults = await Promise.allSettled(
      selectedAccounts.map(acc =>
        getSnaptrade().accountInformation.getUserHoldings({ userId, userSecret, accountId: acc.id })
          .then(posRes => ({ acc, posRes }))
      )
    );

    const groupedPositions = holdingResults
      .filter(r => r.status === 'fulfilled')
      .map(r => {
        const { acc, posRes } = r.value;
        const holdings = posRes.data?.positions || [];
        return {
          accountId: acc.id,
          accountName: accountMetaMap[acc.id]?.portfolio || acc.name || acc.institution_name || 'Brokerage Account',
          balances: posRes.data?.balances || [],
          holdings: holdings.map(pos => ({
            symbol: pos.symbol?.symbol?.symbol || 'UNKNOWN',
            description: pos.symbol?.symbol?.description || pos.symbol?.symbol?.name || '',
            universalSymbolId: pos.symbol?.symbol?.id || null,
            shares: pos.units || 0,
            nativePrice: pos.price || 0,
            currency: pos.symbol?.currency?.code || 'CAD',
            dayChange: 0, dayPnL: 0, holders: ['A'], dividendYield: 0, fxImpact: 0
          }))
        };
      });

    holdingResults
      .filter(r => r.status === 'rejected')
      .forEach((r, i) =>
        acctLog.error('Failed to fetch holdings', { accountId: selectedAccounts[i]?.id, error: r.reason?.message })
      );

    queryCache.positions = groupedPositions;
    queryCache.lastUpdate = Date.now();
    acctLog.info('Positions fetched and cached', { groups: groupedPositions.length });
    res.json(groupedPositions);
  } catch (error) {
    acctLog.error('Failed to load positions from SnapTrade', { error: error.message, detail: error.response?.data });
    res.status(500).json({ error: 'Failed to load positions', detail: error.message });
  }
});

// GET /api/dividends
router.get('/dividends', async (_req, res) => {
  try {
    const positionsData = queryCache.positions || [];
    if (positionsData.length === 0) return res.json([]);

    const fxRate = await getFxRate();

    const holdingsMap = {};
    for (const acc of positionsData) {
      for (const h of (acc.holdings || [])) {
        if (!h.symbol || h.symbol === 'UNKNOWN') continue;
        if (!holdingsMap[h.symbol]) {
          holdingsMap[h.symbol] = { symbol: h.symbol, description: h.description || '', currency: h.currency, totalShares: 0, accounts: [] };
        }
        holdingsMap[h.symbol].totalShares += h.shares;
        if (!holdingsMap[h.symbol].accounts.includes(acc.accountName)) {
          holdingsMap[h.symbol].accounts.push(acc.accountName);
        }
      }
    }

    const symbols = Object.keys(holdingsMap);
    divLog.debug('Fetching dividend data', { symbols: symbols.length });

    const settled = await Promise.allSettled(symbols.map(sym => getDividendData(sym)));

    const results = [];
    settled.forEach((result, i) => {
      const symbol = symbols[i];
      const holding = holdingsMap[symbol];
      if (result.status !== 'fulfilled' || !result.value) return;
      const d = result.value;
      const toCad = amt => holding.currency === 'USD' && fxRate ? amt * fxRate : amt;
      results.push({
        symbol, description: holding.description, shares: holding.totalShares,
        currency: holding.currency, accounts: holding.accounts,
        lastAmount: d.lastAmount, lastAmountCad: toCad(d.lastAmount), lastPayDate: d.lastPayDate,
        frequency: d.frequency, annualPerShare: d.annualPerShare,
        annualIncomeCad: toCad(d.annualPerShare * holding.totalShares),
        nextPayDates: d.nextPayDates, recentHistory: d.recentHistory
      });
    });

    divLog.verbose('Dividend data compiled', { symbols: results.length });
    res.json(results);
  } catch (err) {
    divLog.error('Failed to fetch dividends', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch dividends' });
  }
});

// GET /api/brokerage-accounts
router.get('/brokerage-accounts', (_req, res) => {
  res.json(db.getAllBrokerageAccounts());
});

// PATCH /api/brokerage-accounts/:id
router.patch('/brokerage-accounts/:id', (req, res) => {
  const { portfolio } = req.body;
  if (portfolio === undefined) return res.status(400).json({ error: 'portfolio field required' });
  db.setAccountPortfolio(req.params.id, portfolio || null);
  res.json({ success: true });
});

// POST /api/brokerage-accounts/select
router.post('/brokerage-accounts/select', (req, res) => {
  const { id, isSelected } = req.body;
  db.toggleAccountSelection(id, isSelected);
  queryCache.accounts = null;
  queryCache.positions = null;
  acctLog.info('Account selection toggled, triggering background sync', { id, isSelected });
  performSync().catch(err => acctLog.error('Background selection sync failed', { error: err.message }));
  res.json({ success: true });
});

module.exports = router;

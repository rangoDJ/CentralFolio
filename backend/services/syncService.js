const log = require('../logger');
const db = require('../db');
const { getSnaptrade, getCredentials } = require('./snaptradeClient');
const { queryCache, saveToDisk } = require('./cache');

const syncLog = log.make('sync');

async function performSync() {
  const t0 = Date.now();
  const { userId, userSecret, isPersonal } = getCredentials();

  if (!isPersonal && (!userId || !userSecret)) {
    syncLog.warn('Auto-sync skipped: SnapTrade credentials missing');
    return { success: false, message: 'SnapTrade credentials missing.' };
  }

  syncLog.info('Starting brokerage & account sync', { isPersonal });
  let authorizations = [];

  // If we have real keys, ensure we don't have the old mock connection sitting around
  db.db.prepare("DELETE FROM connections WHERE id = 'mock_ws_1'").run();

  if (isPersonal) {
    syncLog.debug('Personal flow detected, synthesizing connection entry');
    db.upsertConnection(userId, 'Personal Integration', 'CONNECTED');
    authorizations = [{ id: userId, brokerage: { name: 'Personal Integration' } }];
  } else {
    syncLog.debug('Fetching brokerage authorizations');
    const authorizationsResponse = await getSnaptrade().connections.listBrokerageAuthorizations({ userId, userSecret });
    authorizations = authorizationsResponse.data;
    syncLog.info('Authorizations fetched', { count: authorizations.length });
  }

  if (Array.isArray(authorizations)) {
    for (const auth of authorizations) {
      db.upsertConnection(auth.id, auth.brokerage?.name || 'Unknown', 'CONNECTED');
      syncLog.debug('Refreshing brokerage authorization', { authId: auth.id, brokerage: auth.brokerage?.name });
      
      // Personal tokens don't need/support refresh via this endpoint
      if (isPersonal) continue;

      try {
        await getSnaptrade().connections.refreshBrokerageAuthorization({
          authorizationId: auth.id, userId, userSecret
        });
        syncLog.verbose('Authorization refreshed', { authId: auth.id });
      } catch (err) {
        if (err.response?.status !== 400 && err.response?.status !== 403) {
          syncLog.warn('Brokerage refresh warning', { authId: auth.id, error: err.message, status: err.response?.status });
        } else {
          syncLog.debug('Brokerage refresh skipped (plan/rate limit)', { authId: auth.id, status: err.response?.status });
        }
      }
    }
  }

  syncLog.debug('Fetching user accounts list');
  let accountsRes;
  try {
    accountsRes = await getSnaptrade().accountInformation.listUserAccounts({ userId, userSecret });
    syncLog.info('Accounts list fetched', { count: accountsRes.data?.length });
  } catch (err) {
    syncLog.error('Failed to list accounts', { error: err.message, detail: err.response?.data });
    throw err;
  }

  if (Array.isArray(accountsRes.data)) {
    for (const acc of accountsRes.data) {
      const matchedAuth = Array.isArray(authorizations)
        ? authorizations.find(a => a.brokerage?.name === acc.institution_name)
        : null;
      db.upsertBrokerageAccount(
        acc.id,
        matchedAuth?.id || null,
        acc.institution_name || 'Unknown',
        acc.name || 'Account',
        acc.number || '',
        acc.currency || 'CAD'
      );
    }
  }

  const allAccountsMeta = db.getAllBrokerageAccounts();
  const selectedAccountIds = allAccountsMeta.filter(a => Number(a.is_selected) === 1).map(a => a.id);
  const accountMetaMap = Object.fromEntries(allAccountsMeta.map(a => [a.id, a]));

  queryCache.accounts = accountsRes.data
    .filter(acc => selectedAccountIds.includes(acc.id))
    .map(acc => ({
      id: acc.id,
      brokerage_name: acc.institution_name,
      accountName: acc.name,
      accountNumber: acc.number,
      person: accountMetaMap[acc.id]?.portfolio || acc.name || 'Unassigned',
      currency: acc.currency,
      value: acc.balance?.total?.amount || 0,
      dayChange: 0,
      dayChangePercent: 0,
      allocation: 0
    }));

  const groupedPositions = [];
  for (const a of accountsRes.data) {
    if (!selectedAccountIds.includes(a.id)) continue;
    syncLog.debug('Fetching holdings for account', { accountId: a.id, accountName: a.name });
    try {
      const pRes = await getSnaptrade().accountInformation.getUserHoldings({ userId, userSecret, accountId: a.id });
      const holdingsArray = pRes.data?.positions || [];
      syncLog.verbose('Holdings fetched', { accountId: a.id, positions: holdingsArray.length });

      groupedPositions.push({
        accountId: a.id,
        accountName: accountMetaMap[a.id]?.portfolio || a.name || a.institution_name || 'Account',
        balances: pRes.data?.balances || [],
        holdings: holdingsArray.map(pos => ({
          symbol: pos.symbol?.symbol?.symbol || 'UNKNOWN',
          description: pos.symbol?.symbol?.description || pos.symbol?.symbol?.name || '',
          universalSymbolId: pos.symbol?.symbol?.id || null,
          shares: pos.units || 0,
          nativePrice: pos.price || 0,
          currency: pos.symbol?.currency?.code || 'CAD',
          dayChange: 0, dayPnL: 0, holders: ['A'], dividendYield: 0, fxImpact: 0
        }))
      });
    } catch (e) {
      syncLog.error('Failed to fetch holdings for account', { accountId: a.id, error: e.message });
    }
  }

  queryCache.positions = groupedPositions;
  queryCache.lastUpdate = Date.now();
  saveToDisk();

  syncLog.info('Sync & warmup complete', { durationMs: Date.now() - t0, accounts: groupedPositions.length });
  return { success: true, authorizations };
}

module.exports = { performSync };

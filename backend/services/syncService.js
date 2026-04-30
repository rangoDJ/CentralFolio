const log = require('../logger');
const db = require('../db');
const { getSnaptrade, getCredentials } = require('./snaptradeClient');
const { queryCache, saveToDisk } = require('./cache');

const syncLog = log.make('sync');

async function performSync() {
  const t0 = Date.now();
  syncLog.info('Starting multi-key brokerage & account sync');

  // If we have real keys, ensure we don't have the old mock connection sitting around
  try {
    db.db.prepare("DELETE FROM connections WHERE id = 'mock_ws_1'").run();
  } catch (e) {}

  let allAuthorizations = [];
  let allAccounts = [];

  // Loop through potential keys (supporting up to 10 keys)
  for (let i = 1; i <= 10; i++) {
    const { userId, userSecret, isPersonal, clientId } = getCredentials(i);

    if (!clientId) {
      syncLog.debug(`Key ${i}: no clientId configured, skipping`);
      continue;
    }

    if (!userId || !userSecret) {
      syncLog.warn(`Key ${i}: registered=false — skipping sync (no userId/userSecret). Save a key via Settings to register.`, { isPersonal, clientId: clientId.slice(0, 8) + '...' });
      continue;
    }

    syncLog.info(`Key ${i}: starting sync`, { isPersonal, userId: userId.slice(0, 12) + '...' });
    let authorizations = [];

    try {
      syncLog.info(`Key ${i}: fetching brokerage authorizations from SnapTrade`);
      const authorizationsResponse = await getSnaptrade(i).connections.listBrokerageAuthorizations({ userId, userSecret });
      authorizations = authorizationsResponse.data || [];
      syncLog.info(`Key ${i}: authorizations fetched`, {
        count: authorizations.length,
        brokerages: authorizations.map(a => a.brokerage?.name || 'Unknown')
      });

      if (authorizations.length === 0) {
        syncLog.warn(`Key ${i}: no brokerage connections found — user must complete OAuth via Settings → Connect Brokerage`);
      }

      for (const auth of authorizations) {
        syncLog.debug(`Key ${i}: upserting connection`, { id: auth.id, brokerage: auth.brokerage?.name });
        db.upsertConnection(auth.id, auth.brokerage?.name || 'Unknown', 'CONNECTED', i);
        try {
          await getSnaptrade(i).connections.refreshBrokerageAuthorization({ authorizationId: auth.id, userId, userSecret });
          syncLog.debug(`Key ${i}: refreshed authorization`, { id: auth.id });
        } catch (err) {
          syncLog.warn(`Key ${i}: could not refresh authorization (non-fatal)`, { id: auth.id, error: err.message });
        }
      }
      allAuthorizations.push(...authorizations);

      syncLog.info(`Key ${i}: fetching user accounts list`);
      const accountsRes = await getSnaptrade(i).accountInformation.listUserAccounts({ userId, userSecret });
      const accounts = accountsRes.data || [];
      syncLog.info(`Key ${i}: accounts fetched`, {
        count: accounts.length,
        accounts: accounts.map(a => `${a.name} (${a.institution_name})`)
      });

      for (const acc of accounts) {
        const matchedAuth = authorizations.find(a => a.brokerage?.name === acc.institution_name) || null;
        syncLog.debug(`Key ${i}: upserting account`, { id: acc.id, name: acc.name, brokerage: acc.institution_name, connectionId: matchedAuth?.id });
        db.upsertBrokerageAccount(
          acc.id,
          matchedAuth?.id || null,
          acc.institution_name || 'Unknown',
          acc.name || 'Account',
          acc.number || '',
          acc.currency || 'CAD'
        );
        allAccounts.push(acc);
      }

      syncLog.info(`Key ${i}: sync complete`, { authorizations: authorizations.length, accounts: accounts.length });
    } catch (err) {
      const status = err.response?.status;
      const errorDetail = err.response?.data?.detail || err.response?.data?.message || err.response?.data || err.message;
      syncLog.error(`Key ${i}: sync failed`, { error: err.message, status, detail: errorDetail });
    }
  }

  const allAccountsMeta = db.getAllBrokerageAccounts();
  const selectedAccountIds = allAccountsMeta.filter(a => Number(a.is_selected) === 1).map(a => a.id);
  const accountMetaMap = Object.fromEntries(allAccountsMeta.map(a => [a.id, a]));

  queryCache.accounts = allAccounts
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
  for (const a of allAccounts) {
    if (!selectedAccountIds.includes(a.id)) continue;
    
    // Find which key this account belongs to by looking up the connection
    const accMeta = accountMetaMap[a.id];
    let keyIndex = 1;
    if (accMeta && accMeta.connection_id) {
      const conn = db.getConnectionById(accMeta.connection_id);
      if (conn) keyIndex = conn.key_index;
    }

    const { userId, userSecret } = getCredentials(keyIndex);
    syncLog.debug('Fetching holdings for account', { accountId: a.id, accountName: a.name, keyIndex });
    
    try {
      const pRes = await getSnaptrade(keyIndex).accountInformation.getUserHoldings({ userId, userSecret, accountId: a.id });
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

  syncLog.info('Multi-key sync & warmup complete', { durationMs: Date.now() - t0, accounts: groupedPositions.length });
  return { success: true, authorizations: allAuthorizations };
}

module.exports = { performSync };

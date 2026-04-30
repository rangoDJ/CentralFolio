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

  // Loop through potential keys (supporting up to 3 keys)
  for (let i = 1; i <= 3; i++) {
    const { userId, userSecret, isPersonal, clientId } = getCredentials(i);

    if (!isPersonal && (!userId || !userSecret)) {
      if (i === 1 && !clientId) {
        syncLog.warn('Auto-sync skipped: SnapTrade credentials missing for key 1');
      }
      continue;
    }

    syncLog.info(`Syncing key index ${i}`, { isPersonal });
    let authorizations = [];

    try {
      if (isPersonal) {
        syncLog.debug(`Key ${i}: Personal flow detected`);
        db.upsertConnection(userId, 'Personal Integration', 'CONNECTED', i);
        authorizations = [{ id: userId, brokerage: { name: 'Personal Integration' } }];
      } else {
        syncLog.debug(`Key ${i}: Fetching brokerage authorizations`);
        const authorizationsResponse = await getSnaptrade(i).connections.listBrokerageAuthorizations({ userId, userSecret });
        authorizations = authorizationsResponse.data;
        syncLog.info(`Key ${i}: Authorizations fetched`, { count: authorizations.length });
      }

      if (Array.isArray(authorizations)) {
        for (const auth of authorizations) {
          db.upsertConnection(auth.id, auth.brokerage?.name || 'Unknown', 'CONNECTED', i);
          
          if (isPersonal) continue;

          try {
            await getSnaptrade(i).connections.refreshBrokerageAuthorization({
              authorizationId: auth.id, userId, userSecret
            });
          } catch (err) {
            // Ignore refresh errors as they are often due to plan limitations
          }
        }
        allAuthorizations.push(...authorizations);
      }

      syncLog.debug(`Key ${i}: Fetching user accounts list`);
      const accountsRes = await getSnaptrade(i).accountInformation.listUserAccounts({ userId, userSecret });
      if (Array.isArray(accountsRes.data)) {
        syncLog.info(`Key ${i}: Accounts list fetched`, { count: accountsRes.data.length });
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
          allAccounts.push(acc);
        }
      }
    } catch (err) {
      syncLog.error(`Failed to sync key index ${i}`, { error: err.message, detail: err.response?.data });
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

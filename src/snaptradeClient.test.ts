import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'snaptrade-client-'));

const { getSnapTradeClientForPortfolio, clearSnapTradeClientCache, evictSnapTradeClientForPortfolio } =
  await import('./services/snaptrade.js');

/**
 * The SDK v12 upgrade changed how a client is constructed: credentials moved
 * from the top level of the config into an explicit auth mode. Nothing here
 * touches the network — it only proves the client builds and exposes the API
 * groups this app calls.
 */

const portfolio: any = {
  id: 1, name: 'WS', clientId: 'test-client-id', consumerKey: 'test-consumer-key',
  userId: 'test-user', userSecret: 'test-secret',
};

test('a client is constructed from a clientId and consumerKey', () => {
  clearSnapTradeClientCache();
  const client = getSnapTradeClientForPortfolio(portfolio);
  assert.ok(client, 'client should be constructed');
});

test('every API group this app calls is present', () => {
  const client: any = getSnapTradeClientForPortfolio(portfolio);
  for (const group of ['authentication', 'connections', 'accountInformation', 'trading', 'referenceData']) {
    assert.ok(client[group], `missing API group: ${group}`);
  }
});

test('every SDK method this app calls still exists', () => {
  const client: any = getSnapTradeClientForPortfolio(portfolio);
  const methods: Array<[string, string]> = [
    ['authentication', 'loginSnapTradeUser'],
    ['authentication', 'registerSnapTradeUser'],
    ['authentication', 'deleteSnapTradeUser'],
    ['authentication', 'listSnapTradeUsers'],
    ['connections', 'listBrokerageAuthorizations'],
    ['accountInformation', 'listUserAccounts'],
    // Replaced getUserAccountPositions, which v12 removed.
    ['accountInformation', 'getUserHoldings'],
    ['accountInformation', 'getAccountActivities'],
    ['trading', 'placeForceOrder'],
    ['referenceData', 'listAllBrokerages'],
  ];
  for (const [group, method] of methods) {
    assert.equal(typeof client[group][method], 'function', `missing ${group}.${method}`);
  }
});

test('clients are cached per portfolio and evicted on credential change', () => {
  clearSnapTradeClientCache();
  const first = getSnapTradeClientForPortfolio(portfolio);
  assert.equal(getSnapTradeClientForPortfolio(portfolio), first, 'same instance reused');

  evictSnapTradeClientForPortfolio(1);
  assert.notEqual(getSnapTradeClientForPortfolio(portfolio), first, 'rebuilt after eviction');
});

test('a portfolio without credentials is refused rather than half-built', () => {
  assert.throws(
    () => getSnapTradeClientForPortfolio({ id: 2, name: 'No creds' } as any),
    /credentials not configured/i,
  );
});

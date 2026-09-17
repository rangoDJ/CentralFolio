import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-key-'));

const { db } = await import('./models/database.js');
const { savePortfolio, getPortfolio, listPortfolios } = await import('./models/db.js');
const { getSnapTradeClientForPortfolio, clearSnapTradeClientCache, evictSnapTradeClientForPortfolio } =
  await import('./services/snaptrade.js');
const { isPortfolioConnected } = await import('./utils/snapTradeKeyType.js');

/**
 * A personal-key connection has to work end to end without ever registering a
 * user or storing a secret, because SnapTrade offers neither for that key type.
 */

let personalId = 0;
let commercialId = 0;

before(() => {
  personalId = savePortfolio({
    name: 'My accounts', clientId: 'cid', consumerKey: 'ck',
    userId: 'personal-key', keyType: 'personal',
  } as any);
  commercialId = savePortfolio({
    name: 'Product', clientId: 'cid2', consumerKey: 'ck2',
    userId: 'someone@example.com', userSecret: 'secret', keyType: 'commercial',
  } as any);
});

test('the key type round-trips through the database', () => {
  assert.equal(getPortfolio(personalId)!.keyType, 'personal');
  assert.equal(getPortfolio(commercialId)!.keyType, 'commercial');
});

test('a portfolio saved without a key type defaults to commercial', () => {
  // Every install that predates this column is commercial.
  const id = savePortfolio({ name: 'Legacy', clientId: 'c', consumerKey: 'k', userId: 'u' } as any);
  assert.equal(getPortfolio(id)!.keyType, 'commercial');
});

test('a personal connection is usable with no user secret stored', () => {
  const portfolio = getPortfolio(personalId)!;
  assert.equal(portfolio.userSecret ?? null, null, 'nothing to store');
  assert.equal(isPortfolioConnected(portfolio), true);
});

test('each key type builds a client in its own auth mode', () => {
  clearSnapTradeClientCache();
  const personal: any = getSnapTradeClientForPortfolio(getPortfolio(personalId)!);
  const commercial: any = getSnapTradeClientForPortfolio(getPortfolio(commercialId)!);
  assert.equal(personal.accountInformation.configuration.authMode, 'personalApiKey');
  assert.equal(commercial.accountInformation.configuration.authMode, 'commercialApiKey');
});

test('a client is not shared between the two modes', () => {
  clearSnapTradeClientCache();
  const first: any = getSnapTradeClientForPortfolio(getPortfolio(personalId)!);
  // The same portfolio switched to a commercial key must not reuse a client
  // that signs its requests the personal way.
  const switched: any = getSnapTradeClientForPortfolio({ ...getPortfolio(personalId)!, keyType: 'commercial' });
  assert.notEqual(switched, first);
  assert.equal(switched.accountInformation.configuration.authMode, 'commercialApiKey');
});

test('eviction drops the cached client whichever mode it was built in', () => {
  clearSnapTradeClientCache();
  const before = getSnapTradeClientForPortfolio(getPortfolio(personalId)!);
  evictSnapTradeClientForPortfolio(personalId);
  const after = getSnapTradeClientForPortfolio(getPortfolio(personalId)!);
  assert.notEqual(after, before, 'a credential change must not keep serving the old client');
});

test('a personal key sends no userId or userSecret on the wire', async () => {
  // The SDK resolves the user from the key, and rejects requests that try to
  // name one. Call sites pass them regardless, so this is what makes that safe.
  const client: any = getSnapTradeClientForPortfolio(getPortfolio(personalId)!);
  let url = '';
  client.accountInformation.axios.interceptors.request.use((c: any) => {
    url = c.url ?? '';
    throw new Error('stop before the network');
  });
  try {
    await client.accountInformation.listUserAccounts({ userId: 'u', userSecret: 'LEAKED' });
  } catch { /* stopped on purpose */ }

  assert.ok(!url.includes('LEAKED'), 'userSecret must not reach a personal-key request');
  assert.ok(!/[?&]userId=/.test(url), 'userId must not reach a personal-key request');
  assert.match(url, /clientId=/, 'the key itself still identifies the caller');
});

test('listPortfolios exposes the key type to everything downstream', () => {
  const byId = new Map(listPortfolios().map(p => [p.id, p]));
  assert.equal(byId.get(personalId)!.keyType, 'personal');
  assert.equal(byId.get(commercialId)!.keyType, 'commercial');
});

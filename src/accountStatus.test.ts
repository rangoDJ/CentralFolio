import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'account-status-'));

const { db } = await import('./models/database.js');
const { saveCachedAccounts, getCachedAccounts, getActiveAccountIds } = await import('./models/db.js');
const { isHiddenAtBroker } = await import('./repositories/accountRepository.js');

before(() => {
  db.prepare(`INSERT INTO portfolios (id,name,clientId,consumerKey,userId,userSecret)
              VALUES (1,'WS','c','k','u','s')`).run();

  // Shaped like SnapTrade's List Accounts response.
  saveCachedAccounts(1, [
    { id: 'open-1',        name: 'TFSA',      currency: 'CAD', status: 'open',        balance: { total: { amount: 100 } } },
    { id: 'archived-1',    name: 'Old RRSP',  currency: 'CAD', status: 'archived',    balance: { total: { amount: 0 } } },
    { id: 'closed-1',      name: 'Closed',    currency: 'CAD', status: 'closed',      balance: { total: { amount: 0 } } },
    { id: 'unavailable-1', name: 'Gone',      currency: 'CAD', status: 'unavailable', balance: { total: { amount: 0 } } },
    { id: 'nostatus-1',    name: 'No status', currency: 'CAD',                        balance: { total: { amount: 50 } } },
    { id: 'null-1',        name: 'Null',      currency: 'CAD', status: null,          balance: { total: { amount: 50 } } },
  ]);
});

test('an account the brokerage no longer reports as open is excluded', () => {
  const active = getActiveAccountIds();
  assert.ok(!active.has('archived-1'), 'archived');
  assert.ok(!active.has('closed-1'), 'closed');
  assert.ok(!active.has('unavailable-1'), 'unavailable');
});

test('an open account is still included', () => {
  assert.ok(getActiveAccountIds().has('open-1'));
});

test('a missing or null status never hides an account', () => {
  // Many brokerages report no status at all. Reading that as "hidden" would
  // empty the entire app for those users.
  const active = getActiveAccountIds();
  assert.ok(active.has('nostatus-1'), 'absent status must stay visible');
  assert.ok(active.has('null-1'), 'null status must stay visible');
});

test('the status is stored and surfaced on the account row', () => {
  const byId = new Map(getCachedAccounts(1).map((a: any) => [a.id, a]));
  assert.equal(byId.get('archived-1').status, 'archived');
  assert.equal(byId.get('archived-1').hiddenAtBroker, true);
  assert.equal(byId.get('open-1').hiddenAtBroker, false);
  assert.equal(byId.get('nostatus-1').hiddenAtBroker, false);
});

test('a refresh that reopens an account brings it back', () => {
  saveCachedAccounts(1, [
    { id: 'archived-1', name: 'Old RRSP', currency: 'CAD', status: 'open', balance: { total: { amount: 10 } } },
  ]);
  assert.ok(getActiveAccountIds().has('archived-1'));
});

test('isHiddenAtBroker treats only an explicit non-open status as hidden', () => {
  assert.equal(isHiddenAtBroker('open'), false);
  assert.equal(isHiddenAtBroker('OPEN'), false, 'case should not matter');
  assert.equal(isHiddenAtBroker(undefined), false);
  assert.equal(isHiddenAtBroker(null), false);
  assert.equal(isHiddenAtBroker(''), false);
  assert.equal(isHiddenAtBroker('  '), false);
  assert.equal(isHiddenAtBroker('archived'), true);
  assert.equal(isHiddenAtBroker('closed'), true);
  assert.equal(isHiddenAtBroker('unavailable'), true);
  // An unfamiliar value from a future API version is treated as not-open,
  // which errs toward hiding rather than showing something marked otherwise.
  assert.equal(isHiddenAtBroker('hidden'), true);
});

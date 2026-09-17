import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// An isolated database, so this never touches the developer's own data.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bucket-balance-'));

const { db } = await import('./models/database.js');
const { saveCachedAccounts } = await import('./models/db.js');
const { createBucket } = await import('./repositories/bucketRepository.js');
const { planBucketRun } = await import('./services/bucketService.js');

let bucketId: number;

before(() => {
  db.prepare(`INSERT INTO portfolios (id,name,clientId,consumerKey,userId,userSecret,tradingEnabled)
              VALUES (1,'WS','c','k','u','s',1)`).run();
  db.prepare(`INSERT INTO accounts (id,portfolioId,name,currency,isActive,cashBalance,balanceTotal)
              VALUES ('acc-1',1,'TFSA','CAD',1,50,1000)`).run();
  bucketId = createBucket({
    name: 'Core', cashValue: 100, splitMode: 'equal',
    items: [{ symbol: 'AAPL', name: null, weight: null }, { symbol: 'MSFT', name: null, weight: null }],
  }).id;
});

const target = [{ portfolioId: '1', accountId: 'acc-1' }];
const plan = () => planBucketRun(
  { id: bucketId, name: 'Core', cashValue: 100, splitMode: 'equal' as const,
    items: [{ symbol: 'AAPL', name: null, weight: null }, { symbol: 'MSFT', name: null, weight: null }] },
  target,
);

test('an account short on cash blocks the run', () => {
  const p = plan();
  assert.equal(p.accounts[0].cash, 50);
  assert.equal(p.accounts[0].shortfall, 50);
  assert.ok(p.errors.some(e => /short by 50/.test(e)), `expected a shortfall error, got ${JSON.stringify(p.errors)}`);
});

test('a refreshed balance is what the check actually reads', () => {
  // What refreshAccountBalances does on a successful broker call: overwrite the
  // cached rows. The funding decision must follow the new figure, not the old.
  saveCachedAccounts(1, [{
    id: 'acc-1', name: 'TFSA', currency: 'CAD',
    balance: { total: { amount: 1000 }, cash: { amount: 500 } },
  }]);

  const p = plan();
  assert.equal(p.accounts[0].cash, 500, 'the plan reads the refreshed balance');
  assert.equal(p.accounts[0].shortfall, 0);
  assert.deepEqual(p.errors, [], 'a now-funded account no longer blocks');
});

test('a refresh that reveals less cash blocks a run the stale figure allowed', () => {
  saveCachedAccounts(1, [{
    id: 'acc-1', name: 'TFSA', currency: 'CAD',
    balance: { total: { amount: 1000 }, cash: { amount: 10 } },
  }]);

  const p = plan();
  assert.equal(p.accounts[0].cash, 10);
  assert.ok(p.errors.some(e => /short by 90/.test(e)), `expected a shortfall error, got ${JSON.stringify(p.errors)}`);
});

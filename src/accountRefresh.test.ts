import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'account-refresh-'));

const { db } = await import('./models/database.js');
const { saveCachedAccounts, getCachedAccounts, setAccountCustomName } = await import('./models/db.js');
const { accountDisplayName } = await import('./utils/accountName.js');

/**
 * A refreshed account list has to be read back before it is displayed.
 *
 * The brokerage response knows nothing about names set in this app, so showing
 * it directly falls back to the broker's own label. That is what the dividend
 * tracker did whenever the accounts cache was cold: the same account read
 * "TFSA 9921" on a cache miss and "Retirement" on a hit.
 */

/** Shaped like SnapTrade's listUserAccounts response — note: no customName. */
const fromBrokerage = [{
  id: 'acc-1', name: 'TFSA 9921', currency: 'CAD', status: 'open',
  balance: { total: { amount: 5000 }, cash: { amount: 900 } },
}];

before(() => {
  db.prepare(`INSERT INTO portfolios (id,name,clientId,consumerKey,userId,userSecret)
              VALUES (1,'WS','c','k','u','s')`).run();
  saveCachedAccounts(1, fromBrokerage);
  setAccountCustomName('acc-1', 'Retirement');
});

test('the brokerage response alone cannot show a renamed account', () => {
  // Not a defect in accountDisplayName — there is simply nothing to resolve
  // from. This is why the response must not be displayed directly.
  assert.equal(accountDisplayName(fromBrokerage[0]), 'TFSA 9921');
});

test('saving a refresh hands back rows that carry the custom name', () => {
  const stored = saveCachedAccounts(1, fromBrokerage);
  const account = stored.find((a: any) => a.id === 'acc-1');
  assert.equal(account.customName, 'Retirement', 'the rename survives the refresh');
  assert.equal(account.displayName, 'Retirement');
  assert.equal(accountDisplayName(account), 'Retirement');
});

test('what is handed back matches a fresh read of the cache', () => {
  // The return value is the same data a re-read would give, so a caller has no
  // reason to reach for the raw response instead.
  const returned = saveCachedAccounts(1, fromBrokerage);
  const reread = getCachedAccounts(1);
  assert.deepEqual(
    returned.map((a: any) => [a.id, a.displayName, a.hiddenAtBroker]),
    reread.map((a: any) => [a.id, a.displayName, a.hiddenAtBroker]),
  );
});

test('a refresh does not overwrite the rename with the broker label', () => {
  saveCachedAccounts(1, [{ ...fromBrokerage[0], name: 'TFSA 9921 RENAMED AT BROKER' }]);
  const account = getCachedAccounts(1).find((a: any) => a.id === 'acc-1');
  assert.equal(account.name, 'TFSA 9921 RENAMED AT BROKER', 'the broker label updates');
  assert.equal(account.displayName, 'Retirement', 'the name the user set still wins');
});

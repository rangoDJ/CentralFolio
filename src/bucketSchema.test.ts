import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketSchema, bucketRunSchema } from './schemas/bucketSchema.js';

const base = { name: 'Core 5', splitMode: 'equal' as const };

test('a valid equal bucket parses and normalizes its symbols', () => {
  const out = bucketSchema.parse({ ...base, items: [{ symbol: ' aapl ' }, { symbol: 'msft' }] });
  assert.deepEqual(out.items.map((i: any) => i.symbol), ['AAPL', 'MSFT']);
});

test('a bucket stores no cash amount — it is named when the bucket is run', () => {
  const out: any = bucketSchema.parse({ ...base, items: [{ symbol: 'AAPL' }] });
  assert.equal('cashValue' in out, false);
  // A stray amount on the save payload is simply not carried through.
  const withAmount: any = bucketSchema.parse({ ...base, cashValue: 250, items: [{ symbol: 'AAPL' }] });
  assert.equal(withAmount.cashValue, undefined);
});

test('the same symbol twice is rejected', () => {
  const res = bucketSchema.safeParse({ ...base, items: [{ symbol: 'AAPL' }, { symbol: 'aapl' }] });
  assert.equal(res.success, false);
  assert.match(res.error!.issues[0].message, /appears more than once/);
});

test('a weighted bucket must weight every symbol', () => {
  const res = bucketSchema.safeParse({
    ...base, splitMode: 'weighted',
    items: [{ symbol: 'AAPL', weight: 60 }, { symbol: 'MSFT' }],
  });
  assert.equal(res.success, false);
  assert.match(res.error!.issues[0].message, /weight on every symbol/);
});

test('weights must add up to 100%', () => {
  const short = bucketSchema.safeParse({
    ...base, splitMode: 'weighted',
    items: [{ symbol: 'AAPL', weight: 40 }, { symbol: 'MSFT', weight: 40 }],
  });
  assert.equal(short.success, false);
  assert.match(short.error!.issues[0].message, /add up to 100%/);

  const exact = bucketSchema.safeParse({
    ...base, splitMode: 'weighted',
    items: [{ symbol: 'AAPL', weight: 60 }, { symbol: 'MSFT', weight: 40 }],
  });
  assert.equal(exact.success, true);
});

test('a bucket needs a name and at least one symbol', () => {
  assert.equal(bucketSchema.safeParse({ ...base, name: '  ', items: [{ symbol: 'AAPL' }] }).success, false);
  assert.equal(bucketSchema.safeParse({ ...base, items: [] }).success, false);
});

test('a run needs accounts and an amount, and ids are coerced to strings', () => {
  assert.equal(bucketRunSchema.safeParse({ accounts: [], cashValue: 250 }).success, false);
  // The amount lives on the run, so it is required here rather than optional.
  assert.equal(bucketRunSchema.safeParse({ accounts: [{ portfolioId: 1, accountId: 'a' }] }).success, false);
  assert.equal(bucketRunSchema.safeParse({ accounts: [{ portfolioId: 1, accountId: 'a' }], cashValue: 0 }).success, false);

  const out = bucketRunSchema.parse({ accounts: [{ portfolioId: 1, accountId: 'acc-1' }], cashValue: 250 });
  assert.equal(out.accounts[0].portfolioId, '1');
  assert.equal(typeof out.accounts[0].portfolioId, 'string');
  assert.equal(out.cashValue, 250);
});

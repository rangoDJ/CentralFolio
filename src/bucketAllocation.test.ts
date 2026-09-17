import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateBucket, allocatedTotal, floorCents, MIN_NOTIONAL } from './services/bucketAllocation.js';

const items = (...symbols: string[]) => symbols.map(s => ({ symbol: s, name: null, weight: null }));

test('an equal split divides the cash value evenly', () => {
  const out = allocateBucket(items('A', 'B', 'C', 'D', 'E'), 250, 'equal');
  assert.equal(out.length, 5);
  assert.deepEqual(out.map(o => o.amount), [50, 50, 50, 50, 50]);
  assert.equal(allocatedTotal(out), 250);
});

test('an equal split never spends more than the cash value', () => {
  // 250 / 3 = 83.333… — rounding up would put the bucket over its own cap.
  const out = allocateBucket(items('A', 'B', 'C'), 250, 'equal');
  assert.deepEqual(out.map(o => o.amount), [83.33, 83.33, 83.33]);
  assert.ok(allocatedTotal(out) <= 250);
  assert.equal(allocatedTotal(out), 249.99);
});

test('a weighted split follows the weights', () => {
  const weighted = [
    { symbol: 'A', name: null, weight: 40 },
    { symbol: 'B', name: null, weight: 20 },
    { symbol: 'C', name: null, weight: 20 },
    { symbol: 'D', name: null, weight: 10 },
    { symbol: 'E', name: null, weight: 10 },
  ];
  const out = allocateBucket(weighted, 250, 'weighted');
  assert.deepEqual(out.map(o => o.amount), [100, 50, 50, 25, 25]);
  assert.equal(allocatedTotal(out), 250);
});

test('weights that do not sum to 100 are normalized by their own total', () => {
  const weighted = [
    { symbol: 'A', name: null, weight: 3 },
    { symbol: 'B', name: null, weight: 1 },
  ];
  const out = allocateBucket(weighted, 100, 'weighted');
  assert.deepEqual(out.map(o => o.amount), [75, 25]);
});

test('allocations under the broker minimum are flagged, not dropped', () => {
  const out = allocateBucket(items('A', 'B', 'C', 'D', 'E'), 2, 'equal');
  assert.equal(out.length, 5, 'every symbol still gets a row');
  assert.ok(out.every(o => o.belowMinimum));
  assert.ok(out.every(o => o.amount < MIN_NOTIONAL));
});

test('an allocation exactly at the minimum is not flagged', () => {
  const out = allocateBucket(items('A', 'B'), 2, 'equal');
  assert.deepEqual(out.map(o => o.amount), [1, 1]);
  assert.ok(out.every(o => !o.belowMinimum));
});

test('an empty bucket or a zero cash value allocates nothing', () => {
  assert.deepEqual(allocateBucket([], 250, 'equal'), []);
  assert.deepEqual(allocateBucket(items('A'), 0, 'equal'), []);
});

test('floorCents rounds down and does not drift on binary fractions', () => {
  assert.equal(floorCents(83.339), 83.33);
  assert.equal(floorCents(0.1 + 0.2), 0.3);
  assert.equal(floorCents(50), 50);
});

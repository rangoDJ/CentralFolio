import { test } from 'node:test';
import assert from 'node:assert';
import { computeRealizedGains, type RGTransaction } from './services/realizedGains.js';

const approx = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} expected ${b}, got ${a}`);

test('realizedGains: simple buy then full sell', () => {
  const txns: RGTransaction[] = [
    { symbol: 'AAA', type: 'BUY',  units: 10, price: 10, amount: 100, date: '2023-01-10' },
    { symbol: 'AAA', type: 'SELL', units: 10, price: 15, amount: 150, date: '2024-03-05' },
  ];
  const r = computeRealizedGains(txns);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].gain, 50);   // 150 proceeds - 100 cost
  assert.equal(r.events[0].year, 2024);
  assert.equal(r.totalGain, 50);
});

test('realizedGains: ACB averages multiple buy lots', () => {
  const txns: RGTransaction[] = [
    { symbol: 'AAA', type: 'BUY',  units: 10, price: 10, amount: 100, date: '2023-01-01' }, // acb 100/10
    { symbol: 'AAA', type: 'BUY',  units: 10, price: 20, amount: 200, date: '2023-06-01' }, // acb 300/20 = 15
    { symbol: 'AAA', type: 'SELL', units: 5,  price: 25, amount: 125, date: '2024-01-01' },
  ];
  const r = computeRealizedGains(txns);
  // avg cost 15 → cost of 5 = 75; proceeds 125 → gain 50
  approx(r.events[0].costBasis, 75, 'cost basis of sold shares');
  approx(r.events[0].gain, 50, 'gain');
});

test('realizedGains: partial sells leave remaining ACB intact', () => {
  const txns: RGTransaction[] = [
    { symbol: 'AAA', type: 'BUY',  units: 100, price: 10, amount: 1000, date: '2023-01-01' },
    { symbol: 'AAA', type: 'SELL', units: 40,  price: 12, amount: 480,  date: '2024-01-01' }, // gain 480-400=80
    { symbol: 'AAA', type: 'SELL', units: 60,  price: 9,  amount: 540,  date: '2024-02-01' }, // gain 540-600=-60
  ];
  const r = computeRealizedGains(txns);
  assert.equal(r.events.length, 2);
  approx(r.events[0].gain, 80, 'first sell gain');
  approx(r.events[1].gain, -60, 'second sell loss');
  approx(r.totalGain, 20, 'net realized');
});

test('realizedGains: separates symbols and sorts by date', () => {
  const txns: RGTransaction[] = [
    { symbol: 'BBB', type: 'BUY',  units: 1, price: 5,  amount: 5,  date: '2023-01-01' },
    { symbol: 'AAA', type: 'BUY',  units: 1, price: 10, amount: 10, date: '2023-01-01' },
    { symbol: 'BBB', type: 'SELL', units: 1, price: 8,  amount: 8,  date: '2024-02-01' },
    { symbol: 'AAA', type: 'SELL', units: 1, price: 12, amount: 12, date: '2024-01-01' },
  ];
  const r = computeRealizedGains(txns);
  assert.deepEqual(r.events.map(e => e.symbol), ['AAA', 'BBB']); // date-sorted
  approx(r.totalGain, (12 - 10) + (8 - 5), 'combined gain');
});

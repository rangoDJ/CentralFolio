import { test } from 'node:test';
import assert from 'node:assert';
import { computeAttribution, type AttributionInput } from './services/attribution.js';

const approx = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} expected ${b}, got ${a}`);

test('computeAttribution: total return = unrealized + dividends', () => {
  const input: AttributionInput[] = [
    { symbol: 'AAA', value: 1200, costBasis: 1000, dividends: 50 },
  ];
  const r = computeAttribution(input);
  assert.equal(r.rows[0].unrealized, 200);
  assert.equal(r.rows[0].totalReturn, 250);
  approx(r.rows[0].totalReturnPct!, 25, 'return pct');
  assert.equal(r.totalReturn, 250);
});

test('computeAttribution: sorts by total return descending', () => {
  const input: AttributionInput[] = [
    { symbol: 'LOSER', value: 80,  costBasis: 100, dividends: 0 },   // -20
    { symbol: 'WIN',   value: 300, costBasis: 100, dividends: 10 },  // +210
    { symbol: 'MID',   value: 150, costBasis: 100, dividends: 0 },   // +50
  ];
  const r = computeAttribution(input);
  assert.deepEqual(r.rows.map(x => x.symbol), ['WIN', 'MID', 'LOSER']);
});

test('computeAttribution: contribution shares sum to ±100 by magnitude', () => {
  const input: AttributionInput[] = [
    { symbol: 'A', value: 200, costBasis: 100, dividends: 0 }, // +100
    { symbol: 'B', value: 50,  costBasis: 100, dividends: 0 }, // -50
  ];
  const r = computeAttribution(input);
  // absSum = 150 → A = +66.67%, B = -33.33%
  const a = r.rows.find(x => x.symbol === 'A')!;
  const b = r.rows.find(x => x.symbol === 'B')!;
  approx(a.contributionPct, 66.67, 'A contribution');
  approx(b.contributionPct, -33.33, 'B contribution');
});

test('computeAttribution: zero cost basis yields null pct, not divide-by-zero', () => {
  const r = computeAttribution([{ symbol: 'FREE', value: 100, costBasis: 0, dividends: 5 }]);
  assert.equal(r.rows[0].totalReturnPct, null);
  assert.equal(r.rows[0].totalReturn, 105);
});

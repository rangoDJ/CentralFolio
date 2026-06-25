import { test } from 'node:test';
import assert from 'node:assert';
import { computeRiskMetrics, maxDrawdown, dailyReturns, type RiskPoint } from './services/riskMetrics.js';

const approx = (a: number, b: number, tol = 1e-6, msg?: string) =>
  assert.ok(Math.abs(a - b) < tol, `${msg ?? ''} expected ${b}, got ${a}`);

function series(vals: number[]): RiskPoint[] {
  return vals.map((v, i) => ({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, value: v }));
}

test('dailyReturns: simple ratios keyed by later date', () => {
  const r = dailyReturns(series([100, 110, 99]));
  approx(r.get('2024-01-02')!, 0.1, 1e-9, 'up 10%');
  approx(r.get('2024-01-03')!, -0.1, 1e-9, 'down 10%');
});

test('maxDrawdown: peak-to-trough', () => {
  // 100 → 120 (peak) → 90 → 110: worst dd = (120-90)/120 = 0.25
  approx(maxDrawdown(series([100, 120, 90, 110]))!, 0.25, 1e-9);
  assert.equal(maxDrawdown(series([100])), null);
});

test('maxDrawdown: monotonic up has zero drawdown', () => {
  approx(maxDrawdown(series([10, 11, 12, 13]))!, 0, 1e-9);
});

test('computeRiskMetrics: too few points returns nulls', () => {
  const m = computeRiskMetrics(series([100, 101]));
  assert.equal(m.volatility, null);
  assert.equal(m.sharpe, null);
});

test('computeRiskMetrics: volatility is positive for a fluctuating series', () => {
  const m = computeRiskMetrics(series([100, 102, 99, 103, 98, 104, 97]));
  assert.ok(m.volatility! > 0, 'volatility positive');
  assert.ok(m.maxDrawdown! > 0, 'has drawdown');
  assert.equal(m.points, 6);
});

test('computeRiskMetrics: beta ~1 when asset tracks benchmark exactly', () => {
  const s = series([100, 101, 103, 102, 104, 103, 105]);
  const m = computeRiskMetrics(s, s); // identical → beta 1
  approx(m.beta!, 1, 1e-9, 'beta of self is 1');
});

test('computeRiskMetrics: beta ~2 when asset moves twice the benchmark', () => {
  const bench = series([100, 101, 102, 101, 103, 102, 104]);
  // asset daily returns = 2x benchmark daily returns (approx via construction)
  const bRet = Array.from(dailyReturns(bench).values());
  let v = 100; const assetVals = [100];
  for (const r of bRet) { v = v * (1 + 2 * r); assetVals.push(v); }
  const m = computeRiskMetrics(series(assetVals), bench);
  approx(m.beta!, 2, 1e-6, 'beta ~2');
});

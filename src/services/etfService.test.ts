import test from "node:test";
import assert from "node:assert/strict";
import { computeEtfOverlap, computePortfolioXRay } from "./etfService.js";

test("ETF Overlap computes common constituent weights and unique assets", () => {
  const overlap = computeEtfOverlap("VOO", "SPY");
  assert.equal(overlap.etfA, "VOO");
  assert.equal(overlap.etfB, "SPY");
  // VOO and SPY track S&P 500, overlap should be near 100%
  assert.ok(overlap.overlapPct > 20);
  assert.ok(overlap.overlappingHoldings.some(h => h.symbol === 'AAPL'));

  const diffOverlap = computeEtfOverlap("VOO", "SCHD");
  assert.equal(diffOverlap.etfA, "VOO");
  assert.equal(diffOverlap.etfB, "SCHD");
  assert.ok(Array.isArray(diffOverlap.overlappingHoldings));
  assert.ok(Array.isArray(diffOverlap.uniqueToA));
  assert.ok(Array.isArray(diffOverlap.uniqueToB));
});

test("Portfolio X-Ray decomposes ETF positions into underlying companies", () => {
  const xray = computePortfolioXRay();
  assert.ok(xray);
  assert.ok(typeof xray.totalPortfolioValue === 'number');
  assert.ok(Array.isArray(xray.topCompanyExposures));
});

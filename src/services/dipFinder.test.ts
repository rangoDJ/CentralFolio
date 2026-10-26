import test from "node:test";
import assert from "node:assert/strict";
import { upsertCandles, deletePriceHistory } from "../repositories/priceHistoryRepository.js";
import { computeDipMetrics } from "./dipFinderService.js";

test("dip finder computes SMAs, 52W range, discounts and dip scores", () => {
  const sym = `DIPTEST_${Date.now()}`;
  
  // Build 200 candles ending in a drop
  const candles = [];
  for (let i = 200; i >= 1; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    // Baseline price 100, last 10 days drops down to 70
    const price = i <= 10 ? 70 : 100;
    candles.push({
      date: d,
      open: price,
      high: price + 2,
      low: price - 2,
      close: price,
      adjClose: price,
      volume: 10000
    });
  }

  upsertCandles(sym, candles);

  const metrics = computeDipMetrics(sym, true, false);
  assert.ok(metrics);
  assert.equal(metrics.symbol, sym);
  assert.equal(metrics.currentPrice, 70);
  assert.ok(metrics.sma200 != null && metrics.sma200 > 90);
  assert.ok(metrics.vsSma200Pct != null && metrics.vsSma200Pct < -20);
  assert.ok(metrics.dipScore > 50);
  assert.ok(['Deep Dip', 'Moderate Dip'].includes(metrics.rating));

  deletePriceHistory(sym);
});

import test from "node:test";
import assert from "node:assert/strict";
import { runPortfolioBacktest } from "./backtestService.js";

test("runPortfolioBacktest simulates initial amount, DRIP, contributions and returns valid metrics", () => {
  const result = runPortfolioBacktest({
    allocations: [
      { symbol: 'AAPL', targetPct: 50 },
      { symbol: 'MSFT', targetPct: 50 },
    ],
    initialAmount: 10000,
    contributionAmount: 500,
    contributionFrequency: 'monthly',
    reinvestDividends: true,
    benchmark: 'SPY'
  });

  assert.ok(result);
  assert.equal(result.initialAmount, 10000);
  assert.ok(result.finalPortfolioValue > 0);
  assert.ok(result.finalBenchmarkValue > 0);
  assert.ok(Array.isArray(result.timeSeries));
  assert.ok(result.timeSeries.length > 0);
  assert.ok(typeof result.maxDrawdownPct === 'number');
});

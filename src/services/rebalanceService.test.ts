import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRebalance } from "./rebalanceService.js";

// A simple two-asset portfolio: $60 AAA + $40 BBB + $0 cash = $100 total.
const positions = [
  { symbol: "AAA", marketValue: 60 },
  { symbol: "BBB", marketValue: 40 },
];

test("totalValue includes securities market value plus cash", () => {
  const r = computeRebalance(positions, 25, [], "full");
  assert.equal(r.totalValue, 125);
  // Regression guard for the marketValue-always-0 bug: securities must contribute.
  assert.ok(r.totalValue > 25, "securities marketValue must be counted, not zero");
});

test("current percentages reflect marketValue weights", () => {
  const r = computeRebalance(
    positions,
    0,
    [{ symbol: "AAA", targetPct: 0.5 }, { symbol: "BBB", targetPct: 0.5 }],
    "full",
  );
  const aaa = r.assets.find(a => a.symbol === "AAA")!;
  const bbb = r.assets.find(a => a.symbol === "BBB")!;
  assert.equal(aaa.currentPct, 0.6);
  assert.equal(bbb.currentPct, 0.4);
});

test("full mode sells overweight and buys underweight to hit targets", () => {
  const r = computeRebalance(
    positions,
    0,
    [{ symbol: "AAA", targetPct: 0.5 }, { symbol: "BBB", targetPct: 0.5 }],
    "full",
  );
  const sell = r.trades.find(t => t.symbol === "AAA");
  const buy = r.trades.find(t => t.symbol === "BBB");
  assert.deepEqual(sell, { symbol: "AAA", action: "SELL", amount: 10 });
  assert.deepEqual(buy, { symbol: "BBB", action: "BUY", amount: 10 });
});

test("full mode ignores sub-$5 dust deviations", () => {
  const r = computeRebalance(
    [{ symbol: "AAA", marketValue: 51 }, { symbol: "BBB", marketValue: 49 }],
    0,
    [{ symbol: "AAA", targetPct: 0.5 }, { symbol: "BBB", targetPct: 0.5 }],
    "full",
  );
  assert.equal(r.trades.length, 0);
});

test("buy_only mode spends cash on underweight assets proportional to deficit", () => {
  // AAA is $40 under target, BBB is $20 under target (1500 total, targets 0.5/0.5,
  // held 60/40 = 100, so targetVal 750 each → deficits 690/710). Use a cleaner case:
  const r = computeRebalance(
    [{ symbol: "AAA", marketValue: 0 }, { symbol: "BBB", marketValue: 0 }],
    100,
    [{ symbol: "AAA", targetPct: 0.75 }, { symbol: "BBB", targetPct: 0.25 }],
    "buy_only",
  );
  const buyA = r.trades.find(t => t.symbol === "AAA")!;
  const buyB = r.trades.find(t => t.symbol === "BBB")!;
  // total = cash 100; deficits 75 and 25 → spend all 100 split 75/25.
  assert.equal(buyA.amount, 75);
  assert.equal(buyB.amount, 25);
  assert.ok(r.trades.every(t => t.action === "BUY"));
});

test("buy_only mode produces no trades when there is no cash", () => {
  const r = computeRebalance(
    positions,
    0,
    [{ symbol: "AAA", targetPct: 0.5 }, { symbol: "BBB", targetPct: 0.5 }],
    "buy_only",
  );
  assert.equal(r.trades.length, 0);
});

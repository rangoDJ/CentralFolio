import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { reconstructPortfolioHistory, type PHTransaction, type PriceCandleLite } from "./portfolioHistory.js";

// snapshotService imports models/db.js, which opens the singleton SQLite DB on
// first import — point it at a throwaway dir before importing.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-snapshot-test-"));
const { valueAccount, todayIso } = await import("./snapshotService.js");

const prices = (symbol: string, rows: [string, number][]): [string, PriceCandleLite[]] =>
  [symbol, rows.map(([date, close]) => ({ date, close }))];

// One purchase, then a price series. Reconstruction values 10 shares each day.
const txns: PHTransaction[] = [
  { symbol: "AAA", type: "BUY", units: 10, price: 100, amount: 1000, date: "2025-01-01" },
];
const series = new Map<string, PriceCandleLite[]>([
  prices("AAA", [["2025-01-01", 100], ["2025-01-02", 110], ["2025-01-03", 120]]),
]);

test("without snapshots the curve is purely reconstructed", () => {
  const r = reconstructPortfolioHistory(txns, series);
  assert.equal(r.summary.snapshotPoints, 0);
  assert.ok(r.points.every(p => !p.snapshot));
  const jan2 = r.points.find(p => p.date === "2025-01-02")!;
  assert.equal(jan2.value, 1100);
});

test("a recorded snapshot overrides the reconstructed value for its date", () => {
  // The ledger says 10 shares x 110 = 1100, but the account was actually worth
  // 1500 that day — an in-kind transfer the broker never reported.
  const snapshots = new Map([["2025-01-02", 1500]]);
  const r = reconstructPortfolioHistory(txns, series, undefined, snapshots);

  const jan2 = r.points.find(p => p.date === "2025-01-02")!;
  assert.equal(jan2.value, 1500);
  assert.equal(jan2.snapshot, true);
  assert.equal(r.summary.snapshotPoints, 1);

  // Dates without a snapshot are untouched and unflagged.
  const jan1 = r.points.find(p => p.date === "2025-01-01")!;
  assert.equal(jan1.value, 1000);
  assert.equal(jan1.snapshot, undefined);
});

test("the invested line is never overridden — a snapshot is a value, not a cash flow", () => {
  const snapshots = new Map([["2025-01-02", 9999]]);
  const r = reconstructPortfolioHistory(txns, series, undefined, snapshots);
  assert.equal(r.points.find(p => p.date === "2025-01-02")!.invested, 1000);
  assert.equal(r.summary.netInvested, 1000);
});

test("dated contributions are collected for the money-weighted return", () => {
  const r = reconstructPortfolioHistory([
    { symbol: "AAA", type: "BUY", units: 10, price: 100, amount: 1000, date: "2025-01-01" },
    { symbol: "AAA", type: "BUY", units: 5, price: 110, amount: 550, date: "2025-01-02" },
  ], series);

  assert.deepEqual(r.contributions, [
    { date: "2025-01-01", amount: 1000 },
    { date: "2025-01-02", amount: 550 },
  ]);
});

test("same-day trades net into one cash flow", () => {
  // Two flows on one date would distort nothing mathematically, but netting
  // keeps the stream readable and matches how a statement reports the day.
  const r = reconstructPortfolioHistory([
    { symbol: "AAA", type: "BUY", units: 10, price: 100, amount: 1000, date: "2025-01-01" },
    { symbol: "AAA", type: "SELL", units: 4, price: 100, amount: 400, date: "2025-01-01" },
  ], series);

  assert.equal(r.contributions.length, 1);
  assert.deepEqual(r.contributions[0], { date: "2025-01-01", amount: 600 });
});

test("a buy-and-hold that doubles reports a positive money-weighted return", () => {
  const longSeries = new Map<string, PriceCandleLite[]>([
    prices("AAA", [["2024-01-01", 100], ["2026-09-08", 200]]),
  ]);
  const r = reconstructPortfolioHistory(
    [{ symbol: "AAA", type: "BUY", units: 10, price: 100, amount: 1000, date: "2024-01-01" }],
    longSeries,
  );
  assert.ok(r.summary.moneyWeightedReturnPct !== null, "should solve");
  assert.ok(r.summary.moneyWeightedReturnPct! > 0, `expected positive, got ${r.summary.moneyWeightedReturnPct}`);
  // Doubling over ~2.7 years annualizes to well under the 100% simple return.
  assert.ok(
    r.summary.moneyWeightedReturnPct! < r.summary.totalReturnPct,
    "annualized rate should be below the raw simple return over a multi-year hold",
  );
});

test("money-weighted return is null when there is nothing to solve", () => {
  const r = reconstructPortfolioHistory([], new Map());
  assert.equal(r.summary.moneyWeightedReturnPct, null);
  assert.deepEqual(r.contributions, []);
});

// ── snapshot capture ────────────────────────────────────────────────────────

test("valueAccount sums market values and counts real positions", () => {
  const v = valueAccount(
    [{ marketValue: 1000 }, { units: 10, price: 25 }, { marketValue: 0 }],
    500,
  );
  assert.equal(v.marketValue, 1250);
  assert.equal(v.cash, 500);
  assert.equal(v.positions, 2);   // the zero-value row is not a position
});

test("valueAccount falls back to units x price when marketValue is absent", () => {
  assert.equal(valueAccount([{ units: 3, price: 33.33 }], 0).marketValue, 99.99);
});

test("valueAccount reports an empty account as zero, so the caller can skip it", () => {
  // A connection that failed to sync must not be recorded as a crash to zero.
  const v = valueAccount([], 0);
  assert.equal(v.marketValue, 0);
  assert.equal(v.positions, 0);
  assert.equal(v.cash, 0);
});

test("todayIso is a UTC calendar date", () => {
  assert.equal(todayIso(new Date("2026-09-08T23:30:00Z")), "2026-09-08");
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

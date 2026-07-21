import test from "node:test";
import assert from "node:assert/strict";
import { computeDispositions, summarizeByYear, type T5008Transaction, type FxLookup } from "./services/t5008.js";

/** Rate lookup that always returns 1 — isolates the ACB math from FX. */
const par: FxLookup = () => 1;

/** Rate lookup driven by an explicit date→rate table. */
const table = (rates: Record<string, number>): FxLookup =>
  (currency, date) => (currency === "CAD" ? 1 : rates[date] ?? null);

const buy = (symbol: string, date: string, units: number, price: number, extra: Partial<T5008Transaction> = {}): T5008Transaction =>
  ({ symbol, date, type: "BUY", units, price, amount: units * price, ...extra });

const sell = (symbol: string, date: string, units: number, price: number, extra: Partial<T5008Transaction> = {}): T5008Transaction =>
  ({ symbol, date, type: "SELL", units, price, amount: units * price, ...extra });

test("average-cost basis: partial sale uses the blended cost, not FIFO", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2024-01-10", 100, 10),   // $1000
    buy("ACME", "2024-03-10", 100, 20),   // $2000 → 200 units, ACB $3000, avg $15
    sell("ACME", "2024-06-10", 100, 25),  // proceeds $2500, cost 100 × $15 = $1500
  ], par);

  assert.equal(dispositions.length, 1);
  const d = dispositions[0];
  assert.equal(d.proceeds, 2500);
  assert.equal(d.costBasis, 1500);
  assert.equal(d.gain, 1000);
  assert.equal(d.quantity, 100);
  assert.equal(d.superficialLoss, 0);
});

test("remaining ACB carries forward to the next disposition", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2024-01-10", 100, 10),
    buy("ACME", "2024-03-10", 100, 20),
    sell("ACME", "2024-06-10", 100, 25),
    sell("ACME", "2024-09-10", 100, 30),  // remaining 100 units still at avg $15
  ], par);

  assert.equal(dispositions.length, 2);
  assert.equal(dispositions[1].costBasis, 1500);
  assert.equal(dispositions[1].gain, 1500);
});

test("per-trade FX: currency movement is part of the CAD gain", () => {
  // Bought at 1.25, sold at 1.40. Flat in USD, but a real gain in CAD.
  const { dispositions } = computeDispositions([
    buy("MSFT", "2024-01-10", 10, 100, { currencyCode: "USD" }),   // US$1000 → C$1250
    sell("MSFT", "2024-06-10", 10, 100, { currencyCode: "USD" }),  // US$1000 → C$1400
  ], table({ "2024-01-10": 1.25, "2024-06-10": 1.40 }));

  const d = dispositions[0];
  assert.equal(d.costBasis, 1250);
  assert.equal(d.proceeds, 1400);
  assert.equal(d.gain, 150, "flat USD position still produces a CAD gain");
  assert.equal(d.fxRate, 1.40);
  assert.equal(d.fxRateMissing, false);
  // Native figures stay in USD for reconciliation against the broker's slip.
  assert.equal(d.proceedsNative, 1000);
  assert.equal(d.costBasisNative, 1000);
});

test("missing FX rate falls back to 1.0 and is flagged, not silently absorbed", () => {
  const { dispositions, warnings } = computeDispositions([
    buy("MSFT", "2024-01-10", 10, 100, { currencyCode: "USD" }),
    sell("MSFT", "2024-06-10", 10, 120, { currencyCode: "USD" }),
  ], () => null);

  assert.equal(dispositions[0].fxRateMissing, true);
  assert.equal(dispositions[0].fxRate, null);
  assert.ok(warnings.some(w => w.includes("2024-06-10")), "warns about the missing date");
});

test("superficial loss: repurchase inside the 30-day window denies the loss", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2024-01-10", 100, 20),   // ACB $2000
    sell("ACME", "2024-06-10", 100, 10),  // proceeds $1000 → $1000 loss
    buy("ACME", "2024-06-20", 100, 11),   // reacquired 10 days later, still held
  ], par);

  const d = dispositions[0];
  assert.equal(d.gain, -1000);
  assert.equal(d.superficialLoss, 1000, "entire loss denied");
  assert.equal(d.allowableGain, 0, "nothing reportable");
  assert.ok(d.superficialNote?.includes("denied"));
});

test("superficial loss: repurchase outside the window leaves the loss allowable", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2024-01-10", 100, 20),
    sell("ACME", "2024-06-10", 100, 10),
    buy("ACME", "2024-08-15", 100, 11),   // 66 days later — well clear
  ], par);

  const d = dispositions[0];
  assert.equal(d.gain, -1000);
  assert.equal(d.superficialLoss, 0);
  assert.equal(d.allowableGain, -1000);
  assert.equal(d.superficialNote, null);
});

test("superficial loss: sold again before the window closes, so nothing is denied", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2024-01-10", 100, 20),
    sell("ACME", "2024-06-10", 100, 10),  // $1000 loss
    buy("ACME", "2024-06-15", 100, 11),   // reacquired…
    sell("ACME", "2024-06-20", 100, 11),  // …but disposed of again inside the window
  ], par);

  // Nothing is held at the end of the window → the loss is genuine.
  assert.equal(dispositions[0].superficialLoss, 0);
  assert.equal(dispositions[0].allowableGain, -1000);
});

test("superficial loss: partial repurchase denies only the substituted portion", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2024-01-10", 100, 20),   // ACB $2000
    sell("ACME", "2024-06-10", 100, 10),  // $1000 loss on 100 units
    buy("ACME", "2024-06-20", 30, 11),    // only 30 units reacquired
  ], par);

  const d = dispositions[0];
  assert.equal(d.superficialLoss, 300, "30/100 of the loss denied");
  assert.equal(d.allowableGain, -700);
});

test("denied loss is added to the ACB of the retained units, not destroyed", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2024-01-10", 100, 20),   // ACB $2000
    sell("ACME", "2024-06-10", 100, 10),  // $1000 loss, fully denied
    buy("ACME", "2024-06-20", 100, 10),   // reacquired for $1000
    sell("ACME", "2025-06-10", 100, 10),  // sold a year later at $1000
  ], par);

  assert.equal(dispositions[0].superficialLoss, 1000);

  // The retained 100 units carry $1000 (repurchase) + $1000 (denied loss) = $2000.
  // Selling them for $1000 recovers the originally-denied loss.
  const later = dispositions[1];
  assert.equal(later.costBasis, 2000);
  assert.equal(later.gain, -1000, "the denied loss is recovered on the real disposition");
});

test("sells with no prior buy do not produce a negative cost base", () => {
  const { dispositions } = computeDispositions([
    sell("ACME", "2024-06-10", 50, 10),
  ], par);

  assert.equal(dispositions[0].costBasis, 0);
  assert.equal(dispositions[0].proceeds, 500);
});

test("commissions are derived from the amount/price gap and reduce the gain", () => {
  const { dispositions } = computeDispositions([
    { symbol: "ACME", date: "2024-01-10", type: "BUY", units: 100, price: 10, amount: 1005 },
    { symbol: "ACME", date: "2024-06-10", type: "SELL", units: 100, price: 20, amount: 1995 },
  ], par);

  const d = dispositions[0];
  assert.equal(d.costBasis, 1005, "buy commission is capitalized into ACB");
  assert.equal(d.outlays, 5, "sell commission is an outlay");
  assert.equal(d.gain, 990);
});

test("the `action` column is honoured when `type` is not a buy/sell verb", () => {
  const { dispositions } = computeDispositions([
    { symbol: "ACME", date: "2024-01-10", type: "TRADE", action: "BUY", units: 10, price: 10, amount: 100 },
    { symbol: "ACME", date: "2024-06-10", type: "TRADE", action: "SELL", units: 10, price: 15, amount: 150 },
  ], par);

  assert.equal(dispositions.length, 1);
  assert.equal(dispositions[0].gain, 50);
});

test("DRIP reinvestments raise the cost base", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2024-01-10", 100, 10),
    { symbol: "ACME", date: "2024-03-10", type: "DRIP", units: 5, price: 10, amount: 50 },
    sell("ACME", "2024-06-10", 105, 12),
  ], par);

  assert.equal(dispositions[0].costBasis, 1050);
  assert.equal(dispositions[0].gain, 210);
});

test("each symbol keeps its own ACB pool", () => {
  const { dispositions } = computeDispositions([
    buy("AAA", "2024-01-10", 100, 10),
    buy("BBB", "2024-01-10", 100, 50),
    sell("AAA", "2024-06-10", 100, 12),
  ], par);

  assert.equal(dispositions.length, 1);
  assert.equal(dispositions[0].symbol, "AAA");
  assert.equal(dispositions[0].costBasis, 1000, "BBB's cost does not leak into AAA");
});

test("Schedule 3 summary rolls up per year with the 50% inclusion rate", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2023-01-10", 100, 10),
    sell("ACME", "2024-06-10", 50, 30),   // +$1000
    sell("ACME", "2025-06-10", 50, 20),   // +$500
  ], par);

  const summary = summarizeByYear(dispositions);
  assert.equal(summary.length, 2);
  assert.equal(summary[0].year, 2025, "newest year first");

  const y2024 = summary.find(s => s.year === 2024)!;
  assert.equal(y2024.proceeds, 1500);
  assert.equal(y2024.costBasis, 500);
  assert.equal(y2024.netGain, 1000);
  assert.equal(y2024.taxableCapitalGain, 500);
});

test("a net capital loss year produces no taxable gain", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2024-01-10", 100, 20),
    sell("ACME", "2024-06-10", 100, 10),
  ], par);

  const [y] = summarizeByYear(dispositions);
  assert.equal(y.netGain, -1000);
  assert.equal(y.taxableCapitalGain, 0, "losses do not create a negative taxable gain");
});

test("security type codes are inferred from the instrument", () => {
  const { dispositions } = computeDispositions([
    buy("VFV.TO", "2024-01-10", 10, 100, { description: "Vanguard S&P 500 Index ETF" }),
    sell("VFV.TO", "2024-06-10", 10, 110, { description: "Vanguard S&P 500 Index ETF" }),
    buy("ACME", "2024-01-10", 10, 10, { description: "Acme Corp Common" }),
    sell("ACME", "2024-06-10", 10, 12, { description: "Acme Corp Common" }),
  ], par);

  assert.equal(dispositions.find(d => d.symbol === "VFV.TO")!.securityType, "MFT");
  assert.equal(dispositions.find(d => d.symbol === "ACME")!.securityType, "SHS");
});

test("ACB is pooled across accounts, not computed per account", () => {
  // Same security bought in two accounts, sold from one. CRA pools identical
  // property, so the cost base is the blended average of BOTH purchases.
  const { dispositions } = computeDispositions([
    { ...buy("ACME", "2024-01-10", 100, 10), account: "Margin A", accountId: "a" },  // $1000
    { ...buy("ACME", "2024-02-10", 100, 30), account: "Margin B", accountId: "b" },  // $3000
    { ...sell("ACME", "2024-06-10", 100, 25), account: "Margin A", accountId: "a" },
  ], par);

  assert.equal(dispositions.length, 1);
  // Pooled: 200 units / $4000 → avg $20. Per-account would wrongly give $10.
  assert.equal(dispositions[0].costBasis, 2000);
  assert.equal(dispositions[0].gain, 500);
  assert.equal(dispositions[0].account, "Margin A", "still reports where it happened");
});

test("superficial loss is detected across accounts", () => {
  // Selling at a loss in one account and rebuying in another is still a
  // superficial loss — the taxpayer, not the account, is what matters.
  const { dispositions } = computeDispositions([
    { ...buy("ACME", "2024-01-10", 100, 20), account: "Margin A", accountId: "a" },
    { ...sell("ACME", "2024-06-10", 100, 10), account: "Margin A", accountId: "a" },
    { ...buy("ACME", "2024-06-20", 100, 11), account: "Margin B", accountId: "b" },
  ], par);

  assert.equal(dispositions[0].superficialLoss, 1000);
  assert.equal(dispositions[0].allowableGain, 0);
});

test("a sale with no recorded purchase is flagged, not silently zero-cost", () => {
  const { dispositions, warnings } = computeDispositions([
    sell("ACME", "2024-06-10", 50, 10),
  ], par);

  assert.equal(dispositions[0].missingCostBasis, true);
  assert.equal(dispositions[0].costBasis, 0);
  assert.ok(warnings.some(w => w.includes("no recorded purchase")));
});

test("a normal disposition is not flagged as missing cost basis", () => {
  const { dispositions } = computeDispositions([
    buy("ACME", "2024-01-10", 50, 10),
    sell("ACME", "2024-06-10", 50, 12),
  ], par);

  assert.equal(dispositions[0].missingCostBasis, false);
});

test("crypto is tagged and called out as having no T5008 slip", () => {
  const { dispositions, warnings } = computeDispositions([
    { ...buy("BTC", "2024-01-10", 1, 40000), account: "Wealthsimple CRYPTO", accountId: "c" },
    { ...sell("BTC", "2024-06-10", 1, 50000), account: "Wealthsimple CRYPTO", accountId: "c" },
  ], par);

  assert.equal(dispositions[0].isCrypto, true);
  assert.equal(dispositions[0].securityType, "CRYPTO");
  assert.equal(dispositions[0].gain, 10000, "still a reportable capital gain");
  assert.ok(warnings.some(w => w.includes("do NOT issue a T5008")));
});

test("equities are not mistaken for crypto", () => {
  const { dispositions } = computeDispositions([
    { ...buy("ACME", "2024-01-10", 10, 10), account: "Margin", accountId: "a" },
    { ...sell("ACME", "2024-06-10", 10, 12), account: "Margin", accountId: "a" },
  ], par);

  assert.equal(dispositions[0].isCrypto, false);
  assert.equal(dispositions[0].securityType, "SHS");
});

test("dispositions come back in chronological order", () => {
  const { dispositions } = computeDispositions([
    buy("BBB", "2023-01-01", 10, 10),
    buy("AAA", "2023-01-01", 10, 10),
    sell("BBB", "2024-05-01", 10, 12),
    sell("AAA", "2024-02-01", 10, 12),
  ], par);

  assert.deepEqual(dispositions.map(d => d.date), ["2024-02-01", "2024-05-01"]);
});

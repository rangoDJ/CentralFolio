import { test } from "node:test";
import assert from "node:assert/strict";
import {
  comparePortfolios,
  nativeAmountsByCurrency,
  CompareRates,
  ComparePortfolioInput,
} from "./portfolioCompareService.js";

/**
 * Stub rate table, so the matrix logic is tested without hitting Yahoo.
 * `comparePortfolios` never fetches — the controller resolves rates first.
 */
function rates(baseCurrency = "USD", table: Record<string, number> = {}, unresolved: string[] = []): CompareRates {
  return { baseCurrency, rateOf: cur => table[cur] ?? (cur === baseCurrency ? 1 : 1), unresolved };
}

function portfolio(
  id: number,
  name: string,
  positions: any[],
  opts: { tradingEnabled?: boolean; cash?: number; currency?: string } = {},
): ComparePortfolioInput {
  return {
    id,
    name,
    color: "#7c3aed",
    accounts: [{
      accountId: `acct-${id}`,
      accountName: `Account ${id}`,
      parentPortfolioId: "1",
      tradingEnabled: opts.tradingEnabled ?? true,
      currency: opts.currency ?? "USD",
      cash: opts.cash ?? 0,
      positions,
    }],
  };
}

const pos = (symbol: string, units: number, price: number, avg = 0, symbolId = `id-${symbol}`) =>
  ({ symbol, symbolId, description: `${symbol} Inc`, units, price, marketValue: units * price, averagePurchasePrice: avg });

test("every symbol gets a cell in every portfolio, held or not", () => {
  const r = comparePortfolios([
    portfolio(1, "Core", [pos("AAA", 10, 10), pos("BBB", 5, 20)]),
    portfolio(2, "Growth", [pos("AAA", 2, 10)]),
  ], rates());

  assert.equal(r.rows.length, 2);
  for (const row of r.rows) {
    assert.deepEqual(Object.keys(row.cells).sort(), ["1", "2"]);
  }

  const bbb = r.rows.find(x => x.symbol === "BBB")!;
  assert.equal(bbb.cells["1"].held, true);
  assert.equal(bbb.cells["2"].held, false);
  assert.deepEqual(bbb.missingIn, [2]);
  assert.equal(bbb.heldCount, 1);
  assert.equal(bbb.missingCount, 1);
});

test("counts common and unique symbols across the selection", () => {
  const r = comparePortfolios([
    portfolio(1, "Core", [pos("AAA", 1, 10), pos("BBB", 1, 10)]),
    portfolio(2, "Growth", [pos("AAA", 1, 10), pos("CCC", 1, 10)]),
  ], rates());

  assert.equal(r.symbolCount, 3);
  assert.equal(r.commonCount, 1);  // AAA
  assert.equal(r.uniqueCount, 2);  // BBB, CCC
});

test("a gap carries the symbolId and price of a portfolio that does hold it", () => {
  // Without these the UI can't offer a buy for the missing side.
  const r = comparePortfolios([
    portfolio(1, "Core", [pos("AAA", 4, 25, 20, "universal-aaa")]),
    portfolio(2, "Growth", []),
  ], rates());

  const aaa = r.rows[0];
  assert.equal(aaa.symbolId, "universal-aaa");
  assert.equal(aaa.price, 25);
  assert.equal(aaa.description, "AAA Inc");
  assert.equal(aaa.cells["2"].held, false);
});

test("units and value are pooled across the accounts of one portfolio", () => {
  const input: ComparePortfolioInput = {
    id: 1,
    name: "Core",
    color: "#000000",
    accounts: [
      { accountId: "a", accountName: "A", parentPortfolioId: "1", tradingEnabled: true, currency: "USD", cash: 10, positions: [pos("AAA", 3, 10, 8)] },
      { accountId: "b", accountName: "B", parentPortfolioId: "1", tradingEnabled: false, currency: "USD", cash: 5, positions: [pos("AAA", 7, 10, 6)] },
    ],
  };
  const r = comparePortfolios([input], rates());
  const cell = r.rows[0].cells["1"];

  assert.equal(cell.units, 10);
  assert.equal(cell.value, 100);
  assert.equal(cell.cost, 3 * 8 + 7 * 6);   // 66
  assert.equal(cell.avgCost, 6.6);
  assert.equal(cell.profit, 34);
  assert.equal(r.portfolios[0].cash, 15);
  // Only trading-enabled accounts can receive a buy order.
  assert.deepEqual(r.portfolios[0].tradableAccounts.map(a => a.accountId), ["a"]);
});

test("weights are the symbol's share of its own portfolio's total value", () => {
  const r = comparePortfolios([
    portfolio(1, "Core", [pos("AAA", 1, 75), pos("BBB", 1, 25)]),
  ], rates());

  assert.equal(r.portfolios[0].totalValue, 100);
  assert.equal(r.rows.find(x => x.symbol === "AAA")!.cells["1"].weightPct, 75);
  assert.equal(r.rows.find(x => x.symbol === "BBB")!.cells["1"].weightPct, 25);
});

test("a position with no average purchase price reports no profit rather than a fake gain", () => {
  const r = comparePortfolios([portfolio(1, "Core", [pos("AAA", 5, 10, 0)])], rates());
  const cell = r.rows[0].cells["1"];
  assert.equal(cell.cost, 50);
  assert.equal(cell.profit, 0);
  assert.equal(cell.profitPct, 0);
});

test("symbols are normalized and matched case-insensitively", () => {
  const r = comparePortfolios([
    portfolio(1, "Core", [{ ...pos("AAA", 1, 10), symbol: " aaa " }]),
    portfolio(2, "Growth", [pos("AAA", 1, 10)]),
  ], rates());

  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].symbol, "AAA");
  assert.equal(r.rows[0].heldCount, 2);
});

test("empty and zero-quantity positions are skipped", () => {
  const r = comparePortfolios([
    portfolio(1, "Core", [pos("AAA", 0, 0), { ...pos("BBB", 1, 10), symbol: null }, pos("CCC", 2, 5)]),
  ], rates());

  assert.deepEqual(r.rows.map(x => x.symbol), ["CCC"]);
});

test("rows are ordered by combined value across the selection", () => {
  const r = comparePortfolios([
    portfolio(1, "Core", [pos("SMALL", 1, 5), pos("BIG", 1, 50)]),
    portfolio(2, "Growth", [pos("SMALL", 1, 5)]),
  ], rates());

  assert.deepEqual(r.rows.map(x => x.symbol), ["BIG", "SMALL"]);
  assert.equal(r.rows[1].totalValue, 10);
});

// ── Currency conversion ─────────────────────────────────────────────────────

test("a mixed-currency portfolio totals in the base currency, not a raw sum", () => {
  // CA$10,000 of ENB.TO + US$10,000 of AAPL is CA$23,700 at 1.37, not 20,000.
  const r = comparePortfolios([
    portfolio(1, "Mixed", [pos("ENB.TO", 200, 50), pos("AAPL", 100, 100)], { currency: "CAD" }),
  ], rates("CAD", { CAD: 1, USD: 1.37 }));

  assert.equal(r.baseCurrency, "CAD");
  assert.equal(r.portfolios[0].totalValue, 23700);
  assert.equal(r.rows.find(x => x.symbol === "AAPL")!.cells["1"].value, 13700);
  assert.equal(r.rows.find(x => x.symbol === "ENB.TO")!.cells["1"].value, 10000);
});

test("weights use converted values, so a US holding is not understated", () => {
  const r = comparePortfolios([
    portfolio(1, "Mixed", [pos("ENB.TO", 200, 50), pos("AAPL", 100, 100)], { currency: "CAD" }),
  ], rates("CAD", { CAD: 1, USD: 1.37 }));

  // 13700 / 23700 — an unconverted sum would have called this a flat 50/50.
  assert.equal(r.rows.find(x => x.symbol === "AAPL")!.cells["1"].weightPct, 57.81);
  assert.equal(r.rows.find(x => x.symbol === "ENB.TO")!.cells["1"].weightPct, 42.19);
});

test("cost basis is converted too, so profit is not inflated by the rate", () => {
  const r = comparePortfolios([
    portfolio(1, "US", [pos("AAPL", 10, 100, 80)], { currency: "CAD" }),
  ], rates("CAD", { CAD: 1, USD: 1.37 }));

  const cell = r.rows[0].cells["1"];
  assert.equal(cell.value, 1370);
  assert.equal(cell.cost, 1096);          // 800 USD -> CAD
  assert.equal(cell.profit, 274);
  assert.equal(cell.profitPct, 25);       // same as the native 100 vs 80
});

test("cash is converted at its own account's currency", () => {
  const input: ComparePortfolioInput = {
    id: 1,
    name: "Mixed",
    color: "#000000",
    accounts: [
      { accountId: "a", accountName: "CAD acct", parentPortfolioId: "1", tradingEnabled: true, currency: "CAD", cash: 1000, positions: [] },
      { accountId: "b", accountName: "USD acct", parentPortfolioId: "1", tradingEnabled: true, currency: "USD", cash: 1000, positions: [] },
    ],
  };
  const r = comparePortfolios([input], rates("CAD", { CAD: 1, USD: 1.37 }));
  assert.equal(r.portfolios[0].cash, 2370);
});

test("price stays in the security's own currency because it feeds a trade order", () => {
  // Converting this would quote a CAD price for an order that executes in USD.
  const r = comparePortfolios([
    portfolio(1, "Core", [pos("AAPL", 1, 100)]),
    portfolio(2, "Other", []),
  ], rates("CAD", { CAD: 1, USD: 1.37 }));

  assert.equal(r.rows[0].price, 100);
  assert.equal(r.rows[0].priceCurrency, "USD");
  assert.equal(r.rows[0].cells["1"].value, 137);
});

test("each portfolio reports the native currencies it actually holds", () => {
  const r = comparePortfolios([
    portfolio(1, "Mixed", [pos("ENB.TO", 200, 50), pos("AAPL", 10, 100)], { currency: "CAD" }),
    portfolio(2, "CAD only", [pos("ENB.TO", 10, 50)], { currency: "CAD" }),
  ], rates("CAD", { CAD: 1, USD: 1.37 }));

  // Ordered by native value: CA$10,000 of ENB beats US$1,000 of AAPL.
  assert.deepEqual(r.portfolios[0].currencies, ["CAD", "USD"]);
  assert.deepEqual(r.portfolios[1].currencies, ["CAD"]);
});

test("currencies with no available rate are reported rather than silently counted 1:1", () => {
  const r = comparePortfolios([
    portfolio(1, "Core", [pos("AAPL", 1, 100)]),
  ], rates("CAD", { CAD: 1 }, ["USD"]));

  assert.deepEqual(r.fxUnresolved, ["USD"]);
});

test("nativeAmountsByCurrency buckets positions by symbol and cash by account", () => {
  const input: ComparePortfolioInput = {
    id: 1,
    name: "Mixed",
    color: "#000000",
    accounts: [
      // A CAD account holding a US-listed stock: the position is USD, the cash is CAD.
      { accountId: "a", accountName: "A", parentPortfolioId: "1", tradingEnabled: true, currency: "CAD", cash: 500, positions: [pos("AAPL", 10, 100), pos("ENB.TO", 10, 50)] },
    ],
  };

  const native = nativeAmountsByCurrency([input]);
  assert.equal(native.get("USD"), 1000);
  assert.equal(native.get("CAD"), 500 + 500);
});

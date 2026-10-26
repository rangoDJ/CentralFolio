import test from "node:test";
import assert from "node:assert/strict";
import { getCongressTrades } from "./congressTradingService.js";

test("getCongressTrades returns congress trades with party, chamber, and matches", () => {
  const trades = getCongressTrades();
  assert.ok(Array.isArray(trades));
  assert.ok(trades.length > 0);
  assert.ok(trades[0].politician);
  assert.ok(trades[0].ticker);
  assert.ok(typeof trades[0].isPortfolioMatch === "boolean");
  assert.ok(typeof trades[0].isWatchlistMatch === "boolean");
});

test("getCongressTrades filters by chamber and party", () => {
  const houseDems = getCongressTrades({ chamber: "House", party: "Democrat" });
  assert.ok(houseDems.length > 0);
  assert.ok(houseDems.every(t => t.chamber === "House" && t.party === "Democrat"));
});

test("getCongressTrades filters by transactionType", () => {
  const sales = getCongressTrades({ transactionType: "Sale" });
  assert.ok(sales.length > 0);
  assert.ok(sales.every(t => t.transactionType === "Sale"));
});

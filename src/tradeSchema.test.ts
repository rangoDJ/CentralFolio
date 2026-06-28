import { test } from "node:test";
import assert from "node:assert/strict";
import { tradeOrderSchema } from "./schemas/tradeSchema.js";

const base = {
  portfolioId: 1,
  accountId: "acc-1",
  ticker: "AAPL",
  action: "BUY",
  orderType: "Market",
  units: 10,
};

function err(body: any): string {
  const r = tradeOrderSchema.safeParse(body);
  assert.equal(r.success, false, "expected validation to fail");
  return (r as any).error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

test("accepts a valid market units order and normalizes ids/ticker", () => {
  const r = tradeOrderSchema.safeParse({ ...base, portfolioId: 7, ticker: "  vfv.to " });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.portfolioId, "7");      // coerced to string
    assert.equal(r.data.ticker, "vfv.to");       // trimmed
    assert.equal(r.data.units, 10);
  }
});

test("accepts a valid limit order with price", () => {
  const r = tradeOrderSchema.safeParse({ ...base, orderType: "Limit", price: 150.5 });
  assert.equal(r.success, true);
});

test("rejects when neither units nor notional provided", () => {
  const { units, ...rest } = base;
  assert.match(err(rest), /provide either units or notional_value/);
});

test("rejects when both units and notional provided", () => {
  assert.match(err({ ...base, notional_value: 100 }), /not both/);
});

test("rejects notional order that is not Market", () => {
  const { units, ...rest } = base;
  assert.match(err({ ...rest, orderType: "Limit", notional_value: 100, price: 5 }), /must use orderType Market/);
});

test("rejects Limit order without a price", () => {
  assert.match(err({ ...base, orderType: "Limit" }), /price is required for Limit orders/);
});

test("rejects non-positive units", () => {
  assert.match(err({ ...base, units: -5 }), /units/);
});

test("rejects invalid action and order type", () => {
  assert.match(err({ ...base, action: "HODL" }), /action/);
  assert.match(err({ ...base, orderType: "Stop" }), /orderType/);
});

test("rejects malformed ticker", () => {
  assert.match(err({ ...base, ticker: "BAD SYMBOL!!" }), /ticker/);
  assert.match(err({ ...base, ticker: "A".repeat(25) }), /ticker/);
});

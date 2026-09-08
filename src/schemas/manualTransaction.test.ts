import { test } from "node:test";
import assert from "node:assert/strict";
import { manualTransactionSchema } from "./manualTransactionSchema.js";

const base = { accountId: "acct-1", date: "2021-06-15" };

test("accepts a buy with units and price, deriving the total amount", () => {
  const r = manualTransactionSchema.safeParse({ ...base, type: "BUY", symbol: "enb.to", units: 100, price: 45.2 });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.symbol, "ENB.TO");   // normalized
    assert.equal(r.data.units, 100);
    assert.ok(Math.abs(r.data.amount! - 4520) < 1e-9);
  }
});

test("an explicit amount wins over units x price, because it includes commission", () => {
  const r = manualTransactionSchema.safeParse({
    ...base, type: "BUY", symbol: "ENB.TO", units: 100, price: 45.2, amount: 4529.95,
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.amount, 4529.95);
});

test("a unit-moving row with neither price nor amount is rejected", () => {
  // This is exactly the zero-cost-base row the feature exists to prevent.
  const r = manualTransactionSchema.safeParse({ ...base, type: "BUY", symbol: "ENB.TO", units: 100 });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(r.error.issues.map(i => i.message).join(" "), /cost base/);
  }
});

test("a trade without a symbol or units is rejected", () => {
  const noSymbol = manualTransactionSchema.safeParse({ ...base, type: "SELL", units: 10, price: 5 });
  assert.equal(noSymbol.success, false);
  const noUnits = manualTransactionSchema.safeParse({ ...base, type: "SELL", symbol: "ENB.TO", price: 5 });
  assert.equal(noUnits.success, false);
});

test("TRANSFER_OUT is stored with negative units so sideOf reads it as a disposal", () => {
  // t5008.sideOf takes direction from the sign of units for TRANSFER_* types,
  // not from the type name.
  const out = manualTransactionSchema.safeParse({ ...base, type: "TRANSFER_OUT", symbol: "ENB.TO", units: 40, price: 50 });
  assert.equal(out.success, true);
  if (out.success) assert.equal(out.data.units, -40);

  const inbound = manualTransactionSchema.safeParse({ ...base, type: "TRANSFER_IN", symbol: "ENB.TO", units: 40, price: 50 });
  assert.equal(inbound.success, true);
  if (inbound.success) assert.equal(inbound.data.units, 40);
});

test("cash types require an amount and need no symbol", () => {
  const ok = manualTransactionSchema.safeParse({ ...base, type: "DIVIDEND", amount: 88.75 });
  assert.equal(ok.success, true);

  const missing = manualTransactionSchema.safeParse({ ...base, type: "DIVIDEND" });
  assert.equal(missing.success, false);
});

test("only transaction types the downstream services understand are accepted", () => {
  // A free-text type would save a row that silently does nothing to cost base.
  assert.equal(manualTransactionSchema.safeParse({ ...base, type: "REBALANCE", amount: 1 }).success, false);
  assert.equal(manualTransactionSchema.safeParse({ ...base, type: "FEE", amount: 9.95 }).success, true);
});

test("rejects impossible calendar dates that a regex would accept", () => {
  assert.equal(manualTransactionSchema.safeParse({ ...base, date: "2024-02-31", type: "FEE", amount: 1 }).success, false);
  assert.equal(manualTransactionSchema.safeParse({ ...base, date: "15/06/2021", type: "FEE", amount: 1 }).success, false);
  assert.equal(manualTransactionSchema.safeParse({ ...base, date: "2024-02-29", type: "FEE", amount: 1 }).success, true);
});

test("negative quantities and prices are rejected", () => {
  assert.equal(manualTransactionSchema.safeParse({ ...base, type: "BUY", symbol: "X", units: -5, price: 1 }).success, false);
  assert.equal(manualTransactionSchema.safeParse({ ...base, type: "BUY", symbol: "X", units: 5, price: -1 }).success, false);
});

test("currency must be a 3-letter code", () => {
  assert.equal(manualTransactionSchema.safeParse({ ...base, type: "FEE", amount: 1, currencyCode: "cad" }).success, true);
  assert.equal(manualTransactionSchema.safeParse({ ...base, type: "FEE", amount: 1, currencyCode: "DOLLARS" }).success, false);
});

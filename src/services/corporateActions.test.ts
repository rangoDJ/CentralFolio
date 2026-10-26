import test from "node:test";
import assert from "node:assert/strict";
import {
  addCorporateAction,
  getAllCorporateActions,
  removeCorporateAction,
  applyCorporateActionsToTransactions
} from "./corporateActionService.js";

test("corporate actions lifecycle and transaction split adjustment", () => {
  const sym = `TESTSPLIT_${Date.now()}`;
  
  const created = addCorporateAction({
    symbol: sym,
    eventType: 'split',
    ratio: 4,
    date: '2026-06-01',
    notes: '4-for-1 forward split'
  });

  assert.equal(created.symbol, sym);
  assert.equal(created.ratio, 4);

  const list = getAllCorporateActions(sym);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);

  // Transactions before split date should have units x4 and price /4
  const txs = [
    { symbol: sym, date: '2026-01-15', units: 10, price: 100 },
    { symbol: sym, date: '2026-06-15', units: 40, price: 25 },
  ];

  const adjusted = applyCorporateActionsToTransactions(txs);
  assert.equal(adjusted[0].units, 40);
  assert.equal(adjusted[0].price, 25);
  // Transaction after split should remain unchanged
  assert.equal(adjusted[1].units, 40);
  assert.equal(adjusted[1].price, 25);

  const deleted = removeCorporateAction(created.id);
  assert.equal(deleted, true);

  const listAfter = getAllCorporateActions(sym);
  assert.equal(listAfter.length, 0);
});

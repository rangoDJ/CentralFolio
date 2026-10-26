import test from "node:test";
import assert from "node:assert/strict";
import {
  getAllCompositePortfolios,
  addCompositePortfolio,
  removeCompositePortfolio,
  cloneUserPortfolio
} from "./compositePortfolioService.js";

test("getAllCompositePortfolios and addCompositePortfolio manage composite portfolios", () => {
  const initial = getAllCompositePortfolios();
  assert.ok(Array.isArray(initial));

  const created = addCompositePortfolio("Test Composite", "Testing composite portfolios", "#10b981", []);
  assert.ok(created);
  assert.equal(created.name, "Test Composite");
  assert.equal(created.color, "#10b981");

  const afterAdd = getAllCompositePortfolios();
  assert.ok(afterAdd.some(p => p.id === created.id));

  const removed = removeCompositePortfolio(created.id);
  assert.equal(removed, true);

  const afterRemove = getAllCompositePortfolios();
  assert.ok(!afterRemove.some(p => p.id === created.id));
});

test("addCompositePortfolio throws on empty name", () => {
  assert.throws(() => {
    addCompositePortfolio("   ");
  }, /cannot be empty/);
});

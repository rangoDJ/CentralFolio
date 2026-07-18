import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeManualAssets } from "./services/manualAssetService.js";
import { manualAssetSchema } from "./schemas/manualAssetSchema.js";

test("summarizeManualAssets: aggregates by category and currency in one base currency", async () => {
  const summary = await summarizeManualAssets([
    { category: "Real Estate", value: 500000, currency: "CAD" },
    { category: "Real Estate", value: 100000, currency: "CAD" },
    { category: "Crypto", value: 20000, currency: "CAD" },
  ]);

  assert.equal(summary.baseCurrency, "CAD");
  assert.equal(summary.count, 3);
  assert.equal(summary.totalValueBase, 620000);

  const realEstate = summary.byCategory.find(c => c.key === "Real Estate");
  assert.equal(realEstate?.value, 600000);
  assert.ok(Math.abs((realEstate?.pct ?? 0) - (600000 / 620000) * 100) < 0.001);

  const cad = summary.byCurrency.find(c => c.key === "CAD");
  assert.equal(cad?.value, 620000);
  assert.equal(cad?.pct, 100);
});

test("summarizeManualAssets: dominant currency by native total becomes the base", async () => {
  const summary = await summarizeManualAssets([
    { category: "Other", value: 100, currency: "USD" },
    { category: "Other", value: 50, currency: "CAD" },
  ]);
  assert.equal(summary.baseCurrency, "USD");
});

test("summarizeManualAssets: empty input", async () => {
  const summary = await summarizeManualAssets([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.totalValueBase, 0);
  assert.deepEqual(summary.byCategory, []);
  assert.deepEqual(summary.byCurrency, []);
});

test("manualAssetSchema: accepts a valid asset and applies defaults", () => {
  const r = manualAssetSchema.safeParse({ name: "Cottage", value: "250000" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.category, "Other");
    assert.equal(r.data.currency, "CAD");
    assert.equal(r.data.value, 250000);
  }
});

test("manualAssetSchema: rejects negative value and empty name", () => {
  assert.equal(manualAssetSchema.safeParse({ name: "", value: 100 }).success, false);
  assert.equal(manualAssetSchema.safeParse({ name: "Car", value: -1 }).success, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// dividendService imports models/db.js, which opens the real (singleton)
// SQLite DB at DATA_DIR on first import — point it at a throwaway directory
// before importing so this test never touches the real snaptrade.db.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-dividendservice-test-"));

const { snowballAssetSchema } = await import("./dividendService.js");

test("snowballAssetSchema: accepts a well-formed asset payload", () => {
  const r = snowballAssetSchema.safeParse({
    ticker: "ACME.TO",
    description: "Acme Corp",
    divCurrency: "CAD",
    currentPrice: 42.5,
    divPerYearFWD: 2.4,
    divFrequency: 4,
    exDividendDate: "2026-01-15T00:00:00.000Z",
  });
  assert.equal(r.success, true);
});

test("snowballAssetSchema: passes through fields it doesn't know about", () => {
  const r = snowballAssetSchema.safeParse({
    ticker: "ACME.TO",
    someBrandNewFieldSnowballAddedLater: { nested: true },
  });
  assert.equal(r.success, true);
  if (r.success) {
    assert.deepEqual((r.data as any).someBrandNewFieldSnowballAddedLater, { nested: true });
  }
});

test("snowballAssetSchema: null is accepted for optional numeric/string fields", () => {
  const r = snowballAssetSchema.safeParse({
    ticker: "ACME.TO",
    currentPrice: null,
    divCurrency: null,
    exDividendDate: null,
  });
  assert.equal(r.success, true);
});

test("snowballAssetSchema: rejects a numeric field that arrives as the wrong type", () => {
  // Guards against consuming a malformed/renumbered upstream field as a number
  // downstream (e.g. NaN leaking into dividend math).
  const r = snowballAssetSchema.safeParse({
    ticker: "ACME.TO",
    divPerYearFWD: "not-a-number",
  });
  assert.equal(r.success, false);
});

test("snowballAssetSchema: rejects a string field that arrives as an object", () => {
  const r = snowballAssetSchema.safeParse({
    ticker: { unexpected: "shape" },
  });
  assert.equal(r.success, false);
});

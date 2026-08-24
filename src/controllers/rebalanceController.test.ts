import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { Request, Response } from "express";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-rebalance-ctrl-test-"));

const { updateTargets } = await import("./rebalanceController.js");

function mockRes() {
  const res: Partial<Response> & { statusCode: number; body: any } = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res as Response; };
  res.json = (body: any) => { res.body = body; return res as Response; };
  return res as Response & { statusCode: number; body: any };
}

test("updateTargets: a non-string symbol is rejected as 400, not a 500 from a downstream crash", () => {
  // Number.prototype has no toUpperCase — before the type guard, RegExp#test's
  // implicit ToString coercion let a numeric symbol slip past validation and
  // crash later on `t.symbol.toUpperCase()`, surfacing as a generic 500.
  const res = mockRes();
  updateTargets(
    { params: { id: "1" }, body: [{ symbol: 5, targetPct: 1 }] } as unknown as Request,
    res
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Invalid symbol/);
});

test("updateTargets: a valid string symbol still passes validation (no regression)", () => {
  const res = mockRes();
  updateTargets(
    { params: { id: "1" }, body: [{ symbol: "AAA", targetPct: 1 }] } as unknown as Request,
    res
  );
  // No such user-portfolio exists in this throwaway DB, so it 404s downstream —
  // proving the symbol validation itself passed rather than rejecting a valid input.
  assert.equal(res.statusCode, 404);
});

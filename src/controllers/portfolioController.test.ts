import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { Request, Response } from "express";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-portfolio-ctrl-test-"));

const { createOrUpdatePortfolio, getPortfolios } = await import("./portfolioController.js");

function mockRes() {
  const res: Partial<Response> & { statusCode: number; body: any } = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res as Response; };
  res.json = (body: any) => { res.body = body; return res as Response; };
  return res as Response & { statusCode: number; body: any };
}

const validBody = { name: "Test", clientId: "c1", consumerKey: "k1", userId: "u1" };

test("createOrUpdatePortfolio: a non-numeric id is rejected with 400, not silently inserted", () => {
  // Number("abc") is NaN, and NaN is falsy — an unguarded `id ? Number(id) : undefined`
  // let a malformed id fall through to the insert branch instead of failing.
  const before = mockRes();
  getPortfolios({} as Request, before);
  const countBefore = before.body.length;

  const res = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, id: "abc" } } as Request, res);
  assert.equal(res.statusCode, 400);

  const after = mockRes();
  getPortfolios({} as Request, after);
  assert.equal(after.body.length, countBefore, "no row should have been inserted");
});

test("createOrUpdatePortfolio: creates a new portfolio when id is omitted", () => {
  const res = mockRes();
  createOrUpdatePortfolio({ body: validBody } as Request, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.id);
});

test("createOrUpdatePortfolio: updates the existing row when a valid numeric id is given", () => {
  const create = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, name: "Original" } } as Request, create);
  const id = create.body.id;

  const update = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, id, name: "Renamed" } } as Request, update);
  assert.equal(update.statusCode, 200);
  assert.equal(update.body.id, id, "same id, not a new row");
});

test("createOrUpdatePortfolio: rejects a zero/negative id", () => {
  const res = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, id: 0 } } as Request, res);
  assert.equal(res.statusCode, 400);

  const res2 = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, id: -1 } } as Request, res2);
  assert.equal(res2.statusCode, 400);
});

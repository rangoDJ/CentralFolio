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

test("createOrUpdatePortfolio: editing credentials rebuilds the SnapTrade client", async () => {
  // The client cache is keyed by portfolio id, so without eviction the client
  // built from the original consumerKey survives the edit and keeps signing
  // requests with the superseded key — registration then fails forever.
  const { getSnapTradeClientForPortfolio } = await import("../services/snaptrade.js");

  const created = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, name: "Rotating", clientId: "c-old", consumerKey: "k-old" } } as Request, created);
  const id = created.body.id;

  const first = getSnapTradeClientForPortfolio(id);

  const updated = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, id, name: "Rotating", clientId: "c-new", consumerKey: "k-new" } } as Request, updated);
  assert.equal(updated.statusCode, 200);

  assert.notEqual(getSnapTradeClientForPortfolio(id), first, "a new client must be built after a credential change");
});

test("createOrUpdatePortfolio: credentials are stored trimmed", async () => {
  // A pasted consumerKey carrying a trailing newline breaks SnapTrade's request
  // signature ("Unable to verify signature sent") while looking correct in the form.
  const { getPortfolio } = await import("../models/db.js");

  const res = mockRes();
  createOrUpdatePortfolio({
    body: { name: " Padded ", clientId: " c-pad\n", consumerKey: "k-pad \t", userId: "\nu-pad " },
  } as Request, res);
  assert.equal(res.statusCode, 200);

  const saved = getPortfolio(res.body.id)!;
  assert.equal(saved.clientId, "c-pad");
  assert.equal(saved.consumerKey, "k-pad");
  assert.equal(saved.userId, "u-pad");
  assert.equal(saved.name, "Padded");
});

test("createOrUpdatePortfolio: a whitespace-only credential is rejected, not stored blank", () => {
  const res = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, consumerKey: "   " } } as Request, res);
  assert.equal(res.statusCode, 400);
});

test("createOrUpdatePortfolio: an edit that omits consumerKey keeps the stored key", async () => {
  // The key is stripped before portfolios are sent to the client, so the edit
  // form has nothing to echo back. A blank one must mean "unchanged" — treating
  // it as "erase" destroyed the credential that signs every SnapTrade request.
  const { getPortfolio } = await import("../models/db.js");

  const created = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, name: "Keeps", consumerKey: "real-secret" } } as Request, created);
  const id = created.body.id;

  const edited = mockRes();
  createOrUpdatePortfolio({ body: { id, name: "Renamed", clientId: "c1", userId: "u1" } } as Request, edited);
  assert.equal(edited.statusCode, 200);

  const saved = getPortfolio(id)!;
  assert.equal(saved.name, "Renamed");
  assert.equal(saved.consumerKey, "real-secret", "the stored key must survive an unrelated edit");
});

test("createOrUpdatePortfolio: a supplied consumerKey still replaces the stored one", async () => {
  const { getPortfolio } = await import("../models/db.js");

  const created = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, name: "Rotates", consumerKey: "old-secret" } } as Request, created);
  const id = created.body.id;

  const edited = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, id, name: "Rotates", consumerKey: "new-secret" } } as Request, edited);
  assert.equal(edited.statusCode, 200);
  assert.equal(getPortfolio(id)!.consumerKey, "new-secret");
});

test("createOrUpdatePortfolio: a new portfolio still requires a consumerKey", () => {
  const res = mockRes();
  createOrUpdatePortfolio({ body: { name: "No key", clientId: "c1", userId: "u1" } } as Request, res);
  assert.equal(res.statusCode, 400);
});

test("createOrUpdatePortfolio: an edit against a missing portfolio is a 404", () => {
  const res = mockRes();
  createOrUpdatePortfolio({ body: { ...validBody, id: 999999 } } as Request, res);
  assert.equal(res.statusCode, 404);
});

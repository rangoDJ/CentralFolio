import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { Request, Response } from "express";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-apitoken-ctrl-test-"));

const { getApiTokens, postApiToken, deleteApiToken } = await import("./apiTokenController.js");

/** Minimal Request/Response doubles — no need for a real HTTP server or supertest. */
function mockRes() {
  const res: Partial<Response> & { statusCode: number; body: any } = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res as Response; };
  res.json = (body: any) => { res.body = body; return res as Response; };
  return res as Response & { statusCode: number; body: any };
}

test("postApiToken: rejects a missing/blank name with 400, does not create anything", () => {
  const res = mockRes();
  postApiToken({ body: {} } as Request, res);
  assert.equal(res.statusCode, 400);

  const res2 = mockRes();
  postApiToken({ body: { name: "   " } } as Request, res2);
  assert.equal(res2.statusCode, 400);

  const list = mockRes();
  getApiTokens({} as Request, list);
  assert.deepEqual(list.body, []);
});

test("postApiToken: trims and caps the name at 100 characters", () => {
  const longName = "x".repeat(200);
  const res = mockRes();
  postApiToken({ body: { name: `  ${longName}  ` } } as Request, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.name.length, 100);
  assert.equal(res.body.name, "x".repeat(100));
  assert.ok(res.body.token.startsWith("cf_"));
});

test("postApiToken -> getApiTokens -> deleteApiToken: full lifecycle through the HTTP layer", () => {
  const create = mockRes();
  postApiToken({ body: { name: "lifecycle" } } as Request, create);
  assert.equal(create.statusCode, 201);
  const id = create.body.id;

  const list = mockRes();
  getApiTokens({} as Request, list);
  assert.ok(list.body.some((t: any) => t.id === id));

  const del = mockRes();
  deleteApiToken({ params: { id } } as unknown as Request, del);
  assert.deepEqual(del.body, { success: true });

  const listAfter = mockRes();
  getApiTokens({} as Request, listAfter);
  assert.ok(!listAfter.body.some((t: any) => t.id === id));
});

test("deleteApiToken: unknown id returns 404", () => {
  const res = mockRes();
  deleteApiToken({ params: { id: "nope" } } as unknown as Request, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Token not found" });
});

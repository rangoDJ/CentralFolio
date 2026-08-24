import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// The db module is a singleton opened at import time from DATA_DIR, so it must
// be set before the first import — a dynamic import (not hoisted, unlike a
// static one) lets us point it at a throwaway directory for this file's
// isolated test-runner process.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-apitoken-test-"));

const { createApiToken, listApiTokens, revokeApiToken, verifyApiToken, API_TOKEN_PREFIX } =
  await import("./apiTokenRepository.js");

test("createApiToken: returns a prefixed plaintext token and persists only its hash", () => {
  const created = createApiToken("CI script");
  assert.ok(created.token.startsWith(API_TOKEN_PREFIX));
  assert.equal(created.name, "CI script");
  assert.ok(created.id);

  const listed = listApiTokens();
  const meta = listed.find(t => t.id === created.id);
  assert.ok(meta, "token metadata is listed");
  assert.equal(meta!.name, "CI script");
  assert.equal(meta!.lastUsedAt, null, "unused token has no lastUsedAt yet");
  // Metadata never carries the plaintext or the hash.
  assert.ok(!("token" in meta!));
  assert.ok(!("tokenHash" in meta!));
});

test("verifyApiToken: accepts a freshly created token and records last-used", () => {
  const created = createApiToken("verify-me");
  assert.equal(verifyApiToken(created.token), true);

  const meta = listApiTokens().find(t => t.id === created.id)!;
  assert.ok(meta.lastUsedAt, "verifying a token stamps lastUsedAt");
});

test("verifyApiToken: rejects an unknown token", () => {
  assert.equal(verifyApiToken(`${API_TOKEN_PREFIX}${"0".repeat(64)}`), false);
  assert.equal(verifyApiToken("not-even-the-right-shape"), false);
});

test("revokeApiToken: removes the token so it no longer verifies", () => {
  const created = createApiToken("to-revoke");
  assert.equal(verifyApiToken(created.token), true);

  assert.equal(revokeApiToken(created.id), true);
  assert.equal(verifyApiToken(created.token), false, "revoked token must be rejected");
  assert.ok(!listApiTokens().some(t => t.id === created.id));
});

test("revokeApiToken: revoking an already-gone id is reported, not thrown", () => {
  assert.equal(revokeApiToken("does-not-exist"), false);
});

test("two tokens for the same name get distinct, unlinkable plaintexts", () => {
  const a = createApiToken("dup-name");
  const b = createApiToken("dup-name");
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.id, b.id);
  assert.equal(verifyApiToken(a.token), true);
  assert.equal(verifyApiToken(b.token), true);
});

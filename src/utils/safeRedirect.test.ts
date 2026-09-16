import { test } from "node:test";
import assert from "node:assert/strict";
import { safeRedirect } from "./safeRedirect.js";

const req = { hostname: "folio.example.com" };

test("accepts a same-host http(s) URL", () => {
  assert.equal(
    safeRedirect(req, "https://folio.example.com/?snaptrade=connected&portfolioId=3"),
    "https://folio.example.com/?snaptrade=connected&portfolioId=3",
  );
  assert.equal(safeRedirect(req, "http://folio.example.com:3000/"), "http://folio.example.com:3000/");
});

test("rejects a foreign host", () => {
  assert.equal(safeRedirect(req, "https://evil.example.net/"), undefined);
  assert.equal(safeRedirect(req, "https://folio.example.com.evil.net/"), undefined);
});

test("rejects non-http schemes", () => {
  assert.equal(safeRedirect(req, "javascript:alert(1)"), undefined);
  assert.equal(safeRedirect(req, "ftp://folio.example.com/"), undefined);
});

test("rejects missing or malformed input", () => {
  assert.equal(safeRedirect(req, undefined), undefined);
  assert.equal(safeRedirect(req, ""), undefined);
  assert.equal(safeRedirect(req, "not a url"), undefined);
  assert.equal(safeRedirect(req, 42), undefined);
});

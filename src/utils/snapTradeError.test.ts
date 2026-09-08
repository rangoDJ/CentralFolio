import { test } from "node:test";
import assert from "node:assert/strict";
import { snapTradeError } from "./snapTradeError.js";

test("extracts the upstream detail for the log, not for the client", () => {
  const err = { status: 404, responseBody: { detail: "The requested resource does not exist." } };
  const r = snapTradeError(err, "Failed to generate forecast");
  assert.equal(r.log, "The requested resource does not exist.");
  assert.equal(r.client, "Failed to generate forecast", "upstream detail must not leak to the client");
});

test("an upstream 4xx is a bad gateway, not our own 500", () => {
  // Answering 500 told the caller "this server is broken" when the real cause
  // was an expired connection or an unknown symbol upstream.
  for (const status of [400, 403, 404, 409]) {
    assert.equal(snapTradeError({ status }, "x").status, 502, `upstream ${status}`);
  }
});

test("an upstream 401 must NOT become our 401", () => {
  // The browser client treats 401 as "session expired" and redirects to the
  // login page, so propagating it would log the user out of CentralFolio
  // because their *brokerage* credentials went stale.
  assert.equal(snapTradeError({ status: 401 }, "x").status, 502);
});

test("a rate limit propagates so callers can back off", () => {
  assert.equal(snapTradeError({ status: 429 }, "x").status, 429);
});

test("an upstream 5xx is still a bad gateway", () => {
  assert.equal(snapTradeError({ status: 503 }, "x").status, 502);
});

test("a failure with no upstream response stays a 500", () => {
  // A bug in our own code, or a connection that never landed.
  assert.equal(snapTradeError(new Error("boom"), "x").status, 500);
  assert.equal(snapTradeError({}, "x").status, 500);
});

test("reads the status from either SDK error shape", () => {
  assert.equal(snapTradeError({ status: 429 }, "x").upstreamStatus, 429);
  assert.equal(snapTradeError({ response: { status: 404 } }, "x").upstreamStatus, 404);
  assert.equal(snapTradeError({ message: "network down" }, "x").upstreamStatus, null);
});

test("falls back through detail, message, then the error's own message", () => {
  assert.equal(snapTradeError({ responseBody: { detail: "d" } }, "x").log, "d");
  assert.equal(snapTradeError({ responseBody: { message: "m" } }, "x").log, "m");
  assert.equal(snapTradeError({ message: "e" }, "x").log, "e");
  assert.equal(snapTradeError({}, "x").log, "unknown error");
});

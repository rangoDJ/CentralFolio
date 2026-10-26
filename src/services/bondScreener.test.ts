import test from "node:test";
import assert from "node:assert/strict";
import { screenBonds } from "./bondScreenerService.js";

test("screenBonds returns all bonds when no filters applied", () => {
  const all = screenBonds();
  assert.ok(Array.isArray(all));
  assert.ok(all.length >= 5);
});

test("screenBonds filters by search text", () => {
  const filtered = screenBonds({ search: "Treasury" });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every(b => b.name.includes("Treasury") || b.issuer.includes("Treasury")));
});

test("screenBonds filters by issuerType and couponType", () => {
  const govFixed = screenBonds({ issuerType: "Government", couponType: "Fixed" });
  assert.ok(govFixed.length > 0);
  assert.ok(govFixed.every(b => b.issuerType === "Government" && b.couponType === "Fixed"));
});

test("screenBonds filters by minYtm and maxDuration", () => {
  const filtered = screenBonds({ minYtm: 4.0, maxDuration: 6.0 });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every(b => b.yieldToMaturityPct >= 4.0 && b.durationYears <= 6.0));
});

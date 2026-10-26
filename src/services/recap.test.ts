import test from "node:test";
import assert from "node:assert/strict";
import { generateAnnualRecap } from "./recapService.js";

test("generateAnnualRecap returns expected metrics structure and fun facts", () => {
  const recap = generateAnnualRecap(2025);
  assert.ok(recap);
  assert.equal(recap.year, 2025);
  assert.ok(recap.portfolio);
  assert.ok(typeof recap.portfolio.valueChangePct === "number");
  assert.ok(recap.dividends);
  assert.ok(typeof recap.dividends.funFacts.ramenPacksPerWeek === "number");
  assert.ok(typeof recap.dividends.funFacts.goldOuncesEquivalent === "number");
  assert.ok(recap.trading);
});

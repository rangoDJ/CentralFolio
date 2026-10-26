import test from "node:test";
import assert from "node:assert/strict";
import { computeDividendSafety } from "./dividendSafetyService.js";
import { upsertDividendHistory, deleteDividendHistory } from "../repositories/dividendHistoryRepository.js";

test("dividend safety score and surprise percentage", () => {
  const sym = `SAFEDIV_${Date.now()}`;

  upsertDividendHistory(sym, [
    { exDate: '2025-03-01', amount: 1.00 },
    { exDate: '2025-06-01', amount: 1.00 },
    { exDate: '2025-09-01', amount: 1.00 },
    { exDate: '2025-12-01', amount: 1.10 },
  ]);

  const report = computeDividendSafety(sym);
  assert.equal(report.symbol, sym);
  assert.equal(report.latestPayout, 1.10);
  assert.equal(report.previousPayout, 1.00);
  assert.equal(report.dividendSurprisePct, 10.0);
  assert.ok(report.score >= 70);
  assert.ok(['Very Safe', 'Safe'].includes(report.safetyTier));

  deleteDividendHistory(sym);
});

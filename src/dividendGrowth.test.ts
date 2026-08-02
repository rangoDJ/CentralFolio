import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDividendGrowth, bestDgr, type DividendPayment } from "./services/dividendGrowth.js";

const NOW = new Date("2026-06-27T00:00:00Z");

// Build quarterly payments for a set of years, each year summing to `annual[year]`.
function quarterly(annualByYear: Record<number, number>): DividendPayment[] {
  const out: DividendPayment[] = [];
  for (const [yearStr, annual] of Object.entries(annualByYear)) {
    const per = annual / 4;
    for (const m of ["03", "06", "09", "12"]) {
      out.push({ exDate: `${yearStr}-${m}-15`, amount: per });
    }
  }
  return out;
}

test("empty input yields empty metrics", () => {
  const m = computeDividendGrowth([], NOW);
  assert.equal(m.yearsOfData, 0);
  assert.equal(m.dgr5y, null);
  assert.equal(m.growthStreakYears, 0);
  assert.equal(bestDgr(m), null);
});

test("excludes the in-progress current year from annual totals", () => {
  const m = computeDividendGrowth(quarterly({ 2024: 4, 2025: 4, 2026: 99 }), NOW);
  assert.deepEqual(m.annualTotals.map(a => a.year), [2024, 2025]);
});

test("computes 1y CAGR from the two most recent complete years", () => {
  // 2024 → 2025 grew 4.00 → 4.40 = +10%
  const m = computeDividendGrowth(quarterly({ 2024: 4, 2025: 4.4, 2026: 1 }), NOW);
  assert.ok(m.dgr1y !== null);
  assert.ok(Math.abs((m.dgr1y as number) - 0.10) < 1e-9);
});

test("computes 5y CAGR over a five-year window", () => {
  // 2020: 2.00 → 2025: 4.00 over 5 complete-year steps ⇒ 2^(1/5)-1 ≈ 0.1487
  const m = computeDividendGrowth(
    quarterly({ 2020: 2, 2021: 2.2, 2022: 2.6, 2023: 3, 2024: 3.5, 2025: 4, 2026: 1 }),
    NOW
  );
  assert.ok(m.dgr5y !== null);
  assert.ok(Math.abs((m.dgr5y as number) - (Math.pow(2, 1 / 5) - 1)) < 1e-9);
  assert.equal(bestDgr(m), m.dgr5y);
});

test("growth streak counts consecutive non-decreasing years and breaks on a cut", () => {
  // totals: 2021:3, 2022:2 (cut), 2023:3, 2024:4, 2025:5  → streak from end = 3
  const m = computeDividendGrowth(quarterly({ 2021: 3, 2022: 2, 2023: 3, 2024: 4, 2025: 5, 2026: 1 }), NOW);
  assert.equal(m.growthStreakYears, 3);
});

test("returns null DGR when the base year is zero", () => {
  const m = computeDividendGrowth(
    [{ exDate: "2025-03-15", amount: 1 }, { exDate: "2024-03-15", amount: 0 }],
    NOW
  );
  assert.equal(m.dgr1y, null);
});

test("a suspended year with no payments does not get annualized over the gap", () => {
  // 2022 paid, 2023 suspended (no payments at all, so no annualTotals entry),
  // 2024 resumed. 1y CAGR must NOT compare 2024 against 2022 as if it were a
  // single year — that would report a wildly inflated growth rate.
  const m = computeDividendGrowth(quarterly({ 2022: 4, 2024: 4.4, 2026: 1 }), NOW);
  assert.deepEqual(m.annualTotals.map(a => a.year), [2022, 2024]);
  assert.equal(m.dgr1y, null, "no 2023 entry to serve as the 1y-back base");
});

test("3y CAGR skips over a suspended year only when the exact start year exists", () => {
  // 2021 paid, 2022 suspended, 2023 resumed, 2024 grew. A 3y window from 2024
  // needs a 2021 entry, which does exist here, so it should compute normally
  // even though 2022 is missing in between.
  const m = computeDividendGrowth(
    quarterly({ 2021: 2, 2023: 2, 2024: 2.2, 2026: 1 }),
    NOW
  );
  assert.ok(m.dgr3y !== null);
  assert.ok(Math.abs((m.dgr3y as number) - (Math.pow(2.2 / 2, 1 / 3) - 1)) < 1e-9);
});

test("growth streak breaks across a suspended (missing) year instead of comparing across it", () => {
  // 2021:3, 2022 suspended (no entry), 2023:4, 2024:5 — even though 4 -> 5 is
  // non-decreasing, the streak must not bridge the missing 2022.
  const m = computeDividendGrowth(quarterly({ 2021: 3, 2023: 4, 2024: 5, 2026: 1 }), NOW);
  assert.equal(m.growthStreakYears, 1, "only 2023 -> 2024 is a consecutive non-decreasing pair");
});

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

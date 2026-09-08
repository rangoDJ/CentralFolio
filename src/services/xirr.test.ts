import { test } from "node:test";
import assert from "node:assert/strict";
import { xirr, buildPortfolioFlows } from "./xirr.js";

/** Assert a rate matches to within 0.01 percentage points. */
function assertRate(actual: number | null, expected: number, label = "") {
  assert.ok(actual !== null, `expected a rate, got null ${label}`);
  assert.ok(
    Math.abs(actual! - expected) < 0.0001,
    `expected ~${expected}, got ${actual} ${label}`,
  );
}

test("a doubling over exactly one year is 100%", () => {
  assertRate(xirr([
    { date: "2025-01-01", amount: -1000 },
    { date: "2026-01-01", amount: 2000 },
  ]), 1.0);
});

test("a flat return over one year is 0%", () => {
  assertRate(xirr([
    { date: "2025-01-01", amount: -1000 },
    { date: "2026-01-01", amount: 1000 },
  ]), 0);
});

test("10% over one year", () => {
  assertRate(xirr([
    { date: "2025-01-01", amount: -1000 },
    { date: "2026-01-01", amount: 1100 },
  ]), 0.1);
});

test("a half-year 10% gain annualizes to about 21%", () => {
  // (1.1)^2 - 1 = 0.21 — this is the whole point of a money-weighted return.
  const r = xirr([
    { date: "2024-01-01", amount: -1000 },
    { date: "2024-07-01", amount: 1100 },
  ]);
  assert.ok(r !== null && r > 0.20 && r < 0.22, `expected ~21%, got ${r}`);
});

test("a loss produces a negative rate", () => {
  assertRate(xirr([
    { date: "2025-01-01", amount: -1000 },
    { date: "2026-01-01", amount: 750 },
  ]), -0.25);
});

test("timing matters: late money earns a higher rate than the same simple return implies", () => {
  // Both series put in 2000 and end at 2200 — a 10% simple return. But the
  // second contribution arrives late in the year in the second series, so the
  // capital was at work for less time and the money-weighted rate is higher.
  const early = xirr([
    { date: "2024-01-01", amount: -1000 },
    { date: "2024-02-01", amount: -1000 },
    { date: "2025-01-01", amount: 2200 },
  ])!;
  const late = xirr([
    { date: "2024-01-01", amount: -1000 },
    { date: "2024-11-01", amount: -1000 },
    { date: "2025-01-01", amount: 2200 },
  ])!;
  assert.ok(late > early, `late (${late}) should exceed early (${early})`);
});

test("handles many irregular contributions", () => {
  const flows = [
    { date: "2022-03-14", amount: -5000 },
    { date: "2022-07-02", amount: -1200 },
    { date: "2023-01-19", amount: -800 },
    { date: "2023-09-30", amount: 500 },     // a partial sale
    { date: "2024-05-05", amount: -2000 },
    { date: "2025-06-01", amount: 10500 },
  ];
  const r = xirr(flows);
  assert.ok(r !== null, "should solve");
  // Verify by substitution: the NPV at the returned rate must be ~0.
  const start = "2022-03-14";
  const npv = flows.reduce((sum, f) => {
    const days = (Date.parse(f.date + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000;
    return sum + f.amount / Math.pow(1 + r!, days / 365);
  }, 0);
  assert.ok(Math.abs(npv) < 0.01, `NPV at solved rate should be ~0, got ${npv}`);
});

test("uses an ACT/365 year, so a leap-year span is fractionally under the round rate", () => {
  // 2024-01-01 -> 2025-01-01 is 366 days: 1.1^(365/366) - 1, not exactly 10%.
  // Excel's XIRR uses the same convention. Pinned so it is never "fixed".
  const r = xirr([
    { date: "2024-01-01", amount: -1000 },
    { date: "2025-01-01", amount: 1100 },
  ])!;
  assert.ok(Math.abs(r - (Math.pow(1.1, 365 / 366) - 1)) < 1e-6, `got ${r}`);
  assert.ok(r < 0.1 && r > 0.0995, `should sit just under 10%, got ${r}`);
});

test("returns null rather than a wrong number when it is undefined", () => {
  assert.equal(xirr([]), null, "no flows");
  assert.equal(xirr([{ date: "2024-01-01", amount: -1000 }]), null, "single flow");
  assert.equal(
    xirr([{ date: "2024-01-01", amount: -1000 }, { date: "2024-01-01", amount: 1100 }]),
    null,
    "same-day flows have no elapsed time to annualize over",
  );
  assert.equal(
    xirr([{ date: "2024-01-01", amount: -1000 }, { date: "2025-01-01", amount: -500 }]),
    null,
    "all outflows — no rate makes them sum to zero",
  );
  assert.equal(
    xirr([{ date: "2024-01-01", amount: 1000 }, { date: "2025-01-01", amount: 500 }]),
    null,
    "all inflows",
  );
});

test("survives a total loss without diverging below -100%", () => {
  const r = xirr([
    { date: "2024-01-01", amount: -1000 },
    { date: "2025-01-01", amount: 0.01 },
  ]);
  assert.ok(r === null || r > -1, `rate must stay above -100%, got ${r}`);
});

test("zero-amount and malformed rows are ignored, not fatal", () => {
  assertRate(xirr([
    { date: "2025-01-01", amount: -1000 },
    { date: "not-a-date", amount: -999 },
    { date: "2025-06-01", amount: 0 },
    { date: "2026-01-01", amount: 1100 },
  ]), 0.1);
});

test("flows need not be supplied in date order", () => {
  assertRate(xirr([
    { date: "2026-01-01", amount: 1100 },
    { date: "2025-01-01", amount: -1000 },
  ]), 0.1);
});

// ── buildPortfolioFlows ─────────────────────────────────────────────────────

test("buildPortfolioFlows negates contributions into XIRR's sign convention", () => {
  // The app's "net invested" line counts a buy as positive; XIRR needs it
  // negative (money left your pocket).
  const flows = buildPortfolioFlows(
    [{ date: "2024-01-01", amount: 1000 }, { date: "2024-06-01", amount: -200 }],
    1100,
    "2025-01-01",
  );
  assert.deepEqual(flows, [
    { date: "2024-01-01", amount: -1000 },
    { date: "2024-06-01", amount: 200 },
    { date: "2025-01-01", amount: 1100 },
  ]);
});

test("buildPortfolioFlows drops zero contributions and a zero terminal value", () => {
  const flows = buildPortfolioFlows([{ date: "2024-01-01", amount: 0 }], 0, "2025-01-01");
  assert.deepEqual(flows, []);
});

test("end to end: a portfolio bought once and up 10% a year later", () => {
  const flows = buildPortfolioFlows([{ date: "2025-01-01", amount: 1000 }], 1100, "2026-01-01");
  assertRate(xirr(flows), 0.1);
});

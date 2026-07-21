import test from "node:test";
import assert from "node:assert/strict";
import { computeCarryingCharges, type CCTransaction, type CCFxLookup } from "./services/carryingCharges.js";

const par: CCFxLookup = () => 1;
const table = (rates: Record<string, number>): CCFxLookup =>
  (currency, date) => (currency === "CAD" ? 1 : rates[date] ?? null);

const charge = (type: string, date: string, amount: number, extra: Partial<CCTransaction> = {}): CCTransaction =>
  ({ type, action: type, date, amount, account: "Margin", accountId: "a", registered: false, ...extra });

test("negative interest is a carrying charge", () => {
  const r = computeCarryingCharges([charge("INTEREST", "2025-03-31", -125.40)], par);

  assert.equal(r.charges.length, 1);
  assert.equal(r.charges[0].kind, "interest");
  assert.equal(r.charges[0].amount, 125.40, "reported as a positive expense");
  assert.equal(r.totalInterest, 125.40);
  assert.equal(r.total, 125.40);
});

test("interest RECEIVED is income, not a carrying charge", () => {
  const r = computeCarryingCharges([charge("INTEREST", "2025-03-31", 250)], par);

  assert.equal(r.charges.length, 0);
  assert.equal(r.total, 0);
  assert.ok(r.warnings.some(w => w.includes("RECEIVED")), "explains why it was excluded");
});

test("a mix of paid and received interest keeps only what was paid", () => {
  const r = computeCarryingCharges([
    charge("INTEREST", "2025-01-31", -100),
    charge("INTEREST", "2025-02-28", 500),   // Wealthsimple Cash interest earned
    charge("INTEREST", "2025-03-31", -50),
  ], par);

  assert.equal(r.charges.length, 2);
  assert.equal(r.totalInterest, 150);
});

test("registered-account charges are excluded and explained", () => {
  const r = computeCarryingCharges([
    charge("FEE", "2025-03-31", -50, { registered: true, account: "TFSA" }),
    charge("INTEREST", "2025-03-31", -75, { registered: true, account: "RRSP" }),
  ], par);

  assert.equal(r.charges.length, 0);
  assert.equal(r.excludedRegistered, 2);
  assert.equal(r.total, 0);
  assert.ok(r.warnings.some(w => w.includes("never deductible")));
});

test("trading commissions are excluded — they belong in the ACB, not here", () => {
  const r = computeCarryingCharges([
    charge("FEE", "2025-03-31", -9.99, { description: "Trade commission on ACME" }),
    charge("FEE", "2025-04-30", -15, { description: "Account administration fee" }),
  ], par);

  assert.equal(r.charges.length, 1, "only the admin fee survives");
  assert.equal(r.charges[0].amount, 15);
  assert.ok(r.warnings.some(w => w.includes("cannot also be claimed")));
});

test("foreign-currency charges convert at the rate on their own date", () => {
  const r = computeCarryingCharges([
    charge("INTEREST", "2025-03-31", -100, { currencyCode: "USD" }),
  ], table({ "2025-03-31": 1.40 }));

  assert.equal(r.charges[0].amountNative, 100);
  assert.equal(r.charges[0].amount, 140);
  assert.equal(r.charges[0].fxRate, 1.40);
  assert.equal(r.charges[0].fxRateMissing, false);
});

test("a missing FX rate is flagged rather than silently absorbed", () => {
  const r = computeCarryingCharges([
    charge("INTEREST", "2025-03-31", -100, { currencyCode: "USD" }),
  ], () => null);

  assert.equal(r.charges[0].fxRateMissing, true);
  assert.equal(r.charges[0].amount, 100, "falls back to 1.0");
  assert.ok(r.warnings.some(w => w.includes("2025-03-31")));
});

test("interest and fees are totalled separately and by year", () => {
  const r = computeCarryingCharges([
    charge("INTEREST", "2024-06-30", -200),
    charge("FEE", "2024-12-31", -25),
    charge("INTEREST", "2025-06-30", -300),
  ], par);

  assert.equal(r.totalInterest, 500);
  assert.equal(r.totalFees, 25);
  assert.equal(r.total, 525);

  assert.equal(r.byYear[0].year, 2025, "newest year first");
  assert.equal(r.byYear[0].interest, 300);

  const y2024 = r.byYear.find(y => y.year === 2024)!;
  assert.equal(y2024.interest, 200);
  assert.equal(y2024.fees, 25);
  assert.equal(y2024.total, 225);
});

test("unrelated transaction types are ignored", () => {
  const r = computeCarryingCharges([
    charge("BUY", "2025-01-10", -1000),
    charge("DIVIDEND", "2025-01-10", 50),
    charge("TAX", "2025-01-10", -15),          // withholding tax, not a carrying charge
    charge("WITHDRAWAL", "2025-01-10", -500),
  ], par);

  assert.equal(r.charges.length, 0);
  assert.equal(r.total, 0);
});

test("charges come back in chronological order", () => {
  const r = computeCarryingCharges([
    charge("INTEREST", "2025-06-30", -10),
    charge("FEE", "2024-01-31", -20),
    charge("INTEREST", "2025-01-31", -30),
  ], par);

  assert.deepEqual(r.charges.map(c => c.date), ["2024-01-31", "2025-01-31", "2025-06-30"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { planHarvest, addDays, type HarvestHolding, type RecentAcquisition } from "./taxLossHarvest.js";

const TODAY = "2026-09-08";

const holding = (o: Partial<HarvestHolding> = {}): HarvestHolding => ({
  symbol: "AAA",
  poolKey: "AAA",
  accountLabel: "Margin",
  units: 100,
  marketValue: 8000,
  acb: 10000,
  ...o,
});

const buy = (o: Partial<RecentAcquisition> = {}): RecentAcquisition => ({
  poolKey: "AAA",
  date: "2026-09-01",
  units: 10,
  registered: false,
  accountLabel: "Margin",
  automatic: false,
  ...o,
});

test("only holdings under water are candidates", () => {
  const plan = planHarvest([
    holding({ symbol: "LOSER", marketValue: 8000, acb: 10000 }),
    holding({ symbol: "WINNER", marketValue: 12000, acb: 10000 }),
    holding({ symbol: "FLAT", marketValue: 10000, acb: 10000 }),
  ], 5000, [], TODAY);

  assert.deepEqual(plan.candidates.map(c => c.symbol), ["LOSER"]);
  assert.equal(plan.candidates[0].unrealizedLoss, 2000);
});

test("losses offset the realized gain up to its size, the rest carries over", () => {
  const plan = planHarvest([
    holding({ symbol: "A", poolKey: "A", marketValue: 7000, acb: 10000 }),   // 3000 loss
    holding({ symbol: "B", poolKey: "B", marketValue: 9000, acb: 10000 }),   // 1000 loss
  ], 3500, [], TODAY);

  assert.equal(plan.harvestableLoss, 4000);
  assert.equal(plan.offsetTotal, 3500, "cannot offset more gain than exists");
  assert.equal(plan.residualLoss, 500);
  // Largest usable loss is applied first.
  assert.equal(plan.candidates[0].symbol, "A");
  assert.equal(plan.candidates[0].offsetApplied, 3000);
  assert.equal(plan.candidates[1].offsetApplied, 500);
});

test("taxable income reduction applies the 50% inclusion rate", () => {
  const plan = planHarvest([holding({ marketValue: 6000, acb: 10000 })], 10000, [], TODAY);
  assert.equal(plan.offsetTotal, 4000);
  assert.equal(plan.taxableIncomeReduction, 2000);
});

test("a tax saving is only estimated when a marginal rate is supplied", () => {
  const without = planHarvest([holding({ marketValue: 6000, acb: 10000 })], 10000, [], TODAY);
  assert.equal(without.estimatedTaxSaving, null);

  const with43 = planHarvest([holding({ marketValue: 6000, acb: 10000 })], 10000, [], TODAY, 43.4);
  assert.equal(with43.estimatedTaxSaving, 868);   // 2000 * 0.434
});

test("no realized gain means nothing is offset, and the carry-forward is explained", () => {
  const plan = planHarvest([holding({ marketValue: 8000, acb: 10000 })], 0, [], TODAY);
  assert.equal(plan.offsetTotal, 0);
  assert.equal(plan.residualLoss, 2000);
  assert.match(plan.warnings.join(" "), /carried back against the previous three years/);
});

test("an already-negative realized position offsets nothing further", () => {
  const plan = planHarvest([holding({ marketValue: 8000, acb: 10000 })], -4000, [], TODAY);
  assert.equal(plan.offsetTotal, 0);
  assert.equal(plan.realizedGainYtd, -4000);
});

// ── Superficial-loss rule ───────────────────────────────────────────────────

test("a purchase inside the 30-day window puts the loss at risk", () => {
  const plan = planHarvest([holding()], 5000, [buy({ date: "2026-09-01", units: 10 })], TODAY);
  assert.equal(plan.candidates[0].risk, "at_risk");
  assert.match(plan.candidates[0].riskReason!, /10 unit\(s\) bought since 2026-08-09/);
});

test("a purchase older than 30 days is clear", () => {
  const plan = planHarvest([holding()], 5000, [buy({ date: "2026-07-01" })], TODAY);
  assert.equal(plan.candidates[0].risk, "none");
  assert.equal(plan.candidates[0].riskReason, null);
});

test("a repurchase in a registered account denies the loss permanently", () => {
  // Not merely deferred: no ACB adjustment exists in an RRSP/TFSA to recover it.
  const plan = planHarvest([holding()], 5000, [
    buy({ date: "2026-09-02", registered: true, accountLabel: "TFSA" }),
  ], TODAY);

  const c = plan.candidates[0];
  assert.equal(c.risk, "denied_permanently");
  assert.match(c.riskReason!, /TFSA/);
  assert.match(c.riskReason!, /never recovered/);
  assert.equal(c.offsetApplied, 0, "a denied loss offsets nothing");
});

test("a permanently denied loss is excluded from the harvestable total", () => {
  const plan = planHarvest([
    holding({ symbol: "SAFE", poolKey: "SAFE", marketValue: 9000, acb: 10000 }),
    holding({ symbol: "DENIED", poolKey: "DENIED", marketValue: 5000, acb: 10000 }),
  ], 20000, [buy({ poolKey: "DENIED", date: "2026-09-02", registered: true, accountLabel: "RRSP" })], TODAY);

  assert.equal(plan.harvestableLoss, 1000, "only the usable loss counts");
  assert.equal(plan.offsetTotal, 1000);
  // The denied one still appears, so the user learns why it is unavailable.
  assert.equal(plan.candidates.length, 2);
  assert.equal(plan.candidates.find(c => c.symbol === "DENIED")!.offsetApplied, 0);
});

test("a DRIP is called out, because it fires without any decision", () => {
  const plan = planHarvest([holding()], 5000, [
    buy({ date: "2026-09-01", automatic: true, units: 2.5 }),
  ], TODAY);
  assert.equal(plan.candidates[0].risk, "at_risk");
  assert.match(plan.candidates[0].riskReason!, /reinvested automatically \(DRIP\)/);
  assert.match(plan.candidates[0].riskReason!, /Turn the reinvestment off/);
});

test("candidates sort usable first, denied last, largest loss first", () => {
  const plan = planHarvest([
    holding({ symbol: "SMALL", poolKey: "SMALL", marketValue: 9500, acb: 10000 }),
    holding({ symbol: "BIG", poolKey: "BIG", marketValue: 4000, acb: 10000 }),
    holding({ symbol: "HUGE_DENIED", poolKey: "HD", marketValue: 1000, acb: 10000 }),
    holding({ symbol: "RISKY", poolKey: "RISKY", marketValue: 8000, acb: 10000 }),
  ], 50000, [
    buy({ poolKey: "HD", date: "2026-09-02", registered: true, accountLabel: "TFSA" }),
    buy({ poolKey: "RISKY", date: "2026-09-02" }),
  ], TODAY);

  // A denied loss sorts last however large, because acting on it achieves nothing.
  assert.deepEqual(plan.candidates.map(c => c.symbol), ["BIG", "SMALL", "RISKY", "HUGE_DENIED"]);
});

test("every candidate says when it is safe to buy back", () => {
  const plan = planHarvest([holding()], 5000, [], TODAY);
  assert.equal(plan.candidates[0].repurchaseAfter, "2026-10-08");
});

test("the superficial window is matched per pool, not across symbols", () => {
  const plan = planHarvest([
    holding({ symbol: "AAA", poolKey: "AAA" }),
    holding({ symbol: "BBB", poolKey: "BBB" }),
  ], 5000, [buy({ poolKey: "AAA", date: "2026-09-01" })], TODAY);

  assert.equal(plan.candidates.find(c => c.symbol === "AAA")!.risk, "at_risk");
  assert.equal(plan.candidates.find(c => c.symbol === "BBB")!.risk, "none");
});

test("addDays crosses month and year boundaries in UTC", () => {
  assert.equal(addDays("2026-09-08", 30), "2026-10-08");
  assert.equal(addDays("2026-12-20", 30), "2027-01-19");
  assert.equal(addDays("2026-09-08", -30), "2026-08-09");
});

test("an empty portfolio produces an empty plan, not a crash", () => {
  const plan = planHarvest([], 0, [], TODAY);
  assert.deepEqual(plan.candidates, []);
  assert.equal(plan.harvestableLoss, 0);
  assert.equal(plan.offsetTotal, 0);
});

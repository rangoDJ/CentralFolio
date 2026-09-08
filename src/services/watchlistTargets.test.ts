import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateTargets, describeVerdict, EMPTY_TARGETS, type TargetSubject } from "./watchlistTargets.js";

const subject = (o: Partial<TargetSubject> = {}): TargetSubject => ({
  price: 100,
  yieldPct: 4,
  ratingScore: 2,
  growthStreakYears: 10,
  ...o,
});

test("no criteria means a plain bookmark, not a met verdict", () => {
  const v = evaluateTargets(subject(), EMPTY_TARGETS);
  assert.equal(v.hasTargets, false);
  assert.equal(v.met, false);
  assert.equal(v.totalCount, 0);
});

test("price target is met at or below, missed above", () => {
  const at = evaluateTargets(subject({ price: 90 }), { ...EMPTY_TARGETS, targetPrice: 90 });
  assert.equal(at.met, true, "exactly at the target counts as met");

  const below = evaluateTargets(subject({ price: 85 }), { ...EMPTY_TARGETS, targetPrice: 90 });
  assert.equal(below.met, true);

  const above = evaluateTargets(subject({ price: 95 }), { ...EMPTY_TARGETS, targetPrice: 90 });
  assert.equal(above.met, false);
  assert.match(above.checks[0].detail, /95\.00 vs target ≤ 90\.00/);
});

test("yield target is met at or above", () => {
  const met = evaluateTargets(subject({ yieldPct: 4.2 }), { ...EMPTY_TARGETS, targetYieldPct: 4 });
  assert.equal(met.met, true);

  const missed = evaluateTargets(subject({ yieldPct: 3.5 }), { ...EMPTY_TARGETS, targetYieldPct: 4 });
  assert.equal(missed.met, false);
});

test("rating target compares on the 1-is-best scale", () => {
  // Scores run 1 (Strong Buy) -> 5 (Risky), so "at most 2" means 1 or 2.
  assert.equal(evaluateTargets(subject({ ratingScore: 2 }), { ...EMPTY_TARGETS, maxRatingScore: 2 }).met, true);
  assert.equal(evaluateTargets(subject({ ratingScore: 1 }), { ...EMPTY_TARGETS, maxRatingScore: 2 }).met, true);
  assert.equal(evaluateTargets(subject({ ratingScore: 4 }), { ...EMPTY_TARGETS, maxRatingScore: 2 }).met, false);
});

test("growth streak requires at least the configured years", () => {
  assert.equal(evaluateTargets(subject({ growthStreakYears: 10 }), { ...EMPTY_TARGETS, minGrowthStreak: 10 }).met, true);
  assert.equal(evaluateTargets(subject({ growthStreakYears: 3 }), { ...EMPTY_TARGETS, minGrowthStreak: 10 }).met, false);
});

test("every set criterion must pass, not just one", () => {
  const targets = { ...EMPTY_TARGETS, targetPrice: 90, targetYieldPct: 4 };

  const both = evaluateTargets(subject({ price: 85, yieldPct: 4.5 }), targets);
  assert.equal(both.met, true);
  assert.equal(both.metCount, 2);
  assert.equal(both.totalCount, 2);

  const priceOnly = evaluateTargets(subject({ price: 85, yieldPct: 3 }), targets);
  assert.equal(priceOnly.met, false);
  assert.equal(priceOnly.metCount, 1);
});

test("a criterion with no data is indeterminate, not failed", () => {
  // Yahoo has no dividend history for some listings. Reporting that as a
  // failed yield test would bury the symbol forever with no way to tell why.
  const v = evaluateTargets(subject({ yieldPct: null }), { ...EMPTY_TARGETS, targetYieldPct: 4 });
  assert.equal(v.checks[0].met, null);
  assert.equal(v.indeterminate, true);
  assert.equal(v.met, false);
  assert.equal(v.metCount, 0);
  assert.match(v.checks[0].detail, /no dividend data/);
});

test("an unrated symbol is indeterminate against a rating target", () => {
  const v = evaluateTargets(subject({ ratingScore: null }), { ...EMPTY_TARGETS, maxRatingScore: 2 });
  assert.equal(v.checks[0].met, null);
  assert.equal(v.indeterminate, true);
  assert.match(v.checks[0].detail, /not rated yet/);
});

test("a missing streak counts as zero rather than unknown", () => {
  // growthStreakYears is always a number from computeDividendGrowth, so this
  // criterion can always be judged.
  const v = evaluateTargets(subject({ growthStreakYears: 0 }), { ...EMPTY_TARGETS, minGrowthStreak: 5 });
  assert.equal(v.checks[0].met, false);
  assert.equal(v.indeterminate, false);
});

test("priceGapPct is negative when the price is below target", () => {
  const below = evaluateTargets(subject({ price: 81 }), { ...EMPTY_TARGETS, targetPrice: 90 });
  assert.equal(below.priceGapPct, -10);

  const above = evaluateTargets(subject({ price: 99 }), { ...EMPTY_TARGETS, targetPrice: 90 });
  assert.equal(above.priceGapPct, 10);
});

test("priceGapPct is null without both sides", () => {
  assert.equal(evaluateTargets(subject({ price: null }), { ...EMPTY_TARGETS, targetPrice: 90 }).priceGapPct, null);
  assert.equal(evaluateTargets(subject(), EMPTY_TARGETS).priceGapPct, null);
});

test("a zero price target does not divide by zero", () => {
  const v = evaluateTargets(subject({ price: 100 }), { ...EMPTY_TARGETS, targetPrice: 0 });
  assert.equal(v.priceGapPct, null);
});

test("describeVerdict reads as a sentence", () => {
  const v = evaluateTargets(subject({ price: 85, yieldPct: 4.5 }), { ...EMPTY_TARGETS, targetPrice: 90, targetYieldPct: 4 });
  assert.equal(describeVerdict("KO", v), "KO: Price 85.00 vs target ≤ 90.00, Yield 4.5% vs target ≥ 4.0%");
  assert.equal(describeVerdict("KO", evaluateTargets(subject(), EMPTY_TARGETS)), "KO has no buy criteria set");
});

/**
 * Buy criteria for watched symbols.
 *
 * The watchlist already derives price, trailing yield, dividend growth and an
 * AI rating for every entry — everything needed to answer "is this one worth
 * buying yet?" except your own thresholds. This turns a bookmark list into a
 * screener: set the conditions once, and every refresh says whether they are
 * met.
 *
 * Pure — no DB, no clock — so each criterion is unit-testable in isolation.
 */

export interface WatchlistTargets {
  /** Buy at or below this price. */
  targetPrice: number | null;
  /** Buy at or above this trailing yield, in percent. */
  targetYieldPct: number | null;
  /** Rating must be at least this good. Scores run 1 (Strong Buy) → 5 (Risky). */
  maxRatingScore: number | null;
  /** Require at least this many consecutive years of dividend growth. */
  minGrowthStreak: number | null;
}

export const EMPTY_TARGETS: WatchlistTargets = {
  targetPrice: null,
  targetYieldPct: null,
  maxRatingScore: null,
  minGrowthStreak: null,
};

/** The live figures a criterion is checked against. */
export interface TargetSubject {
  price: number | null;
  yieldPct: number | null;
  ratingScore: number | null;
  growthStreakYears: number;
}

export interface TargetCheck {
  key: keyof WatchlistTargets;
  label: string;
  /** null when the criterion is set but the data needed to judge it is missing. */
  met: boolean | null;
  detail: string;
}

export interface TargetVerdict {
  /** False when no criterion has been set — the row is a plain bookmark. */
  hasTargets: boolean;
  /** True only when every set criterion is satisfied. */
  met: boolean;
  /** True when a criterion is set but its input is unavailable. */
  indeterminate: boolean;
  checks: TargetCheck[];
  metCount: number;
  totalCount: number;
  /**
   * How far the price is from its target, in percent — negative means below
   * (in buy range). null when either side is unknown.
   */
  priceGapPct: number | null;
}

const num = (n: number, dp = 2) => Number(n).toFixed(dp);

/**
 * Check a symbol's live figures against its targets.
 *
 * A criterion whose input is missing is reported as `met: null` rather than
 * false, and makes the verdict indeterminate instead of "not met" — a symbol
 * Yahoo has no dividend history for has not *failed* a yield test, it just
 * cannot be judged. Silently treating that as a failure would hide it forever.
 */
export function evaluateTargets(subject: TargetSubject, targets: WatchlistTargets): TargetVerdict {
  const checks: TargetCheck[] = [];

  if (targets.targetPrice != null) {
    const price = subject.price;
    checks.push({
      key: "targetPrice",
      label: "Price",
      met: price == null ? null : price <= targets.targetPrice,
      detail: price == null
        ? `no price yet (target ≤ ${num(targets.targetPrice)})`
        : `${num(price)} vs target ≤ ${num(targets.targetPrice)}`,
    });
  }

  if (targets.targetYieldPct != null) {
    const y = subject.yieldPct;
    checks.push({
      key: "targetYieldPct",
      label: "Yield",
      met: y == null ? null : y >= targets.targetYieldPct,
      detail: y == null
        ? `no dividend data (target ≥ ${num(targets.targetYieldPct, 1)}%)`
        : `${num(y, 1)}% vs target ≥ ${num(targets.targetYieldPct, 1)}%`,
    });
  }

  if (targets.maxRatingScore != null) {
    const score = subject.ratingScore;
    checks.push({
      key: "maxRatingScore",
      label: "Rating",
      met: score == null ? null : score <= targets.maxRatingScore,
      detail: score == null
        ? `not rated yet (need ≤ ${targets.maxRatingScore})`
        : `${score} vs need ≤ ${targets.maxRatingScore}`,
    });
  }

  if (targets.minGrowthStreak != null) {
    // Streak is always a number (0 when unknown), so this is never indeterminate.
    const streak = subject.growthStreakYears ?? 0;
    checks.push({
      key: "minGrowthStreak",
      label: "Growth streak",
      met: streak >= targets.minGrowthStreak,
      detail: `${streak}y vs need ≥ ${targets.minGrowthStreak}y`,
    });
  }

  const metCount = checks.filter(c => c.met === true).length;
  const indeterminate = checks.some(c => c.met === null);

  return {
    hasTargets: checks.length > 0,
    met: checks.length > 0 && checks.every(c => c.met === true),
    indeterminate,
    checks,
    metCount,
    totalCount: checks.length,
    priceGapPct:
      targets.targetPrice != null && targets.targetPrice > 0 && subject.price != null
        ? round2(((subject.price - targets.targetPrice) / targets.targetPrice) * 100)
        : null,
  };
}

/** One-line summary for a notification or a tooltip. */
export function describeVerdict(symbol: string, verdict: TargetVerdict): string {
  if (!verdict.hasTargets) return `${symbol} has no buy criteria set`;
  return `${symbol}: ${verdict.checks.map(c => `${c.label} ${c.detail}`).join(", ")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

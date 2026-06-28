/**
 * Pure dividend-growth math — no DB, no IO. Single source of truth for the
 * dividend-growth-rate (DGR) and growth-streak figures, so it can be unit-tested
 * directly (see src/dividendGrowth.test.ts). Mirrors the riskMetrics/realizedGains
 * "pure module + repo wrapper" split.
 */

export interface DividendPayment {
  exDate: string; // 'YYYY-MM-DD'
  amount: number; // per-share cash amount
}

export interface DividendGrowthMetrics {
  /** Compound annual growth rate of yearly dividends, as a fraction (0.07 = 7%). */
  dgr1y: number | null;
  dgr3y: number | null;
  dgr5y: number | null;
  /** Consecutive complete calendar years of non-decreasing annual dividends. */
  growthStreakYears: number;
  /** Total dividend paid per complete calendar year, oldest → newest. */
  annualTotals: Array<{ year: number; total: number }>;
  /** Number of complete calendar years available (excludes the in-progress year). */
  yearsOfData: number;
}

const EMPTY: DividendGrowthMetrics = {
  dgr1y: null, dgr3y: null, dgr5y: null,
  growthStreakYears: 0, annualTotals: [], yearsOfData: 0,
};

/**
 * Sum payments by calendar year, dropping the current (incomplete) year so a
 * partial year doesn't read as a dividend "cut". Returns oldest → newest.
 */
function annualTotalsFrom(payments: DividendPayment[], now: Date): Array<{ year: number; total: number }> {
  const currentYear = now.getUTCFullYear();
  const byYear = new Map<number, number>();
  for (const p of payments) {
    const year = Number(p.exDate.slice(0, 4));
    if (!Number.isFinite(year) || year >= currentYear) continue; // skip junk + in-progress year
    if (!(p.amount > 0)) continue;
    byYear.set(year, (byYear.get(year) ?? 0) + p.amount);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, total]) => ({ year, total }));
}

/** CAGR between the dividend `years` complete years apart. Null if not enough data or a zero base. */
function cagrOverWindow(totals: Array<{ year: number; total: number }>, years: number): number | null {
  if (totals.length < years + 1) return null;
  const end = totals[totals.length - 1].total;
  const start = totals[totals.length - 1 - years].total;
  if (!(start > 0) || !(end > 0)) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

/**
 * Count consecutive most-recent complete years where the annual dividend did not
 * decrease year-over-year. A tiny tolerance avoids float-rounding false breaks.
 */
function growthStreak(totals: Array<{ year: number; total: number }>): number {
  let streak = 0;
  for (let i = totals.length - 1; i > 0; i--) {
    const cur = totals[i].total;
    const prev = totals[i - 1].total;
    if (cur >= prev * 0.999) streak++;
    else break;
  }
  return streak;
}

export function computeDividendGrowth(
  payments: DividendPayment[],
  now: Date = new Date()
): DividendGrowthMetrics {
  if (!payments || payments.length === 0) return EMPTY;
  const annualTotals = annualTotalsFrom(payments, now);
  if (annualTotals.length === 0) return EMPTY;

  return {
    dgr1y: cagrOverWindow(annualTotals, 1),
    dgr3y: cagrOverWindow(annualTotals, 3),
    dgr5y: cagrOverWindow(annualTotals, 5),
    growthStreakYears: growthStreak(annualTotals),
    annualTotals,
    yearsOfData: annualTotals.length,
  };
}

/**
 * Best available DGR for projection defaults: prefers the 5y figure, falling
 * back to 3y then 1y. Returns null when there's no usable growth history.
 */
export function bestDgr(m: DividendGrowthMetrics): number | null {
  return m.dgr5y ?? m.dgr3y ?? m.dgr1y;
}

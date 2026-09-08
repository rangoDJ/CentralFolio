/**
 * Money-weighted return (XIRR) — the annualized rate that discounts a series of
 * dated cash flows to zero.
 *
 * Why this exists: the dashboard's "Total Return" tile reported
 * `profit / invested`, a simple return that ignores *when* money went in. Add
 * $50k the week before a 2% rise and simple return calls it a 2% year; XIRR
 * prices the fact that the capital was only at work for a week. For anyone
 * contributing regularly the two numbers diverge sharply, and the simple one
 * flatters or punishes you arbitrarily.
 *
 * Pure — no DB, no network, no clock (the caller passes `asOf`), so it is
 * unit-testable like the other math modules here.
 */

export interface CashFlow {
  /** 'YYYY-MM-DD'. */
  date: string;
  /**
   * Negative = money leaving your pocket into the portfolio (a purchase),
   * positive = money coming back out (a sale, or the terminal market value).
   * This is the standard XIRR sign convention and the inverse of the app's
   * "net invested" line, where a buy counts positive.
   */
  amount: number;
}

const DAYS_PER_YEAR = 365;
const MAX_ITERATIONS = 100;
const TOLERANCE = 1e-7;

/** Whole days between two ISO dates, using UTC so DST never shifts a boundary. */
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return (b - a) / 86_400_000;
}

/** Net present value of `flows` at rate `r`, discounted from the earliest date. */
function npv(flows: CashFlow[], start: string, r: number): number {
  let total = 0;
  for (const f of flows) {
    const years = daysBetween(start, f.date) / DAYS_PER_YEAR;
    total += f.amount / Math.pow(1 + r, years);
  }
  return total;
}

/** d(NPV)/dr — used by the Newton step. */
function npvDerivative(flows: CashFlow[], start: string, r: number): number {
  let total = 0;
  for (const f of flows) {
    const years = daysBetween(start, f.date) / DAYS_PER_YEAR;
    if (years === 0) continue;
    total -= (years * f.amount) / Math.pow(1 + r, years + 1);
  }
  return total;
}

/**
 * Annualized money-weighted return as a fraction (0.0742 = 7.42%), or null when
 * it is not defined or cannot be solved.
 *
 * Returns null rather than a wrong number when:
 *   - there are fewer than two flows, or they span a single day (no elapsed
 *     time to annualize over);
 *   - the flows are all one sign (no rate makes them sum to zero);
 *   - neither Newton-Raphson nor the bisection fallback converges.
 *
 * A null means "not enough information", and the UI should say so instead of
 * printing 0.00%.
 */
export function xirr(flows: CashFlow[], guess = 0.1): number | null {
  const valid = flows
    .filter(f => Number.isFinite(f.amount) && f.amount !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (valid.length < 2) return null;

  const start = valid[0].date;
  const span = daysBetween(start, valid[valid.length - 1].date);
  if (span <= 0) return null;

  // XIRR needs at least one inflow and one outflow to have a root at all.
  const hasPositive = valid.some(f => f.amount > 0);
  const hasNegative = valid.some(f => f.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  // Newton-Raphson: fast when it works, which is most of the time.
  let rate = guess;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const value = npv(valid, start, rate);
    if (!Number.isFinite(value)) break;
    if (Math.abs(value) < TOLERANCE) return rate;

    const slope = npvDerivative(valid, start, rate);
    if (!Number.isFinite(slope) || slope === 0) break;

    const next = rate - value / slope;
    // Below -100% the discount factor base goes negative and fractional powers
    // return NaN, so clamp into the domain rather than diverging out of it.
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < TOLERANCE) return next;
    rate = next;
  }

  return bisect(valid, start);
}

/**
 * Bisection fallback for the cases Newton abandons — a bad starting guess, a
 * flat derivative, or a step that leaves the domain. Slower but, given a sign
 * change in the bracket, guaranteed to converge.
 */
function bisect(flows: CashFlow[], start: string): number | null {
  let lo = -0.9999;
  let hi = 10;                       // +1000%/yr — beyond any real portfolio
  let fLo = npv(flows, start, lo);
  let fHi = npv(flows, start, hi);

  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;

  // Widen once if the root isn't bracketed; some loss-heavy series need it.
  if (fLo * fHi > 0) {
    hi = 100;
    fHi = npv(flows, start, hi);
    if (!Number.isFinite(fHi) || fLo * fHi > 0) return null;
  }

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(flows, start, mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < TOLERANCE || (hi - lo) / 2 < TOLERANCE) return mid;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; }
    else { lo = mid; fLo = fMid; }
  }
  return null;
}

/**
 * Build the XIRR flow series for a portfolio from its dated net contributions
 * plus today's market value.
 *
 * `contributions` use the app's "net invested" sign convention — a buy is
 * positive because capital went in — so they are negated here into XIRR's
 * convention. The terminal market value is the positive closing flow: the
 * amount you would realize if you liquidated today.
 */
export function buildPortfolioFlows(
  contributions: { date: string; amount: number }[],
  endValue: number,
  asOf: string,
): CashFlow[] {
  const flows: CashFlow[] = contributions
    .filter(c => c.amount !== 0)
    .map(c => ({ date: c.date, amount: -c.amount }));

  if (endValue !== 0) flows.push({ date: asOf, amount: endValue });
  return flows;
}

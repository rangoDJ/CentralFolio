/**
 * Distribution schedule maths — pure, so it can be tested without a database,
 * a network call or a Snowball response.
 *
 * Two things live here that the calendar got wrong:
 *
 *  1. **Ex-date vs pay date.** Snowball reports both (`exDividendDate` and
 *     `nextDividendDate`); only the ex-date was ever stored, so every payout
 *     was drawn on the day the security went ex rather than the day the cash
 *     lands. For HDIV.TO that is 8 days early; for ENB.TO, 18 — enough to put
 *     a month-end distribution in the wrong month.
 *
 *  2. **Month-end drift.** Advancing a monthly payer with setUTCMonth() from a
 *     31st overflows February into March, and every later date in the series
 *     inherits the shift.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The date part of an ISO string, as UTC midnight. */
export function utcDay(iso: string): Date {
  return new Date(String(iso).slice(0, 10) + "T00:00:00Z");
}

/** Whole days from `a` to `b`. Negative when `b` is the earlier date. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcDay(b).getTime() - utcDay(a).getTime()) / DAY_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Frequencies that step by whole months rather than by a day count. */
const MONTHLY_FAMILY = new Set([1, 2, 4, 6, 12]);

/** Last day of the month `date` falls in. Day 0 of the next month is it. */
export function lastDomOf(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * The day-of-month to hold a monthly series to, from its first known date.
 *
 * A distribution that falls on the last day of its own month is a month-end
 * schedule, not a "30th of the month" one — these ETFs pay on the final
 * business day. Anchoring such a series to 31 makes `advanceDate`'s clamp
 * resolve to each month's own last day: Sep 30 → Oct 31 → Nov 30 → Feb 28.
 * One sample can't distinguish the two readings, and month-end is what the
 * payers in question actually do.
 */
export function anchorDayFor(first: Date): number {
  const dom = first.getUTCDate();
  return dom === lastDomOf(first) ? 31 : dom;
}

/**
 * Advance one distribution period.
 *
 * `anchorDom` is the day-of-month the series started on, not the one `date`
 * happens to sit on. Passing it is what keeps a payer that goes ex on the 31st
 * on month-end through February instead of walking forward a day or two a year.
 */
export function advanceDate(date: Date, frequency: number, anchorDom?: number): Date {
  if (MONTHLY_FAMILY.has(frequency)) {
    const monthsToAdd = 12 / frequency;
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + monthsToAdd;
    const dom = anchorDom ?? date.getUTCDate();
    const lastDom = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(dom, lastDom)));
  }
  if (frequency === 24) {
    // Semi-monthly payers (the .NE covered-call ETFs here) run mid-month and
    // month-end. A flat 15-day step drifts off both within two months.
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const dom = date.getUTCDate();
    if (dom < 15) return new Date(Date.UTC(y, m, 15));
    if (dom === 15) return new Date(Date.UTC(y, m + 1, 0));
    return new Date(Date.UTC(y, m + 1, 15));
  }
  // Weekly and bi-weekly are exact day counts. 365.25/52 rounds to 7 anyway,
  // but saying so keeps the schedule from depending on that rounding.
  const daysToAdd = frequency === 52 ? 7 : frequency === 26 ? 14 : Math.round(365.25 / frequency);
  return addDays(date, daysToAdd);
}

/**
 * Step back one distribution period — the inverse of `advanceDate`.
 *
 * Needed because Snowball's two date fields describe only the *next*
 * distribution. A payout whose ex-date has already passed is invisible to it,
 * so projecting forward alone leaves the current month empty of everything
 * that has already paid this month.
 */
export function retreatDate(date: Date, frequency: number, anchorDom?: number): Date {
  if (MONTHLY_FAMILY.has(frequency)) {
    const monthsToSub = 12 / frequency;
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() - monthsToSub;
    const dom = anchorDom ?? date.getUTCDate();
    const lastDom = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(dom, lastDom)));
  }
  if (frequency === 24) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    // advanceDate maps 15 -> month-end -> next 15, so invert that pairing.
    if (date.getUTCDate() === 15) return new Date(Date.UTC(y, m, 0));
    return new Date(Date.UTC(y, m, 15));
  }
  const daysToSub = frequency === 52 ? 7 : frequency === 26 ? 14 : Math.round(365.25 / frequency);
  return addDays(date, -daysToSub);
}

/** Longest ex-to-pay gap we will believe from a provider, in days. */
export const MAX_PAY_LAG_DAYS = 90;

/**
 * Days between going ex and the cash arriving, learned from the one ex/pay pair
 * the provider gave us.
 *
 * Returns 0 when there is no pay date — that reproduces the old ex-date
 * placement for that symbol rather than inventing a lag for it — and clamps,
 * so a garbled or mismatched pair cannot shift a payout by months.
 */
export function payLagDays(exDate: string | null, payDate: string | null): number {
  if (!exDate || !payDate) return 0;
  const lag = daysBetween(exDate, payDate);
  if (!Number.isFinite(lag)) return 0;
  return Math.min(Math.max(lag, 0), MAX_PAY_LAG_DAYS);
}

export interface Distribution {
  /** When the cash lands. This is the date the calendar places. */
  payDate: string;
  /** Ex-dividend date for the same distribution. */
  exDate: string;
  /**
   * True for a back-projected distribution: the schedule says it happened,
   * but no provider stated this date. Present so callers can tell a derived
   * past payout from a scheduled future one.
   */
  estimated?: boolean;
}

/** Guard against a stale ex-date spinning the catch-up loop forever. */
const MAX_CATCHUP_STEPS = 100;

/** Calendar months of history to reconstruct behind the next known payout. */
const BACKFILL_MONTHS = 3;

/** Ceiling on back-projection: a weekly payer needs ~14 steps per quarter. */
const MAX_BACKFILL_STEPS = 40;

/**
 * How far back a distribution can sit and still be worth showing.
 *
 * Pay dates are date-only, so they compare as UTC midnight. Measuring against
 * the current instant made a payout "past" the moment the UTC day ticked over
 * — for an Eastern user, a dividend paying today disappeared from the calendar
 * at 8pm the evening before. A day of slack covers every timezone offset and
 * also carries the payout through the gap before the broker posts the matching
 * cash transaction, at which point it is tagged received rather than dropped.
 */
const GRACE_DAYS = 1;

/** Start of the UTC day `GRACE_DAYS` before `now`, in epoch ms. */
function catchUpCutoff(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - GRACE_DAYS * DAY_MS;
}

/**
 * One year of upcoming distributions for a security.
 *
 * Catch-up runs on the **pay** date, not the ex-date: a distribution that has
 * already gone ex but whose cash has not arrived is still upcoming, and
 * dropping it is what left the front of the calendar empty.
 */
export function projectDistributions(
  lastExDate: string,
  payDate: string | null,
  frequency: number,
  now: Date,
): Distribution[] {
  if (!lastExDate || !frequency || frequency <= 0) return [];

  const lag = payLagDays(lastExDate, payDate);
  let ex = utcDay(lastExDate);
  const anchorDom = anchorDayFor(ex);

  const cutoff = catchUpCutoff(now);
  let steps = 0;
  while (addDays(ex, lag).getTime() < cutoff && steps < MAX_CATCHUP_STEPS) {
    ex = advanceDate(ex, frequency, anchorDom);
    steps++;
  }

  const out: Distribution[] = [];

  // Distributions that already paid. Snowball names only the next one, so
  // without this the current month shows nothing but the handful of
  // securities whose next payout happens to fall inside it.
  // Derived, not observed: only the first forward distribution carries a pay
  // date the provider actually stated, and issuers shift payments off
  // weekends and holidays, so these can sit a day or two from the true date
  // until the broker's own cash transaction arrives and supersedes them.
  const backfillFrom = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - BACKFILL_MONTHS, 1);
  let back = retreatDate(ex, frequency, anchorDom);
  for (let i = 0; i < MAX_BACKFILL_STEPS && addDays(back, lag).getTime() >= backfillFrom; i++) {
    out.push({
      exDate: back.toISOString().slice(0, 10),
      payDate: addDays(back, lag).toISOString(),
      estimated: true,
    });
    back = retreatDate(back, frequency, anchorDom);
  }
  out.reverse();

  for (let i = 0; i < frequency; i++) {
    out.push({
      exDate: ex.toISOString().slice(0, 10),
      payDate: addDays(ex, lag).toISOString(),
    });
    ex = advanceDate(ex, frequency, anchorDom);
  }
  return out;
}

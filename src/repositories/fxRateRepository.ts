import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

/**
 * Daily FX rate cache. Tax math needs the rate on the *trade's own date*, so
 * unlike the 6h in-memory spot cache in fxService these rows are permanent —
 * a historical rate never changes once published.
 */

export interface FxRateRow { pair: string; date: string; rate: number; }

const stmtUpsert = db.prepare(`
  INSERT INTO fx_rates (pair, date, rate, provider, cachedAt)
  VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(pair, date) DO UPDATE SET
    rate     = excluded.rate,
    provider = excluded.provider,
    cachedAt = CURRENT_TIMESTAMP
`);

/** Exact-date lookup. */
const stmtGetOn = db.prepare(
  "SELECT rate FROM fx_rates WHERE pair = ? AND date = ?"
);

/**
 * Most recent rate at or before `date`. Markets close on weekends/holidays, so
 * a trade dated Saturday resolves to Friday's rate — the same convention CRA
 * accepts when no rate was published on the transaction date.
 */
const stmtGetOnOrBefore = db.prepare(
  "SELECT rate, date FROM fx_rates WHERE pair = ? AND date <= ? ORDER BY date DESC LIMIT 1"
);

const stmtRange = db.prepare(
  "SELECT date, rate FROM fx_rates WHERE pair = ? AND date BETWEEN ? AND ? ORDER BY date"
);

const stmtCountForPair = db.prepare(
  "SELECT COUNT(*) AS n, MIN(date) AS minDate, MAX(date) AS maxDate FROM fx_rates WHERE pair = ?"
);

export function saveFxRates(pair: string, rows: Array<{ date: string; rate: number }>, provider = "yahoo"): void {
  if (rows.length === 0) return;
  db.transaction(() => {
    for (const r of rows) stmtUpsert.run(pair, r.date, r.rate, provider);
  })();
  logger.debug("FX", `saveFxRates(${pair}) — cached ${rows.length} daily rate(s)`);
}

export function getFxRateOnDate(pair: string, date: string): number | null {
  const exact = stmtGetOn.get(pair, date) as { rate: number } | undefined;
  if (exact) return exact.rate;
  const prior = stmtGetOnOrBefore.get(pair, date) as { rate: number; date: string } | undefined;
  return prior ? prior.rate : null;
}

export function getFxRateRange(pair: string, from: string, to: string): FxRateRow[] {
  return (stmtRange.all(pair, from, to) as Array<{ date: string; rate: number }>)
    .map(r => ({ pair, date: r.date, rate: r.rate }));
}

export function getFxCoverage(pair: string): { n: number; minDate: string | null; maxDate: string | null } {
  return stmtCountForPair.get(pair) as { n: number; minDate: string | null; maxDate: string | null };
}

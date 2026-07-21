import YahooFinance from "yahoo-finance2";
import { logger } from "../utils/logger.js";
import { saveFxRates, getFxRateOnDate, getFxCoverage } from "../repositories/fxRateRepository.js";

// Shared Yahoo client for FX pairs (e.g. "USDCAD=X").
const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const RATE_TTL_MS = 6 * 60 * 60 * 1000; // FX rates change slowly; cache 6h.
const cache = new Map<string, { ts: number; rate: number }>();

/** Map a symbol's exchange suffix to the currency it trades in. */
export function assetCurrency(symbol: string): string {
  const s = String(symbol || "").toUpperCase();
  const m = s.match(/\.([A-Z]{1,3})$/);
  const suffix = m ? m[1] : "";
  const map: Record<string, string> = {
    TO: "CAD", V: "CAD", VN: "CAD", CN: "CAD", NE: "CAD",
    L: "GBP", DE: "EUR", PA: "EUR", AS: "EUR", MI: "EUR", MC: "EUR",
    AX: "AUD", HK: "HKD", T: "JPY", SW: "CHF", ST: "SEK",
  };
  return map[suffix] || "USD";
}

/** Latest FX rate from `from` to `to`, cached. Returns 1 on same currency or failure. */
export async function getFxRate(from: string, to: string): Promise<number> {
  const f = (from || "").toUpperCase(), t = (to || "").toUpperCase();
  if (!f || !t || f === t) return 1;
  const key = `${f}${t}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < RATE_TTL_MS) return hit.rate;

  try {
    const period1 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await yahoo.chart(`${f}${t}=X`, { period1, interval: "1d" });
    const quotes = (res?.quotes ?? []).filter(q => q.close != null);
    const rate = quotes.length ? quotes[quotes.length - 1].close! : 1;
    cache.set(key, { ts: Date.now(), rate });
    return rate;
  } catch (e: any) {
    logger.warn("FX", `getFxRate(${f}->${t}) failed: ${e.message}`);
    return 1;
  }
}

// ── Historical (per-date) rates ───────────────────────────────────────────────

/**
 * Backfill the daily rate cache for a pair over [from, to]. Yahoo returns one
 * row per trading day; weekends/holidays are absent by design and resolved by
 * `getFxRateOnDate`'s on-or-before lookup.
 *
 * Skips the network entirely when the cache already spans the window.
 */
export async function primeFxHistory(from: string, to: string, fromDate: string, toDate: string): Promise<void> {
  const f = (from || "").toUpperCase(), t = (to || "").toUpperCase();
  if (!f || !t || f === t) return;
  const pair = `${f}${t}`;

  const cov = getFxCoverage(pair);
  if (cov.n > 0 && cov.minDate && cov.maxDate && cov.minDate <= fromDate && cov.maxDate >= toDate) {
    logger.debug("FX", `primeFxHistory(${pair}) — cache already covers ${fromDate}..${toDate}`);
    return;
  }

  try {
    // Pad the start so a trade on the first day still finds an on-or-before rate.
    const period1 = new Date(new Date(fromDate).getTime() - 10 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const res = await yahoo.chart(`${pair}=X`, { period1, period2: toDate, interval: "1d" });
    const rows = (res?.quotes ?? [])
      .filter(q => q.close != null && q.date != null)
      .map(q => ({ date: new Date(q.date).toISOString().slice(0, 10), rate: q.close! }));
    saveFxRates(pair, rows);
    logger.info("FX", `primeFxHistory(${pair}) — fetched ${rows.length} daily rate(s) for ${fromDate}..${toDate}`);
  } catch (e: any) {
    logger.warn("FX", `primeFxHistory(${pair}) failed: ${e.message}`);
  }
}

/**
 * Rate from `from` to `to` on a specific date, using the cache primed by
 * `primeFxHistory`. Returns null when no rate is known — callers decide whether
 * to fall back (tax math must surface the gap rather than silently use 1.0).
 */
export function fxRateOn(from: string, to: string, date: string): number | null {
  const f = (from || "").toUpperCase(), t = (to || "").toUpperCase();
  if (!f || !t) return null;
  if (f === t) return 1;
  return getFxRateOnDate(`${f}${t}`, String(date).slice(0, 10));
}

/** Convert a map of {currency → amount in that currency} into a single base currency. */
export async function convertToBase(amountsByCurrency: Map<string, number>, base: string): Promise<number> {
  let total = 0;
  for (const [cur, amt] of amountsByCurrency) {
    const rate = await getFxRate(cur, base);
    total += amt * rate;
  }
  return total;
}

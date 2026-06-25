import YahooFinance from "yahoo-finance2";
import { logger } from "../utils/logger.js";

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

/** Convert a map of {currency → amount in that currency} into a single base currency. */
export async function convertToBase(amountsByCurrency: Map<string, number>, base: string): Promise<number> {
  let total = 0;
  for (const [cur, amt] of amountsByCurrency) {
    const rate = await getFxRate(cur, base);
    total += amt * rate;
  }
  return total;
}

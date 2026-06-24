import YahooFinance from "yahoo-finance2";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { emitDataChanged } from "./eventBus.js";
import {
  getPriceHistory as repoGetPriceHistory,
  getLatestStoredDate,
  upsertCandles,
  getHeldSymbols,
  type PriceCandle,
} from "../repositories/priceHistoryRepository.js";

// One shared client. v3 requires instantiation; suppress the interactive notices
// (survey / "ripHistorical") so they don't spam server logs.
const yahoo = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

// How far back to reach on a symbol's first-ever sync.
const BACKFILL_YEARS = 5;
// Politeness gap between live Yahoo calls (the daily job fetches many symbols).
const FETCH_MIN_INTERVAL_MS = 600;
let lastFetchAt = 0;

// ── Symbol normalization ───────────────────────────────────────────────────────

// SnapTrade exchange suffixes that Yahoo Finance spells differently.
const EXCHANGE_REMAP: Record<string, string> = {
  VN: "V", // TSX Venture Exchange: SnapTrade uses .VN, Yahoo uses .V
};

/**
 * SnapTrade symbols don't always match Yahoo tickers. Yahoo expects:
 *   - Canadian listings suffixed (e.g. "SHOP.TO"), class shares dotted ("BRK.B"),
 *   - dashes for some class shares rather than dots in raw broker form.
 *   - Unit trusts / preferred shares with a class code use a dash before the class
 *     (e.g. EIT.UN.TO → EIT-UN.TO, VITL.UN.TO → VITL-UN.TO).
 */
export function toYahooSymbol(symbol: string): string {
  const s = symbol.toUpperCase().trim();

  // TICKER.CLASS.EXCHANGE (e.g. EIT.UN.TO → EIT-UN.TO).
  // Canadian unit trusts / preferred shares carry a class code (UN, PR, DB …)
  // that Yahoo Finance joins to the ticker with a dash, not a dot.
  const multiDot = s.match(/^([A-Z0-9]+)\.([A-Z]{1,4})\.([A-Z]{1,3})$/);
  if (multiDot) {
    const exchange = EXCHANGE_REMAP[multiDot[3]] ?? multiDot[3];
    return `${multiDot[1]}-${multiDot[2]}.${exchange}`;
  }

  // Remap exchange suffix when SnapTrade and Yahoo disagree (e.g. .VN → .V).
  const exchangeOnly = s.match(/^(.+)\.([A-Z]{2,3})$/);
  if (exchangeOnly && EXCHANGE_REMAP[exchangeOnly[2]]) {
    return `${exchangeOnly[1]}.${EXCHANGE_REMAP[exchangeOnly[2]]}`;
  }

  // Already exchange-qualified (e.g. "SHOP.TO", "BMW.DE") — leave as-is.
  if (/\.[A-Z]{1,3}$/.test(s) && !/\.[A-Z]$/.test(s)) return s;
  // Class shares written with a dot (BRK.B) → Yahoo prefers a dash.
  if (/^[A-Z]+\.[A-Z]$/.test(s)) return s.replace(".", "-");
  return s;
}

// ── In-memory request coalescing (avoid duplicate live fetches per symbol) ──────

const inflight = new Map<string, Promise<number>>();

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchAndStore(symbol: string, period1: string): Promise<number> {
  const yahooSymbol = toYahooSymbol(symbol);

  const elapsed = Date.now() - lastFetchAt;
  if (elapsed < FETCH_MIN_INTERVAL_MS) {
    await sleep(FETCH_MIN_INTERVAL_MS - elapsed);
  }
  lastFetchAt = Date.now();

  const result = await yahoo.chart(yahooSymbol, { period1, interval: "1d" });
  const quotes = result?.quotes ?? [];

  const candles: PriceCandle[] = quotes
    .filter(q => q.date != null && q.close != null)
    .map(q => ({
      date: isoDay(new Date(q.date as any)),
      open: q.open ?? null,
      high: q.high ?? null,
      low: q.low ?? null,
      close: q.close ?? null,
      adjClose: q.adjclose ?? null,
      volume: q.volume ?? null,
    }));

  const n = upsertCandles(symbol, candles, { provider: "yahoo", yahooSymbol });
  if (n > 0) emitDataChanged("priceHistory");
  return n;
}

/**
 * Ensure price history for a symbol is current. Reads the latest stored day and
 * fetches only the gap since then (or a full BACKFILL_YEARS window on first sight).
 * Returns the number of candles written/refreshed.
 */
export async function syncSymbol(symbol: string): Promise<number> {
  const key = symbol.toUpperCase().trim();
  if (!key) return 0;

  const existing = inflight.get(key);
  if (existing) return existing;

  const work = (async () => {
    const latest = getLatestStoredDate(key);
    let period1: string;
    if (latest) {
      // Re-fetch from the last stored day so the final (possibly partial) candle
      // is refreshed and any new days are appended.
      period1 = latest;
    } else {
      const d = new Date();
      d.setFullYear(d.getFullYear() - BACKFILL_YEARS);
      period1 = isoDay(d);
    }
    try {
      const n = await fetchAndStore(key, period1);
      logger.info("PriceHistory", `syncSymbol(${key}) → ${n} candle(s) (from ${period1})`);
      return n;
    } catch (err: any) {
      logger.warn("PriceHistory", `syncSymbol(${key}) failed: ${err.message}`);
      throw err;
    }
  })();

  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Sync every currently-held symbol. Used by the scheduled daily job.
 * Errors on individual symbols are logged and skipped so one bad ticker
 * doesn't abort the whole run.
 */
export async function syncAllHeldSymbols(): Promise<{ symbols: number; updated: number; errors: number }> {
  const symbols = getHeldSymbols();
  logger.info("PriceHistory", `syncAllHeldSymbols — ${symbols.length} held symbol(s)`);
  let updated = 0;
  let errors = 0;
  for (const sym of symbols) {
    try {
      updated += await syncSymbol(sym);
    } catch {
      errors++;
    }
  }
  return { symbols: symbols.length, updated, errors };
}

/**
 * Read-through accessor for the API: returns stored history, kicking off a
 * background sync if the data is missing or stale (older than ~1 day).
 */
export async function getPriceHistory(
  symbol: string,
  range: string = "1y"
): Promise<PriceCandle[]> {
  const key = symbol.toUpperCase().trim();
  const fromDate = rangeToFromDate(range);

  const latest = getLatestStoredDate(key);
  const stale = !latest || isoDay(new Date()) > addDaysIso(latest, 1);
  if (stale) {
    // Block on first-ever fetch so the caller gets data; otherwise refresh in
    // the background and serve what we have.
    if (!latest) {
      try { await syncSymbol(key); } catch { /* fall through to whatever is stored */ }
    } else {
      syncSymbol(key).catch(() => {});
    }
  }

  return repoGetPriceHistory(key, fromDate);
}

// ── Range helpers ──────────────────────────────────────────────────────────────

function rangeToFromDate(range: string): string | undefined {
  const now = new Date();
  const r = range.toLowerCase();
  const map: Record<string, () => void> = {
    "1m":  () => now.setMonth(now.getMonth() - 1),
    "3m":  () => now.setMonth(now.getMonth() - 3),
    "6m":  () => now.setMonth(now.getMonth() - 6),
    "1y":  () => now.setFullYear(now.getFullYear() - 1),
    "2y":  () => now.setFullYear(now.getFullYear() - 2),
    "5y":  () => now.setFullYear(now.getFullYear() - 5),
  };
  if (r === "max" || r === "all") return undefined;
  (map[r] ?? map["1y"])();
  return isoDay(now);
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

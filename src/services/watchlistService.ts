import { logger } from "../utils/logger.js";
import { listWatchlist, type WatchlistEntry } from "../repositories/watchlistRepository.js";
import { getProfile } from "../repositories/assetProfileRepository.js";
import { getRating } from "../repositories/stockRatingRepository.js";
import { getPriceHistory } from "../repositories/priceHistoryRepository.js";
import { getDividendHistory } from "../repositories/dividendHistoryRepository.js";
import { computeDividendGrowth } from "./dividendGrowth.js";
import { ensureProfile } from "./assetProfileService.js";
import { syncSymbol } from "./priceHistoryService.js";

export interface ScreenerRow {
  symbol: string;
  notes: string | null;
  addedAt: string;
  name: string | null;
  sector: string | null;
  country: string | null;
  assetType: string | null;
  price: number | null;
  ttmDividend: number | null;     // trailing-12-month dividends per share
  yieldPct: number | null;        // ttmDividend / price * 100
  dgr5yPct: number | null;        // best available DGR, as a percentage
  growthStreakYears: number;
  ratingScore: number | null;
  ratingLabel: string | null;
}

const norm = (s: string) => s.toUpperCase().trim();

function latestClose(symbol: string): number | null {
  const candles = getPriceHistory(symbol);
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].close != null) return candles[i].close;
  }
  return null;
}

/** Sum of dividends with an ex-date in the trailing 365 days. */
function trailingTwelveMonthDividend(symbol: string, now = new Date()): number | null {
  const history = getDividendHistory(symbol);
  if (history.length === 0) return null;
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  let sum = 0;
  let any = false;
  for (const p of history) {
    if (p.exDate >= cutoffIso) { sum += p.amount; any = true; }
  }
  return any ? sum : null;
}

function buildRow(entry: WatchlistEntry): ScreenerRow {
  const symbol = norm(entry.symbol);
  const profile = getProfile(symbol);
  const rating = getRating(symbol);
  const price = latestClose(symbol);
  const ttmDividend = trailingTwelveMonthDividend(symbol);
  const growth = computeDividendGrowth(getDividendHistory(symbol));
  const bestDgr = growth.dgr5y ?? growth.dgr3y ?? growth.dgr1y;

  return {
    symbol,
    notes: entry.notes,
    addedAt: entry.addedAt,
    name: profile?.name ?? null,
    sector: profile?.sector ?? null,
    country: profile?.country ?? null,
    assetType: profile?.assetType ?? null,
    price,
    ttmDividend,
    yieldPct: ttmDividend != null && price != null && price > 0 ? (ttmDividend / price) * 100 : null,
    dgr5yPct: bestDgr != null ? bestDgr * 100 : null,
    growthStreakYears: growth.growthStreakYears,
    ratingScore: rating?.score ?? null,
    ratingLabel: rating?.label ?? null,
  };
}

/** Enriched screener rows for every watched symbol (reads cached data only). */
export function getWatchlistRows(): ScreenerRow[] {
  return listWatchlist().map(buildRow);
}

/**
 * Populate the free Yahoo-sourced data for a newly-watched symbol: company
 * profile + price history + dividend history. Best-effort and guarded so a bad
 * ticker never fails the request. Stock ratings (AI) are left to the existing
 * scheduled job / manual run.
 */
export async function enrichWatchlistSymbol(symbol: string): Promise<void> {
  const key = norm(symbol);
  try {
    await ensureProfile(key);
  } catch (e: any) {
    logger.debug("Watchlist", `ensureProfile(${key}) failed: ${e?.message ?? e}`);
  }
  try {
    await syncSymbol(key); // populates price_history + dividend_history
  } catch (e: any) {
    logger.debug("Watchlist", `syncSymbol(${key}) failed: ${e?.message ?? e}`);
  }
}

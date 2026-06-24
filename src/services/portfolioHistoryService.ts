import { listPortfolios, getCachedAccounts, getActiveAccountIds, getCachedTransactions } from "../models/db.js";
import { getPriceHistory as repoGetPriceHistory, getLatestStoredDate } from "../repositories/priceHistoryRepository.js";
import { syncSymbol } from "./priceHistoryService.js";
import { reconstructPortfolioHistory, type PHTransaction, type PriceCandleLite, type PortfolioHistoryResult } from "./portfolioHistory.js";
import { logger } from "../utils/logger.js";

const DEFAULT_BENCHMARK = "SPY";
const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();

// Short in-memory cache — reconstruction touches every transaction + price row,
// so we don't want to redo it on every poll. Keyed by benchmark symbol.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { ts: number; data: PortfolioHistoryResult }>();

/** Gather transactions across all active accounts of all portfolios. */
function gatherActiveTransactions(): PHTransaction[] {
  const activeIds = getActiveAccountIds();
  const out: PHTransaction[] = [];
  for (const portfolio of listPortfolios()) {
    for (const acct of getCachedAccounts(portfolio.id!)) {
      if (!activeIds.has(acct.id)) continue;
      for (const t of getCachedTransactions(acct.id)) {
        out.push({ symbol: t.symbol, type: t.type, units: t.units, price: t.price, amount: t.amount, date: t.date });
      }
    }
  }
  return out;
}

/**
 * Ensure we have price history for a symbol, then return its (date, close)
 * series. Blocks on a first-ever fetch; otherwise serves cached rows and
 * refreshes in the background.
 */
async function ensureSeries(symbol: string): Promise<PriceCandleLite[]> {
  const key = norm(symbol);
  if (!getLatestStoredDate(key)) {
    try { await syncSymbol(key); } catch (e: any) { logger.warn("PortfolioHistory", `sync ${key} failed: ${e.message}`); }
  } else {
    syncSymbol(key).catch(() => {});
  }
  return repoGetPriceHistory(key).map(c => ({ date: c.date, close: c.close }));
}

export async function getPortfolioHistory(benchmarkSymbol: string = DEFAULT_BENCHMARK): Promise<PortfolioHistoryResult> {
  const bench = norm(benchmarkSymbol) || DEFAULT_BENCHMARK;

  const cached = cache.get(bench);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const txns = gatherActiveTransactions();
  const symbols = Array.from(new Set(
    txns.filter(t => t.symbol).map(t => norm(t.symbol))
  ));
  logger.info("PortfolioHistory", `Reconstructing from ${txns.length} txn(s) across ${symbols.length} symbol(s), benchmark=${bench}`);

  const priceSeriesBySymbol = new Map<string, PriceCandleLite[]>();
  for (const sym of symbols) {
    priceSeriesBySymbol.set(sym, await ensureSeries(sym));
  }
  const benchSeries = await ensureSeries(bench);

  const result = reconstructPortfolioHistory(
    txns,
    priceSeriesBySymbol,
    { symbol: bench, series: benchSeries }
  );

  cache.set(bench, { ts: Date.now(), data: result });
  return result;
}

/** Drop the cache (e.g. after a transactions/price refresh). */
export function clearPortfolioHistoryCache(): void {
  cache.clear();
}

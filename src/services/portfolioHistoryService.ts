import { getCachedTransactions } from "../models/db.js";
import { getScopedAccounts } from "./accountScope.js";
import { getPriceHistory as repoGetPriceHistory, getLatestStoredDate } from "../repositories/priceHistoryRepository.js";
import { syncSymbol } from "./priceHistoryService.js";
import { reconstructPortfolioHistory, type PHTransaction, type PriceCandleLite, type PortfolioHistoryResult } from "./portfolioHistory.js";
import { logger } from "../utils/logger.js";

const DEFAULT_BENCHMARK = "SPY";
const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();

// Short in-memory cache — reconstruction touches every transaction + price row,
// so we don't want to redo it on every poll. Keyed by "benchmark:sortedAccountIds".
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { ts: number; data: PortfolioHistoryResult }>();

function cacheKey(bench: string, allowedIds: Set<string> | null): string {
  if (!allowedIds) return `${bench}:`;
  return `${bench}:${Array.from(allowedIds).sort().join(',')}`;
}

/** Gather transactions across active accounts, optionally limited to allowedIds. */
function gatherActiveTransactions(allowedIds: Set<string> | null): PHTransaction[] {
  const out: PHTransaction[] = [];
  for (const acct of getScopedAccounts(allowedIds)) {
    for (const t of getCachedTransactions(acct.id)) {
      out.push({ symbol: t.symbol, type: t.type, units: t.units, price: t.price, amount: t.amount, date: t.date });
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
    syncSymbol(key).catch((e: any) => logger.warn("PortfolioHistory", `background price sync failed for ${key}: ${e.message}`));
  }
  return repoGetPriceHistory(key).map(c => ({ date: c.date, close: c.close }));
}

export async function getPortfolioHistory(benchmarkSymbol: string = DEFAULT_BENCHMARK, allowedIds: Set<string> | null = null): Promise<PortfolioHistoryResult> {
  const bench = norm(benchmarkSymbol) || DEFAULT_BENCHMARK;
  const key = cacheKey(bench, allowedIds);

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const txns = gatherActiveTransactions(allowedIds);
  const symbols = Array.from(new Set(
    txns.filter(t => t.symbol).map(t => norm(t.symbol))
  ));
  logger.info("PortfolioHistory", `Reconstructing from ${txns.length} txn(s) across ${symbols.length} symbol(s), benchmark=${bench}`);

  const [symbolSeries, benchSeries] = await Promise.all([
    Promise.all(symbols.map(sym => ensureSeries(sym).then(s => [sym, s] as const))),
    ensureSeries(bench),
  ]);
  const priceSeriesBySymbol = new Map<string, PriceCandleLite[]>(symbolSeries);

  const result = reconstructPortfolioHistory(
    txns,
    priceSeriesBySymbol,
    { symbol: bench, series: benchSeries }
  );

  cache.set(key, { ts: Date.now(), data: result });
  return result;
}

/**
 * Drop cached entries affected by the given account IDs, or clear all if none
 * provided. Passing account IDs avoids evicting results for unrelated portfolios.
 */
export function clearPortfolioHistoryCache(dirtyAccountIds?: Set<string>): void {
  if (!dirtyAccountIds || dirtyAccountIds.size === 0) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    // Key format: "BENCH:" (all accounts) or "BENCH:id1,id2,...".
    // An "all-accounts" entry must be cleared whenever any account is dirty.
    const idPart = key.slice(key.indexOf(':') + 1);
    if (!idPart) { cache.delete(key); continue; }
    const cachedIds = idPart.split(',');
    if (cachedIds.some(id => dirtyAccountIds.has(id))) cache.delete(key);
  }
}

import YahooFinance from "yahoo-finance2";
import { logger } from "../utils/logger.js";

/**
 * Ticker lookup for the bucket editor.
 *
 * Yahoo is already this project's source for profiles, prices and dividends,
 * so searching there keeps a bucket's symbols consistent with the data the
 * preview later reads. Results are cached briefly: the editor searches on
 * every keystroke, and the same few queries repeat constantly.
 */

const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; results: SymbolHit[] }>();

export interface SymbolHit {
  symbol: string;
  name: string | null;
  exchange: string | null;
  assetType: string | null;
}

/** Tradable instruments only — an index or a currency cannot be bought. */
const TRADABLE = new Set(["EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY"]);

export async function searchSymbols(query: string, limit = 10): Promise<SymbolHit[]> {
  const key = query.trim().toLowerCase();
  if (key.length < 1) return [];

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results.slice(0, limit);

  try {
    logger.debug("Yahoo", `search("${key}") — fetching symbol matches`);
    const res = await yahoo.search(key, { quotesCount: 20, newsCount: 0 });
    const results: SymbolHit[] = ((res as any)?.quotes ?? [])
      .filter((q: any) => q?.symbol && TRADABLE.has(String(q.quoteType ?? "").toUpperCase()))
      .map((q: any) => ({
        symbol: String(q.symbol).toUpperCase(),
        name: q.shortname ?? q.longname ?? null,
        exchange: q.exchDisp ?? q.exchange ?? null,
        assetType: q.quoteType ?? null,
      }));
    cache.set(key, { at: Date.now(), results });
    return results.slice(0, limit);
  } catch (err: any) {
    logger.warn("SymbolSearch", `search("${key}") failed: ${err.message}`);
    // A search outage should leave the field usable — the user can still type a
    // ticker in full, which the bucket accepts on its own.
    return [];
  }
}

import { logger } from "../utils/logger.js";
import { getDividendHistory } from "../repositories/dividendHistoryRepository.js";
import { syncSymbol } from "./priceHistoryService.js";
import { computeDividendGrowth, bestDgr, type DividendGrowthMetrics } from "./dividendGrowth.js";

const norm = (s: string) => s.toUpperCase().trim();

/**
 * Dividend-growth metrics for a symbol. When `ensure` is true and we have no
 * stored dividend history yet, blocks on a one-time sync (syncSymbol now pulls
 * dividend events alongside candles); otherwise serves whatever is cached.
 */
export async function getDividendGrowthForSymbol(
  symbol: string,
  ensure = true
): Promise<DividendGrowthMetrics> {
  const key = norm(symbol);
  let history = getDividendHistory(key);
  if (history.length === 0 && ensure) {
    try {
      await syncSymbol(key);
      history = getDividendHistory(key);
    } catch (e: any) {
      logger.debug("DividendGrowth", `ensure sync for ${key} failed: ${e?.message ?? e}`);
    }
  }
  return computeDividendGrowth(history);
}

/** Metrics for many symbols. Reads cached history only (no blocking sync). */
export function getDividendGrowthMap(symbols: string[]): Map<string, DividendGrowthMetrics> {
  const map = new Map<string, DividendGrowthMetrics>();
  for (const s of symbols) {
    const key = norm(s);
    map.set(key, computeDividendGrowth(getDividendHistory(key)));
  }
  return map;
}

/**
 * Market-value-weighted average of each holding's best available DGR — a
 * data-driven default for the income projection's "dividend growth %/yr" input.
 * Symbols with no growth history (or no weight) are ignored. Returns a fraction
 * (0.07 = 7%) or null when nothing usable is available.
 */
export function portfolioWeightedDgr(
  holdings: Array<{ symbol: string; weight: number }>
): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const h of holdings) {
    if (!(h.weight > 0)) continue;
    const dgr = bestDgr(computeDividendGrowth(getDividendHistory(norm(h.symbol))));
    if (dgr == null) continue;
    weighted += dgr * h.weight;
    totalWeight += h.weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : null;
}

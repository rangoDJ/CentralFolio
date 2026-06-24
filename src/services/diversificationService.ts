import { listPortfolios, getCachedAccounts, getActiveAccountIds, getCachedPositions } from "../models/db.js";
import { ensureProfiles } from "./assetProfileService.js";
import { logger } from "../utils/logger.js";

const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();

export interface Slice { key: string; value: number; pct: number; }
export interface DiversificationResult {
  totalValue: number;
  holdings: number;
  bySector: Slice[];
  byCountry: Slice[];
  byAssetType: Slice[];
  unclassified: number; // value with no profile/sector
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { ts: number; data: DiversificationResult } | null = null;

/** Current market value held per symbol across all active accounts. */
function holdingsValueBySymbol(): Map<string, number> {
  const activeIds = getActiveAccountIds();
  const out = new Map<string, number>();
  for (const portfolio of listPortfolios()) {
    for (const acct of getCachedAccounts(portfolio.id!)) {
      if (!activeIds.has(acct.id)) continue;
      for (const pos of getCachedPositions(acct.id)) {
        const sym = norm(pos.symbol);
        if (!sym) continue;
        const value = pos.marketValue ?? (pos.units ?? 0) * (pos.price ?? 0);
        if (!value) continue;
        out.set(sym, (out.get(sym) ?? 0) + value);
      }
    }
  }
  return out;
}

function toSlices(buckets: Map<string, number>, total: number): Slice[] {
  return Array.from(buckets.entries())
    .map(([key, value]) => ({ key, value: round2(value), pct: total > 0 ? round2((value / total) * 100) : 0 }))
    .sort((a, b) => b.value - a.value);
}

export async function getDiversification(): Promise<DiversificationResult> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;

  const valueBySymbol = holdingsValueBySymbol();
  const symbols = Array.from(valueBySymbol.keys());
  logger.info("Diversification", `Aggregating ${symbols.length} holding(s)`);

  const profiles = await ensureProfiles(symbols);

  const total = Array.from(valueBySymbol.values()).reduce((s, v) => s + v, 0);
  const sector = new Map<string, number>();
  const country = new Map<string, number>();
  const assetType = new Map<string, number>();
  let unclassified = 0;

  for (const [sym, value] of valueBySymbol) {
    const p = profiles.get(sym);
    const t = p?.assetType || "Unknown";
    assetType.set(t, (assetType.get(t) ?? 0) + value);

    // ETFs/funds have no single sector or country — bucket them explicitly so
    // they don't distort equity sector weights.
    const isFund = t === "ETF" || t === "MUTUALFUND";
    const sec = isFund ? "Funds / ETFs" : (p?.sector || "Unclassified");
    const ctry = isFund ? "Funds / ETFs" : (p?.country || "Unclassified");
    sector.set(sec, (sector.get(sec) ?? 0) + value);
    country.set(ctry, (country.get(ctry) ?? 0) + value);
    if (!isFund && !p?.sector) unclassified += value;
  }

  const data: DiversificationResult = {
    totalValue: round2(total),
    holdings: symbols.length,
    bySector: toSlices(sector, total),
    byCountry: toSlices(country, total),
    byAssetType: toSlices(assetType, total),
    unclassified: round2(unclassified),
  };
  cache = { ts: Date.now(), data };
  return data;
}

export function clearDiversificationCache(): void {
  cache = null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

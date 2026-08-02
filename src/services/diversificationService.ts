import { getCachedPositions } from "../models/db.js";
import { getScopedAccounts } from "./accountScope.js";
import { ensureProfiles } from "./assetProfileService.js";
import { assetCurrency, toBaseCurrency } from "./fxService.js";
import { logger } from "../utils/logger.js";

const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();

export interface Slice { key: string; value: number; pct: number; }
export interface DiversificationResult {
  totalValue: number;
  holdings: number;
  bySector: Slice[];
  byCountry: Slice[];
  byAssetType: Slice[];
  byCurrency: Slice[];
  baseCurrency: string;       // dominant holding currency
  totalValueBase: number;     // FX-adjusted total in baseCurrency
  unclassified: number; // value with no profile/sector
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { ts: number; data: DiversificationResult }>();

/** Current market value held per symbol, optionally limited to allowedIds. */
function holdingsValueBySymbol(allowedIds: Set<string> | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const acct of getScopedAccounts(allowedIds)) {
    for (const pos of getCachedPositions(acct.id)) {
      const sym = norm(pos.symbol);
      if (!sym) continue;
      const value = pos.marketValue ?? (pos.units ?? 0) * (pos.price ?? 0);
      if (!value) continue;
      out.set(sym, (out.get(sym) ?? 0) + value);
    }
  }
  return out;
}

function toSlices(buckets: Map<string, number>, total: number): Slice[] {
  return Array.from(buckets.entries())
    .map(([key, value]) => ({ key, value: round2(value), pct: total > 0 ? round2((value / total) * 100) : 0 }))
    .sort((a, b) => b.value - a.value);
}

export async function getDiversification(allowedIds: Set<string> | null = null): Promise<DiversificationResult> {
  const key = allowedIds ? Array.from(allowedIds).sort().join(',') : '';
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const valueBySymbol = holdingsValueBySymbol(allowedIds);
  const symbols = Array.from(valueBySymbol.keys());
  logger.info("Diversification", `Aggregating ${symbols.length} holding(s)`);

  const profiles = await ensureProfiles(symbols);

  // Native-currency totals, used only to pick the dominant display currency —
  // every bucket below is converted to it before being summed or compared.
  const nativeByCurrency = new Map<string, number>();
  for (const [sym, value] of valueBySymbol) {
    const cur = assetCurrency(sym);
    nativeByCurrency.set(cur, (nativeByCurrency.get(cur) ?? 0) + value);
  }
  const baseCurrency = nativeByCurrency.size
    ? Array.from(nativeByCurrency.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : "USD";

  const holdings = Array.from(valueBySymbol, ([symbol, value]) => ({ symbol, value, currency: assetCurrency(symbol) }));
  const converted = await toBaseCurrency(holdings, h => h.currency, h => h.value, baseCurrency);

  const sector = new Map<string, number>();
  const country = new Map<string, number>();
  const assetType = new Map<string, number>();
  const currency = new Map<string, number>(); // native amounts, for the currency-exposure view
  let unclassified = 0;
  let total = 0; // in baseCurrency

  for (const h of converted) {
    total += h.valueBase;

    const p = profiles.get(h.symbol);
    const t = p?.assetType || "Unknown";
    assetType.set(t, (assetType.get(t) ?? 0) + h.valueBase);

    // Currency-exposure bucket stays in native amounts — each slice is shown
    // in its own currency — but shares the same FX-adjusted `total` below.
    currency.set(h.currency, (currency.get(h.currency) ?? 0) + h.value);

    // ETFs/funds have no single sector or country — bucket them explicitly so
    // they don't distort equity sector weights.
    const isFund = t === "ETF" || t === "MUTUALFUND";
    const sec = isFund ? "Funds / ETFs" : (p?.sector || "Unclassified");
    const ctry = isFund ? "Funds / ETFs" : (p?.country || "Unclassified");
    sector.set(sec, (sector.get(sec) ?? 0) + h.valueBase);
    country.set(ctry, (country.get(ctry) ?? 0) + h.valueBase);
    if (!isFund && !p?.sector) unclassified += h.valueBase;
  }

  const data: DiversificationResult = {
    totalValue: round2(total),
    holdings: symbols.length,
    bySector: toSlices(sector, total),
    byCountry: toSlices(country, total),
    byAssetType: toSlices(assetType, total),
    byCurrency: toSlices(currency, total),
    baseCurrency,
    totalValueBase: round2(total),
    unclassified: round2(unclassified),
  };
  cache.set(key, { ts: Date.now(), data });
  return data;
}

export function clearDiversificationCache(): void {
  cache.clear();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

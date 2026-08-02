import { getCachedPositions, getCachedTransactions, getCachedDividendMetadata } from "../models/db.js";
import { getScopedAccounts } from "./accountScope.js";
import { computeAttribution, type AttributionInput, type AttributionResult } from "./attribution.js";
import { logger } from "../utils/logger.js";

const DIV_TYPES = new Set(["DIVIDEND", "DIV", "DISTRIBUTION"]);
const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();

interface Agg { name: string | null; value: number; costBasis: number; dividends: number; currency: string | null; }

/** Per-symbol performance attribution across active (optionally filtered) accounts. */
export function getAttribution(allowedIds?: Set<string> | null): AttributionResult {
  const bySymbol = new Map<string, Agg>();

  for (const acct of getScopedAccounts(allowedIds)) {
    // Holdings → value + cost basis.
    for (const pos of getCachedPositions(acct.id)) {
      const sym = norm(pos.symbol);
      if (!sym) continue;
      const units = pos.units || 0;
      const value = pos.marketValue ?? (units * (pos.price ?? 0));
      if (units <= 0 && value <= 0) continue;
      const avg = pos.averagePurchasePrice || 0;
      const cost = avg > 0 ? avg * units : value;
      const a = bySymbol.get(sym) ?? { name: null, value: 0, costBasis: 0, dividends: 0, currency: acct.currency || null };
      a.value += value;
      a.costBasis += cost;
      if (!a.name) a.name = pos.description || getCachedDividendMetadata(sym)?.name || null;
      bySymbol.set(sym, a);
    }

    // Dividend transactions → dividends received.
    for (const t of getCachedTransactions(acct.id)) {
      if (!DIV_TYPES.has(norm(t.type))) continue;
      const sym = norm(t.symbol);
      if (!sym) continue;
      const a = bySymbol.get(sym);
      if (a) a.dividends += Math.abs(t.amount || 0);
    }
  }

  const input: AttributionInput[] = Array.from(bySymbol.entries()).map(([symbol, a]) => ({
    symbol, name: a.name, value: a.value, costBasis: a.costBasis, dividends: a.dividends, currency: a.currency,
  }));

  logger.info("Attribution", `Computed attribution for ${input.length} holding(s)`);
  return computeAttribution(input);
}

/**
 * Pure performance-attribution math (no DB/network) — unit-tested in
 * src/attribution.test.ts. The service layer (attributionService.ts) gathers
 * per-symbol holdings + dividends and feeds them here.
 *
 * Total return per holding = unrealized capital gain (value − cost basis) plus
 * dividends received. Contribution is each holding's share of the total dollar
 * return across the portfolio, so the biggest movers (up and down) surface.
 */

export interface AttributionInput {
  symbol: string;
  name?: string | null;
  value: number;       // current market value
  costBasis: number;   // your cost (units × avg purchase price)
  dividends: number;   // dividends received to date
  currency?: string | null;
}

export interface AttributionRow extends AttributionInput {
  unrealized: number;
  totalReturn: number;
  totalReturnPct: number | null;
  contributionPct: number;   // share of the portfolio's net dollar return
}

export interface AttributionResult {
  rows: AttributionRow[];          // sorted by totalReturn, descending
  totalReturn: number;
  totalValue: number;
  totalCost: number;
  totalDividends: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeAttribution(holdings: AttributionInput[]): AttributionResult {
  const enriched = holdings.map(h => {
    const unrealized = h.value - h.costBasis;
    const totalReturn = unrealized + (h.dividends || 0);
    return {
      ...h,
      unrealized: round2(unrealized),
      totalReturn: round2(totalReturn),
      totalReturnPct: h.costBasis > 0 ? round2((totalReturn / h.costBasis) * 100) : null,
      _rawReturn: totalReturn,
    };
  });

  // Contribution is normalized by the sum of absolute returns, so winners and
  // losers each get a share whose magnitude reflects their impact.
  const absSum = enriched.reduce((s, r) => s + Math.abs(r._rawReturn), 0);
  const rows: AttributionRow[] = enriched
    .map(({ _rawReturn, ...r }) => ({
      ...r,
      contributionPct: absSum > 0 ? round2((_rawReturn / absSum) * 100) : 0,
    }))
    .sort((a, b) => b.totalReturn - a.totalReturn);

  return {
    rows,
    totalReturn: round2(enriched.reduce((s, r) => s + r._rawReturn, 0)),
    totalValue: round2(holdings.reduce((s, h) => s + h.value, 0)),
    totalCost: round2(holdings.reduce((s, h) => s + h.costBasis, 0)),
    totalDividends: round2(holdings.reduce((s, h) => s + (h.dividends || 0), 0)),
  };
}

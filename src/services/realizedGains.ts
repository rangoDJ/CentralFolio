/**
 * Pure realized capital-gains math (no DB/network) — unit-tested in
 * src/realizedGains.test.ts. Uses the average-cost (ACB) method: each BUY raises
 * the running cost base; each SELL realizes proceeds minus the average cost of
 * the shares sold. Processed per symbol, chronologically.
 */

export interface RGTransaction {
  symbol?: string | null;
  type?: string | null;
  units?: number | null;
  price?: number | null;
  amount?: number | null;
  date?: string | null;
}

export interface RealizedEvent {
  symbol: string;
  date: string;      // YYYY-MM-DD
  year: number;
  proceeds: number;
  costBasis: number;
  gain: number;
}

export interface RealizedResult {
  events: RealizedEvent[];
  totalProceeds: number;
  totalCostBasis: number;
  totalGain: number;
}

const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();
const BUY = new Set(["BUY", "BUYTOOPEN", "REINVEST", "DRIP"]);
const SELL = new Set(["SELL", "SELLTOCLOSE"]);
const round2 = (n: number) => Math.round(n * 100) / 100;

function cashOf(t: RGTransaction, units: number): number {
  return t.amount != null ? Math.abs(t.amount) : units * (t.price ?? 0);
}

export function computeRealizedGains(txns: RGTransaction[]): RealizedResult {
  const bySymbol = new Map<string, RGTransaction[]>();
  for (const t of txns) {
    const sym = norm(t.symbol);
    if (!sym || !t.date) continue;
    (bySymbol.get(sym) ?? bySymbol.set(sym, []).get(sym)!).push(t);
  }

  const events: RealizedEvent[] = [];

  for (const [sym, list] of bySymbol) {
    const sorted = [...list].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let acb = 0;      // total cost base of the currently-held shares
    let shares = 0;

    for (const t of sorted) {
      const type = norm(t.type);
      const units = Math.abs(t.units ?? 0);
      if (BUY.has(type)) {
        acb += cashOf(t, units);
        shares += units;
      } else if (SELL.has(type) && units > 0) {
        const avg = shares > 0 ? acb / shares : 0;
        const costBasis = avg * Math.min(units, shares || units);
        const proceeds = cashOf(t, units);
        const date = String(t.date).slice(0, 10);
        events.push({
          symbol: sym,
          date,
          year: Number(date.slice(0, 4)),
          proceeds: round2(proceeds),
          costBasis: round2(costBasis),
          gain: round2(proceeds - costBasis),
        });
        acb = Math.max(0, acb - costBasis);
        shares = Math.max(0, shares - units);
      }
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return {
    events,
    totalProceeds: round2(events.reduce((s, e) => s + e.proceeds, 0)),
    totalCostBasis: round2(events.reduce((s, e) => s + e.costBasis, 0)),
    totalGain: round2(events.reduce((s, e) => s + e.gain, 0)),
  };
}

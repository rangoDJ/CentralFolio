/**
 * Pure portfolio-history reconstruction — no DB, no network, no globals, so it
 * can be unit-tested directly (see src/portfolioHistory.test.ts). The service
 * layer (portfolioHistoryService.ts) gathers transactions + price history and
 * feeds them here.
 *
 * Approach: replay BUY/SELL transactions into a per-symbol share timeline, then
 * for each calendar day multiply shares held by that day's (forward-filled)
 * close and sum across symbols to get market value. A parallel "net invested"
 * line tracks cumulative contributions (buy cost − sell proceeds), and an
 * optional benchmark line simulates putting each net contribution into an index
 * at that day's price.
 *
 * Known limitation: values are summed nominally across currencies (matching the
 * rest of the app); no FX conversion is applied.
 */

export interface PHTransaction {
  symbol?: string | null;
  type?: string | null;
  units?: number | null;
  price?: number | null;
  amount?: number | null;
  date?: string | null;
}

export interface PriceCandleLite {
  date: string;     // 'YYYY-MM-DD'
  close: number | null;
}

export interface PortfolioHistoryPoint {
  date: string;
  value: number;        // market value of holdings
  invested: number;     // cumulative net contributions (cost basis in market)
  benchmark?: number;   // simulated value if contributions tracked the benchmark
}

export interface PortfolioHistoryResult {
  points: PortfolioHistoryPoint[];
  summary: {
    startDate: string | null;
    endDate: string | null;
    endValue: number;
    netInvested: number;
    totalReturn: number;       // endValue - netInvested
    totalReturnPct: number;    // vs netInvested
    benchmarkEndValue: number | null;
    benchmarkReturnPct: number | null;
  };
}

const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();

// SnapTrade type codes we treat as share-changing trades.
const BUY_TYPES = new Set(["BUY", "BUYTOOPEN", "REINVEST", "DRIP"]);
const SELL_TYPES = new Set(["SELL", "SELLTOCLOSE"]);

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return isoDay(d);
}

/**
 * Signed share delta for a trade. BUY adds shares, SELL removes them. SnapTrade
 * sometimes reports SELL units as already-negative, so we normalize on the type
 * code and use the absolute unit count.
 */
function shareDelta(txn: PHTransaction): number {
  const t = norm(txn.type);
  const u = Math.abs(txn.units ?? 0);
  if (BUY_TYPES.has(t)) return u;
  if (SELL_TYPES.has(t)) return -u;
  return 0;
}

/**
 * Cash contribution delta for a trade (for the net-invested line):
 * a buy is money in (+cost), a sell is money out (−proceeds). Uses `amount`
 * when present (already net of fees), else falls back to units×price.
 */
function contributionDelta(txn: PHTransaction): number {
  const t = norm(txn.type);
  const amt = txn.amount != null ? Math.abs(txn.amount) : Math.abs((txn.units ?? 0) * (txn.price ?? 0));
  if (BUY_TYPES.has(t)) return amt;
  if (SELL_TYPES.has(t)) return -amt;
  return 0;
}

/**
 * Build a date → close lookup with forward-fill, so weekends/holidays/missing
 * days reuse the last known price. Returns a function (iso) => close|null.
 */
function makePriceLookup(series: PriceCandleLite[]): (iso: string) => number | null {
  const sorted = [...series].filter(c => c.close != null).sort((a, b) => a.date.localeCompare(b.date));
  let cursor = 0;
  let last: number | null = null;
  // The lookup is only ever called with non-decreasing dates (we iterate the
  // calendar forward), so a single advancing cursor is enough.
  return (iso: string) => {
    while (cursor < sorted.length && sorted[cursor].date <= iso) {
      last = sorted[cursor].close;
      cursor++;
    }
    return last;
  };
}

export function reconstructPortfolioHistory(
  transactions: PHTransaction[],
  priceSeriesBySymbol: Map<string, PriceCandleLite[]>,
  benchmark?: { symbol: string; series: PriceCandleLite[] }
): PortfolioHistoryResult {
  // Trades with a usable symbol + date, sorted chronologically.
  const trades = transactions
    .filter(t => t.symbol && t.date && shareDelta(t) !== 0)
    .map(t => ({ ...t, _day: isoDay(new Date(t.date as string)) }))
    .sort((a, b) => a._day.localeCompare(b._day));

  if (trades.length === 0) {
    return {
      points: [],
      summary: {
        startDate: null, endDate: null, endValue: 0, netInvested: 0,
        totalReturn: 0, totalReturnPct: 0, benchmarkEndValue: null, benchmarkReturnPct: null,
      },
    };
  }

  const startDate = trades[0]._day;
  const endDate = isoDay(new Date());

  // Per-symbol forward-filled price lookups (only for symbols we actually hold).
  const symbols = Array.from(new Set(trades.map(t => norm(t.symbol))));
  const priceLookups = new Map<string, (iso: string) => number | null>();
  for (const sym of symbols) {
    priceLookups.set(sym, makePriceLookup(priceSeriesBySymbol.get(sym) ?? []));
  }
  const benchLookup = benchmark ? makePriceLookup(benchmark.series) : null;

  // Group trades by day for efficient replay.
  const tradesByDay = new Map<string, typeof trades>();
  for (const t of trades) {
    const list = tradesByDay.get(t._day) ?? [];
    list.push(t);
    tradesByDay.set(t._day, list);
  }

  const shares = new Map<string, number>();   // symbol → shares held
  let netInvested = 0;
  let benchUnits = 0;                          // simulated benchmark "shares"

  const points: PortfolioHistoryPoint[] = [];

  for (let day = startDate; day <= endDate; day = addDay(day)) {
    // Apply the day's trades first, so the close-of-day valuation includes them.
    const todays = tradesByDay.get(day);
    if (todays) {
      for (const t of todays) {
        const sym = norm(t.symbol);
        shares.set(sym, (shares.get(sym) ?? 0) + shareDelta(t));
        const contrib = contributionDelta(t);
        netInvested += contrib;
        // Mirror the contribution into the benchmark at the day's index price.
        if (benchLookup) {
          const bp = benchLookup(day);
          if (bp && bp > 0) benchUnits += contrib / bp;
        }
      }
    }

    // Value holdings at the day's forward-filled close.
    let value = 0;
    for (const [sym, qty] of shares) {
      if (qty === 0) continue;
      const px = priceLookups.get(sym)!(day);
      if (px != null) value += qty * px;
    }

    const point: PortfolioHistoryPoint = {
      date: day,
      value: round2(value),
      invested: round2(netInvested),
    };
    if (benchLookup) {
      const bp = benchLookup(day);
      point.benchmark = round2(bp != null ? benchUnits * bp : 0);
    }
    points.push(point);
  }

  const endValue = points.length ? points[points.length - 1].value : 0;
  const benchmarkEndValue = points.length && benchLookup ? (points[points.length - 1].benchmark ?? 0) : null;
  const totalReturn = endValue - netInvested;

  return {
    points,
    summary: {
      startDate,
      endDate,
      endValue,
      netInvested: round2(netInvested),
      totalReturn: round2(totalReturn),
      totalReturnPct: netInvested > 0 ? round2((totalReturn / netInvested) * 100) : 0,
      benchmarkEndValue: benchmarkEndValue != null ? round2(benchmarkEndValue) : null,
      benchmarkReturnPct: benchmarkEndValue != null && netInvested > 0
        ? round2(((benchmarkEndValue - netInvested) / netInvested) * 100)
        : null,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

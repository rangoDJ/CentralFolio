/**
 * Pure T5008 / Schedule 3 disposition math (no DB/network) — unit-tested in
 * src/t5008.test.ts.
 *
 * Builds one disposition record per SELL, in the shape of the CRA T5008 slip
 * boxes, using the average-cost (ACB) method required for identical properties
 * held by an individual:
 *
 *   Box 13 — foreign currency of the trade
 *   Box 14 — date of disposition
 *   Box 15 — type code of the security (SHS / MFT / BON)
 *   Box 16 — quantity disposed
 *   Box 17 — identification of the security
 *   Box 20 — cost or book value (ACB of the units sold)
 *   Box 21 — proceeds of disposition
 *
 * Two things this does that a naive proceeds-minus-cost calculation does not:
 *
 * 1. **Per-trade FX.** Every amount is converted at the rate on that trade's own
 *    date. Converting the net gain at a single rate is wrong whenever the
 *    exchange rate moved between the buy and the sell — the currency movement is
 *    itself part of the Canadian-dollar gain.
 *
 * 2. **Superficial losses (ITA s.54).** A loss is denied when identical property
 *    is reacquired in the window from 30 days before to 30 days after the sale
 *    AND is still held at the end of that window. The denied amount is added to
 *    the ACB of the retained units rather than disappearing.
 *
 * Registered accounts (RRSP/TFSA) are filtered out upstream — dispositions in
 * them are not reportable.
 */

export interface T5008Transaction {
  symbol?: string | null;
  description?: string | null;
  type?: string | null;
  action?: string | null;
  units?: number | null;
  price?: number | null;
  amount?: number | null;
  date?: string | null;
  currencyCode?: string | null;
}

export interface Disposition {
  symbol: string;              // Box 17
  description: string;
  date: string;                // Box 14 — YYYY-MM-DD
  year: number;
  quantity: number;            // Box 16
  currency: string;            // Box 13 — currency the trade settled in
  securityType: string;        // Box 15 — SHS / MFT / BON

  // Native-currency figures, as the broker's slip will show them.
  proceedsNative: number;      // Box 21
  costBasisNative: number;     // Box 20

  // CAD figures — what actually goes on Schedule 3.
  proceeds: number;
  costBasis: number;
  outlays: number;             // commissions, when derivable
  gain: number;                // proceeds - costBasis - outlays, before denial

  fxRate: number | null;       // rate applied on the disposition date
  fxRateMissing: boolean;      // true when no rate was found and 1.0 was assumed

  // Superficial-loss outcome.
  superficialLoss: number;     // portion of a loss denied (positive number)
  allowableGain: number;       // gain after denial — the reportable figure
  superficialNote: string | null;
}

export interface ScheduleThreeSummary {
  year: number;
  proceeds: number;
  costBasis: number;
  outlays: number;
  netGain: number;             // sum of allowableGain
  deniedLosses: number;
  inclusionRate: number;
  taxableCapitalGain: number;  // max(0, netGain) × inclusion rate
}

export interface T5008Result {
  dispositions: Disposition[];
  summaryByYear: ScheduleThreeSummary[];
  warnings: string[];
}

const INCLUSION_RATE = 0.5;
const SUPERFICIAL_WINDOW_DAYS = 30;

const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();
const round2 = (n: number) => Math.round(n * 100) / 100;

const BUY_TYPES = new Set(["BUY", "BUYTOOPEN", "REINVEST", "DRIP"]);
const SELL_TYPES = new Set(["SELL", "SELLTOCLOSE"]);

/** A transaction's effective side, checking both `type` and `action`. */
function sideOf(t: T5008Transaction): "buy" | "sell" | null {
  for (const raw of [t.type, t.action]) {
    const v = norm(raw);
    if (BUY_TYPES.has(v)) return "buy";
    if (SELL_TYPES.has(v)) return "sell";
  }
  return null;
}

/**
 * All-in cash cost of a purchase, in native currency.
 *
 * `amount` is the cash that actually left the account, so it already includes
 * the commission — capitalizing a separately-derived commission on top would
 * double-count it. Only when `amount` is absent do we fall back to units×price.
 */
function buyCostOf(t: T5008Transaction, units: number): number {
  if (t.amount != null) return Math.abs(t.amount);
  return units * Math.abs(t.price ?? 0);
}

/**
 * Split a sale into gross proceeds (Box 21) and outlays, in native currency.
 *
 * CRA wants gross proceeds with the commission reported separately as an outlay;
 * brokers usually give net cash in `amount`. When both `price` and `amount` are
 * present the gap between them is the commission. The resulting gain is the same
 * either way — this just puts each figure in the box it belongs in.
 */
function saleAmountsOf(t: T5008Transaction, units: number): { proceeds: number; outlays: number } {
  const net = t.amount != null ? Math.abs(t.amount) : null;
  const gross = t.price != null ? units * Math.abs(t.price) : null;

  if (net != null && gross != null) {
    const diff = gross - net;
    // Ignore rounding noise and implausible gaps (stale price data, splits).
    const plausible = diff > 0.005 && diff <= gross * 0.1;
    return plausible ? { proceeds: gross, outlays: diff } : { proceeds: net, outlays: 0 };
  }
  return { proceeds: net ?? gross ?? 0, outlays: 0 };
}

/** CRA security type code, inferred from the instrument. */
function securityType(symbol: string, description: string): string {
  const s = `${symbol} ${description}`.toUpperCase();
  if (/\bBOND\b|\bDEBENTURE\b/.test(s)) return "BON";
  if (/\bFUND\b|\bETF\b|\bTRUST\b|\bINDEX\b/.test(s)) return "MFT";
  return "SHS";
}

const dayMs = 24 * 60 * 60 * 1000;
const addDays = (iso: string, n: number) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * dayMs).toISOString().slice(0, 10);

interface Priced extends T5008Transaction {
  _date: string;
  _side: "buy" | "sell";
  _units: number;
}

export interface FxLookup {
  /** Rate from the trade currency to CAD on the given date, or null if unknown. */
  (currency: string, date: string): number | null;
}

/**
 * Build dispositions from a transaction list.
 *
 * @param txns   all buy/sell transactions for the reportable (non-registered)
 *               accounts. Pass every year — ACB depends on the full history, so
 *               filtering by year before this point produces a wrong cost base.
 * @param fxRate resolves a trade's currency to CAD on its date.
 */
export function computeDispositions(txns: T5008Transaction[], fxRate: FxLookup): T5008Result {
  const warnings: string[] = [];
  const bySymbol = new Map<string, Priced[]>();

  for (const t of txns) {
    const symbol = norm(t.symbol);
    const side = sideOf(t);
    const units = Math.abs(t.units ?? 0);
    if (!symbol || !t.date || !side || units <= 0) continue;
    const list = bySymbol.get(symbol) ?? [];
    list.push({ ...t, _date: String(t.date).slice(0, 10), _side: side, _units: units });
    bySymbol.set(symbol, list);
  }

  const dispositions: Disposition[] = [];

  for (const [symbol, list] of bySymbol) {
    const sorted = [...list].sort((a, b) => a._date.localeCompare(b._date));

    // Share-count timeline — used to answer "was the property still held at the
    // end of the 30-day window?" without re-simulating for every loss.
    const timeline: Array<{ date: string; shares: number }> = [];
    let running = 0;
    for (const t of sorted) {
      running += t._side === "buy" ? t._units : -t._units;
      timeline.push({ date: t._date, shares: Math.max(0, running) });
    }
    const sharesHeldAt = (iso: string): number => {
      let held = 0;
      for (const point of timeline) {
        if (point.date > iso) break;
        held = point.shares;
      }
      return held;
    };

    // Two cost pools run in parallel: CAD is what Schedule 3 needs, native is
    // what the broker's slip will show. They are NOT convertible into each other
    // after the fact — the native cost was incurred at the buy-date rate, so
    // dividing the CAD pool by the sell-date rate would be wrong.
    let acb = 0;       // CAD cost base of currently-held units
    let acbNative = 0; // same, in the security's trading currency
    let shares = 0;

    for (const t of sorted) {
      const units = t._units;
      const currency = norm(t.currencyCode) || "CAD";
      const rawRate = fxRate(currency, t._date);
      const fxRateMissing = rawRate == null && currency !== "CAD";
      const rate = rawRate ?? 1;

      if (fxRateMissing) {
        const w = `No ${currency}→CAD rate for ${t._date} (${symbol}) — used 1.0`;
        if (!warnings.includes(w)) warnings.push(w);
      }

      if (t._side === "buy") {
        const costNative = buyCostOf(t, units);
        acb += costNative * rate;
        acbNative += costNative;
        shares += units;
        continue;
      }

      // ── Disposition ────────────────────────────────────────────────────────
      const soldUnits = Math.min(units, shares > 0 ? shares : units);
      const sharePortion = shares > 0 ? soldUnits / shares : 0;
      const costBasis = acb * sharePortion;
      const costBasisNative = acbNative * sharePortion;

      const { proceeds: proceedsNative, outlays: outlaysNative } = saleAmountsOf(t, units);
      const proceeds = proceedsNative * rate;
      const outlays = outlaysNative * rate;
      const gain = proceeds - costBasis - outlays;

      // ── Superficial loss test ──────────────────────────────────────────────
      let superficialLoss = 0;
      let superficialNote: string | null = null;

      if (gain < 0) {
        const windowStart = addDays(t._date, -SUPERFICIAL_WINDOW_DAYS);
        const windowEnd = addDays(t._date, SUPERFICIAL_WINDOW_DAYS);
        const reacquired = sorted
          .filter(o => o._side === "buy" && o._date >= windowStart && o._date <= windowEnd)
          .reduce((sum, o) => sum + o._units, 0);
        const stillHeld = sharesHeldAt(windowEnd);

        if (reacquired > 0 && stillHeld > 0) {
          // Denied proportionally: only the units substituted by the repurchase
          // and still held at the end of the window taint the loss.
          const deniedUnits = Math.min(reacquired, soldUnits, stillHeld);
          superficialLoss = Math.abs(gain) * (deniedUnits / soldUnits);
          superficialNote =
            `${round2(deniedUnits)} of ${round2(soldUnits)} units reacquired within 30 days ` +
            `and still held on ${windowEnd} — loss denied and added to ACB`;
        }
      }

      const allowableGain = gain + superficialLoss;
      const description = String(t.description ?? "").trim() || symbol;

      dispositions.push({
        symbol,
        description,
        date: t._date,
        year: Number(t._date.slice(0, 4)),
        quantity: round2(soldUnits),
        currency,
        securityType: securityType(symbol, description),
        proceedsNative: round2(proceedsNative),
        costBasisNative: round2(costBasisNative),
        proceeds: round2(proceeds),
        costBasis: round2(costBasis),
        outlays: round2(outlays),
        gain: round2(gain),
        fxRate: rawRate,
        fxRateMissing,
        superficialLoss: round2(superficialLoss),
        allowableGain: round2(allowableGain),
        superficialNote,
      });

      // A denied loss is not lost — it is added back to the cost base of the
      // units that remain, so it is recovered on the eventual real disposition.
      acb = Math.max(0, acb - costBasis) + superficialLoss;
      acbNative = Math.max(0, acbNative - costBasisNative) + (rate !== 0 ? superficialLoss / rate : 0);
      shares = Math.max(0, shares - soldUnits);
    }
  }

  dispositions.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

  return { dispositions, summaryByYear: summarizeByYear(dispositions), warnings };
}

/** Schedule 3 roll-up: the figures that go on the return, one row per year. */
export function summarizeByYear(dispositions: Disposition[]): ScheduleThreeSummary[] {
  const byYear = new Map<number, ScheduleThreeSummary>();

  for (const d of dispositions) {
    const s = byYear.get(d.year) ?? {
      year: d.year, proceeds: 0, costBasis: 0, outlays: 0,
      netGain: 0, deniedLosses: 0, inclusionRate: INCLUSION_RATE, taxableCapitalGain: 0,
    };
    s.proceeds += d.proceeds;
    s.costBasis += d.costBasis;
    s.outlays += d.outlays;
    s.netGain += d.allowableGain;
    s.deniedLosses += d.superficialLoss;
    byYear.set(d.year, s);
  }

  return Array.from(byYear.values())
    .map(s => ({
      ...s,
      proceeds: round2(s.proceeds),
      costBasis: round2(s.costBasis),
      outlays: round2(s.outlays),
      netGain: round2(s.netGain),
      deniedLosses: round2(s.deniedLosses),
      taxableCapitalGain: round2(Math.max(0, s.netGain) * INCLUSION_RATE),
    }))
    .sort((a, b) => b.year - a.year);
}

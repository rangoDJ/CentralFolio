import { logger } from "../utils/logger.js";
import { assetCurrency, getFxRate } from "./fxService.js";

/**
 * Side-by-side comparison of the symbols held across several user portfolios.
 *
 * The interesting output is the *gaps*: a symbol one portfolio holds and
 * another doesn't is a candidate to buy, so every row carries a cell for every
 * selected portfolio — held or not — rather than only the intersection.
 *
 * Every monetary field in the result is expressed in one `baseCurrency` (see
 * `resolveCompareRates`). Summing native amounts across currencies would make
 * both the totals and the weight percentages wrong for any portfolio holding
 * US- and Canada-listed positions side by side — the same trap documented on
 * `fxService.toBaseCurrency`. The two exceptions are `price` and `priceCurrency`,
 * which stay in the security's own currency because they feed a trade order.
 *
 * `comparePortfolios` itself is pure (no DB, no network) like
 * `rebalanceService.computeRebalance`, so the matrix logic is unit-testable
 * with a stub rate table; fetching real rates lives in `resolveCompareRates`
 * and the DB walk lives in the controller.
 */

export interface CompareAccountInput {
  accountId: string;
  accountName: string;
  /** SnapTrade credential group the account lives under — needed to place a trade. */
  parentPortfolioId: string;
  tradingEnabled: boolean;
  /** The account's own currency — what its cash balance is denominated in. */
  currency: string;
  cash: number;
  positions: {
    symbol?: string | null;
    symbolId?: string | null;
    description?: string | null;
    units?: number | null;
    price?: number | null;
    marketValue?: number | null;
    averagePurchasePrice?: number | null;
  }[];
}

export interface ComparePortfolioInput {
  id: number;
  name: string;
  color: string;
  accounts: CompareAccountInput[];
}

/** Exchange rates into a single base currency, resolved once per request. */
export interface CompareRates {
  baseCurrency: string;
  /** Multiplier taking an amount in `currency` into `baseCurrency`. */
  rateOf: (currency: string) => number;
  /** Currencies whose rate could not be fetched — those amounts count 1:1. */
  unresolved: string[];
}

/** One portfolio's stake in one symbol. `held: false` is the buy candidate. */
export interface CompareCell {
  held: boolean;
  units: number;
  /** Base currency. */
  cost: number;
  /** Base currency. */
  value: number;
  /** The security's own currency — this is a trade input, not a report figure. */
  price: number;
  /** Base currency per share. */
  avgCost: number;
  /** Base currency. Converted at today's rate, so it excludes FX gain/loss. */
  profit: number;
  profitPct: number;
  /** Share of this portfolio's total market value, in percent. */
  weightPct: number;
}

export interface CompareRow {
  symbol: string;
  description: string;
  /** Universal symbol id from whichever portfolio holds it — lets a gap be traded. */
  symbolId: string;
  /** Last known price from any holder, in `priceCurrency`, for sizing a purchase. */
  price: number;
  /** Currency `price` is quoted in — may differ from the report's base currency. */
  priceCurrency: string;
  heldCount: number;
  missingCount: number;
  /** Ids of the selected portfolios that do NOT hold this symbol. */
  missingIn: number[];
  /** Base currency. */
  totalValue: number;
  cells: Record<string, CompareCell>;
}

export interface ComparePortfolioSummary {
  id: number;
  name: string;
  color: string;
  /** Base currency. */
  totalValue: number;
  /** Base currency. */
  cash: number;
  holdings: number;
  /** Native currencies present in this portfolio, most valuable first. */
  currencies: string[];
  /** Accounts that can actually receive a buy order, for the "buy the gap" action. */
  tradableAccounts: { accountId: string; accountName: string; parentPortfolioId: string }[];
}

export interface CompareResult {
  /** Currency every monetary field below is expressed in. */
  baseCurrency: string;
  /** Currencies counted 1:1 because their rate could not be fetched. */
  fxUnresolved: string[];
  portfolios: ComparePortfolioSummary[];
  rows: CompareRow[];
  /** Distinct symbols across every selected portfolio. */
  symbolCount: number;
  /** Symbols every selected portfolio holds. */
  commonCount: number;
  /** Symbols exactly one selected portfolio holds. */
  uniqueCount: number;
}

const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

const emptyCell = (): CompareCell => ({
  held: false, units: 0, cost: 0, value: 0, price: 0,
  avgCost: 0, profit: 0, profitPct: 0, weightPct: 0,
});

/** Market value of a position, falling back to units × price. */
function positionValue(pos: CompareAccountInput["positions"][number]): number {
  return pos.marketValue ?? (pos.units ?? 0) * (pos.price ?? 0);
}

/**
 * Native amount held per currency across the whole selection.
 *
 * Positions are attributed by the security's currency (the ticker suffix, via
 * `assetCurrency`) — the convention the rest of the analytics layer uses — while
 * cash follows the account it sits in.
 */
export function nativeAmountsByCurrency(inputs: ComparePortfolioInput[]): Map<string, number> {
  const out = new Map<string, number>();
  const add = (cur: string, amount: number) => {
    if (!amount) return;
    out.set(cur, (out.get(cur) ?? 0) + amount);
  };

  for (const p of inputs) {
    for (const acct of p.accounts) {
      add(norm(acct.currency) || "USD", acct.cash || 0);
      for (const pos of acct.positions) {
        const symbol = norm(pos.symbol);
        if (!symbol) continue;
        add(assetCurrency(symbol), positionValue(pos));
      }
    }
  }
  return out;
}

/**
 * Pick the base currency (the one holding the most value, matching
 * `manualAssetService` and `diversificationService`) and fetch a rate for every
 * other currency present.
 *
 * `getFxRate` returns 1 on failure, which would silently understate a converted
 * total; a genuine cross-currency rate is never exactly 1, so that case is
 * reported through `unresolved` instead of being hidden.
 */
export async function resolveCompareRates(inputs: ComparePortfolioInput[]): Promise<CompareRates> {
  const native = nativeAmountsByCurrency(inputs);
  const baseCurrency = native.size
    ? Array.from(native.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : "USD";

  const rates = new Map<string, number>();
  const unresolved: string[] = [];
  await Promise.all(Array.from(native.keys()).map(async cur => {
    const rate = await getFxRate(cur, baseCurrency);
    if (cur !== baseCurrency && rate === 1) unresolved.push(cur);
    rates.set(cur, rate);
  }));

  if (native.size > 1) {
    logger.info("Compare", `Converting ${native.size} currencies into ${baseCurrency}`
      + (unresolved.length ? ` (no rate for ${unresolved.sort().join(", ")})` : ""));
  }

  return { baseCurrency, rateOf: cur => rates.get(cur) ?? 1, unresolved: unresolved.sort() };
}

export function comparePortfolios(inputs: ComparePortfolioInput[], rates: CompareRates): CompareResult {
  logger.info("Compare", `Comparing ${inputs.length} portfolio(s) in ${rates.baseCurrency}`);

  // symbol → per-portfolio accumulator, plus the row-level metadata (description,
  // symbolId, price) taken from whichever portfolio does hold it.
  const rows = new Map<string, CompareRow>();
  const summaries: ComparePortfolioSummary[] = [];

  for (const p of inputs) {
    const key = String(p.id);
    let totalValue = 0;
    let cash = 0;
    const nativeByCurrency = new Map<string, number>();
    const tradableAccounts: ComparePortfolioSummary["tradableAccounts"] = [];
    const held = new Set<string>();

    for (const acct of p.accounts) {
      const acctCurrency = norm(acct.currency) || "USD";
      const acctCash = acct.cash || 0;
      cash += acctCash * rates.rateOf(acctCurrency);
      if (acctCash) nativeByCurrency.set(acctCurrency, (nativeByCurrency.get(acctCurrency) ?? 0) + acctCash);

      if (acct.tradingEnabled) {
        tradableAccounts.push({
          accountId: acct.accountId,
          accountName: acct.accountName,
          parentPortfolioId: acct.parentPortfolioId,
        });
      }

      for (const pos of acct.positions) {
        const symbol = norm(pos.symbol);
        if (!symbol) continue;

        const units = pos.units ?? 0;
        const price = pos.price ?? 0;
        if (units === 0 && price === 0) continue;

        const currency = assetCurrency(symbol);
        const rate = rates.rateOf(currency);
        const nativeValue = positionValue(pos);
        const value = nativeValue * rate;
        const avg = pos.averagePurchasePrice ?? 0;
        // No average cost recorded (e.g. a transferred-in position) — treating
        // cost as market value reports 0 profit rather than a fictitious 100% gain.
        const cost = (avg > 0 ? units * avg : nativeValue) * rate;
        nativeByCurrency.set(currency, (nativeByCurrency.get(currency) ?? 0) + nativeValue);

        let row = rows.get(symbol);
        if (!row) {
          row = {
            symbol,
            description: String(pos.description || symbol),
            symbolId: String(pos.symbolId || ""),
            price,
            priceCurrency: currency,
            heldCount: 0,
            missingCount: 0,
            missingIn: [],
            totalValue: 0,
            cells: {},
          };
          rows.set(symbol, row);
        }
        if (!row.symbolId && pos.symbolId) row.symbolId = String(pos.symbolId);
        if (price > 0) row.price = price;

        const cell = row.cells[key] ?? (row.cells[key] = emptyCell());
        cell.held = true;
        cell.units += units;
        cell.cost += cost;
        cell.value += value;
        if (price > 0) cell.price = price;

        totalValue += value;
        held.add(symbol);
      }
    }

    summaries.push({
      id: p.id,
      name: p.name,
      color: p.color,
      totalValue: round2(totalValue),
      cash: round2(cash),
      holdings: held.size,
      currencies: Array.from(nativeByCurrency.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([cur]) => cur),
      tradableAccounts,
    });
  }

  const totalByPortfolio = new Map(summaries.map(s => [String(s.id), s.totalValue]));

  for (const row of rows.values()) {
    for (const s of summaries) {
      const key = String(s.id);
      const cell = row.cells[key] ?? (row.cells[key] = emptyCell());
      if (!cell.held) {
        row.missingCount++;
        row.missingIn.push(s.id);
        continue;
      }
      row.heldCount++;
      cell.avgCost = cell.units > 0 ? round4(cell.cost / cell.units) : 0;
      cell.profit = round2(cell.value - cell.cost);
      cell.profitPct = cell.cost > 0 ? round2(((cell.value - cell.cost) / cell.cost) * 100) : 0;
      const total = totalByPortfolio.get(key) ?? 0;
      cell.weightPct = total > 0 ? round2((cell.value / total) * 100) : 0;
      cell.units = round4(cell.units);
      cell.cost = round2(cell.cost);
      cell.value = round2(cell.value);
      row.totalValue += cell.value;
    }
    row.totalValue = round2(row.totalValue);
  }

  const list = Array.from(rows.values()).sort((a, b) =>
    b.totalValue - a.totalValue || a.symbol.localeCompare(b.symbol));

  const result: CompareResult = {
    baseCurrency: rates.baseCurrency,
    fxUnresolved: rates.unresolved,
    portfolios: summaries,
    rows: list,
    symbolCount: list.length,
    commonCount: list.filter(r => r.heldCount === summaries.length && summaries.length > 0).length,
    uniqueCount: list.filter(r => r.heldCount === 1).length,
  };

  logger.info("Compare", `${result.symbolCount} distinct symbol(s), ${result.commonCount} common, ${result.uniqueCount} unique to one portfolio`);
  return result;
}

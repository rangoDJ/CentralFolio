import { getCachedPositions, getMergedTransactions } from "../models/db.js";
import { getScopedAccounts } from "./accountScope.js";
import { classifyAccount } from "./taxRules.js";
import { getT5008Report } from "./t5008Service.js";
import { poolKey, sideOf } from "./t5008.js";
import { getFxRate } from "./fxService.js";
import { assetCurrency } from "./fxService.js";
import {
  planHarvest,
  SUPERFICIAL_WINDOW_DAYS,
  addDays,
  type HarvestHolding,
  type HarvestPlan,
  type RecentAcquisition,
} from "./taxLossHarvest.js";
import { logger } from "../utils/logger.js";

/**
 * Assembles the inputs the harvest planner reasons over.
 *
 * The pooled ACB comes from the T5008 replay rather than the broker's
 * average purchase price, because cost base is pooled across accounts and
 * across the CAD/USD listings of one security — a per-account average would
 * give a different, wrong loss.
 */

const BASE_CURRENCY = "CAD";
const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();

/** Reinvestment types that recur on their own inside the superficial window. */
const AUTOMATIC_TYPES = new Set(["REINVEST", "DRIP"]);

function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Acquisitions in the last 30 days across EVERY account, registered included.
 *
 * Registered purchases matter and are the worst case: buying the same security
 * in an RRSP or TFSA within the window denies the loss outright rather than
 * deferring it into the cost base. The T5008 report deliberately never sees
 * registered transactions, so they are gathered here instead.
 */
function recentAcquisitions(today: string): RecentAcquisition[] {
  const windowStart = addDays(today, -SUPERFICIAL_WINDOW_DAYS);
  const out: RecentAcquisition[] = [];

  for (const acct of getScopedAccounts(null)) {
    const label = acct.customName || acct.name || "Account";
    const registered = classifyAccount(acct.type || acct.name || "") !== "taxable";

    for (const t of getMergedTransactions(acct.id)) {
      if (sideOf(t) !== "buy") continue;
      const date = String(t.date ?? "").slice(0, 10);
      if (!date || date < windowStart || date > today) continue;
      const symbol = norm(t.symbol);
      if (!symbol) continue;

      out.push({
        poolKey: poolKey(symbol),
        date,
        units: Math.abs(t.units ?? 0),
        registered,
        accountLabel: label,
        automatic: AUTOMATIC_TYPES.has(norm(t.type)) || AUTOMATIC_TYPES.has(norm(t.action)),
      });
    }
  }
  return out;
}

/** Current market value per pool, in CAD, across taxable accounts only. */
async function taxableMarketValues(): Promise<Map<string, { value: number; units: number; label: string; symbol: string }>> {
  const byPool = new Map<string, { value: number; units: number; label: string; symbol: string }>();
  const nativeByPool = new Map<string, { native: number; currency: string }>();

  for (const acct of getScopedAccounts(null)) {
    if (classifyAccount(acct.type || acct.name || "") !== "taxable") continue;
    const label = acct.customName || acct.name || "Account";

    for (const pos of getCachedPositions(acct.id)) {
      const symbol = norm(pos.symbol);
      if (!symbol) continue;
      const key = poolKey(symbol);
      const units = pos.units ?? 0;
      const value = pos.marketValue ?? units * (pos.price ?? 0);
      if (!value) continue;

      const existing = byPool.get(key);
      byPool.set(key, {
        value: 0,                                   // filled after FX below
        units: (existing?.units ?? 0) + units,
        label: existing ? `${existing.label}` : label,
        symbol: existing?.symbol ?? symbol,
      });
      const native = nativeByPool.get(key);
      nativeByPool.set(key, {
        native: (native?.native ?? 0) + value,
        currency: assetCurrency(symbol),
      });
    }
  }

  // Convert each pool's native market value into CAD, matching the currency the
  // ACB pool is denominated in.
  for (const [key, { native, currency }] of nativeByPool) {
    const rate = await getFxRate(currency, BASE_CURRENCY);
    const entry = byPool.get(key);
    if (entry) entry.value = native * rate;
  }

  return byPool;
}

export interface HarvestReport extends HarvestPlan {
  baseCurrency: string;
  asOf: string;
  /** Repurchasing any harvested holding before this date taints the loss. */
  repurchaseAfter: string;
  marginalRatePct: number | null;
}

/**
 * Build the harvest report for the current taxable holdings.
 *
 * `year` defaults to the current calendar year — capital gains are netted per
 * tax year, so offsetting against another year's gain would be wrong.
 */
export async function getHarvestReport(
  marginalRatePct: number | null = null,
  now: Date = new Date(),
): Promise<HarvestReport> {
  const today = todayIso(now);
  const year = now.getUTCFullYear();

  // The T5008 report gives both this year's realized gain and the pooled ACB
  // still open per security, from the same replay.
  const report = await getT5008Report(year, null);
  const realizedGainYtd = report.summaryByYear.reduce((sum, s) => sum + s.netGain, 0);

  const marketValues = await taxableMarketValues();

  const holdings: HarvestHolding[] = [];
  for (const open of report.openPositions) {
    const market = marketValues.get(open.poolKey);
    // A pool with no current position in a taxable account cannot be harvested
    // — it was fully sold, or is only held inside a registered account.
    if (!market || market.units <= 0) continue;

    holdings.push({
      symbol: open.symbol,
      poolKey: open.poolKey,
      accountLabel: market.label,
      units: market.units,
      marketValue: market.value,
      acb: open.acb,
    });
  }

  const plan = planHarvest(holdings, realizedGainYtd, recentAcquisitions(today), today, marginalRatePct);

  logger.info(
    "Harvest",
    `${plan.candidates.length} loss candidate(s) across ${holdings.length} taxable pool(s); ` +
    `realized ${plan.realizedGainYtd}, harvestable ${plan.harvestableLoss}, offset ${plan.offsetTotal}`,
  );

  return {
    ...plan,
    baseCurrency: BASE_CURRENCY,
    asOf: today,
    repurchaseAfter: addDays(today, SUPERFICIAL_WINDOW_DAYS),
    marginalRatePct,
  };
}

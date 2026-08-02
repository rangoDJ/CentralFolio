import { getCachedTransactions } from "../models/db.js";
import { getScopedAccounts } from "./accountScope.js";
import { computeRealizedGains } from "./realizedGains.js";
import { classifyAccount } from "./taxRules.js";
import { logger } from "../utils/logger.js";

const INCLUSION_RATE = 0.5; // Canadian capital-gains inclusion rate.
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface YearGain { year: number; gain: number; taxableGain: number; }
export interface AccountGain { account: string; gain: number; registered: boolean; }
export interface RealizedGainsBreakdown {
  totalGain: number;
  taxableAccountGain: number;     // realized gains in non-registered accounts
  inclusionRate: number;
  estimatedTaxableIncome: number; // taxableAccountGain × inclusion (floored at 0)
  byYear: YearGain[];
  byAccount: AccountGain[];
  currency: string;
}

export function getRealizedGains(allowedIds?: Set<string> | null): RealizedGainsBreakdown {
  const byYear = new Map<number, { gain: number; taxableGain: number }>();
  const byAccount: AccountGain[] = [];
  let totalGain = 0, taxableAccountGain = 0, currency = "CAD";

  for (const acct of getScopedAccounts(allowedIds)) {
    const cls = classifyAccount(`${acct.type || ""} ${acct.customName || acct.name || ""}`);
    const registered = cls === "rrsp" || cls === "tfsa";
    const label = acct.customName || acct.name || "Account";
    if (acct.currency) currency = acct.currency;

    const { events, totalGain: acctGain } = computeRealizedGains(getCachedTransactions(acct.id));
    if (events.length === 0) continue;

    byAccount.push({ account: label, gain: round2(acctGain), registered });
    totalGain += acctGain;
    if (!registered) taxableAccountGain += acctGain;

    for (const e of events) {
      const y = byYear.get(e.year) ?? { gain: 0, taxableGain: 0 };
      y.gain += e.gain;
      if (!registered) y.taxableGain += e.gain;
      byYear.set(e.year, y);
    }
  }

  const years: YearGain[] = Array.from(byYear.entries())
    .map(([year, v]) => ({ year, gain: round2(v.gain), taxableGain: round2(v.taxableGain) }))
    .sort((a, b) => b.year - a.year);

  logger.info("RealizedGains", `total=${round2(totalGain)}, taxableAccountGain=${round2(taxableAccountGain)}`);
  return {
    totalGain: round2(totalGain),
    taxableAccountGain: round2(taxableAccountGain),
    inclusionRate: INCLUSION_RATE,
    estimatedTaxableIncome: round2(Math.max(0, taxableAccountGain) * INCLUSION_RATE),
    byYear: years,
    byAccount: byAccount.sort((a, b) => b.gain - a.gain),
    currency,
  };
}

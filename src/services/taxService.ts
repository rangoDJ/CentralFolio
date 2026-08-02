/**
 * Dividend withholding-tax estimator (Canada-centric).
 *
 * Estimates foreign withholding tax on projected annual dividend income, broken
 * down by account and source country. The headline rules:
 *   - Canadian-source dividends: no withholding in any account.
 *   - US-source dividends: 15% withheld — EXCEPT in RRSP/RRIF, which the Canada–US
 *     treaty exempts (0%). TFSA and taxable/margin accounts are withheld 15%
 *     (TFSA cannot reclaim it; taxable accounts can claim a foreign tax credit).
 *   - Other foreign dividends: treated as 15% in all account types (estimate).
 *
 * The classification + rate logic is pure (exported for tests); the aggregation
 * reads cached positions / dividend metadata / asset profiles.
 */

import { getCachedPositions, getCachedDividendMetadata } from "../models/db.js";
import { getScopedAccounts } from "./accountScope.js";
import { getProfile } from "../repositories/assetProfileRepository.js";
import { classifyAccount, sourceCountry, withholdingRate } from "./taxRules.js";
import { logger } from "../utils/logger.js";

export interface TaxSlice { key: string; income: number; withheld: number; rate: number; }
export interface TaxBreakdown {
  totalIncome: number;
  totalWithheld: number;
  effectiveRate: number;          // totalWithheld / totalIncome
  afterTaxIncome: number;
  byAccount: TaxSlice[];
  byCountry: TaxSlice[];
  currency: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function getDividendTaxBreakdown(allowedIds?: Set<string> | null): TaxBreakdown {
  const byAccount = new Map<string, { income: number; withheld: number }>();
  const byCountry = new Map<string, { income: number; withheld: number }>();
  let totalIncome = 0, totalWithheld = 0, currency = "CAD";

  for (const acct of getScopedAccounts(allowedIds)) {
    const cls = classifyAccount(`${acct.type || ""} ${acct.customName || acct.name || ""}`);
    const acctLabel = acct.customName || acct.name || "Account";

    for (const pos of getCachedPositions(acct.id)) {
      const symbol = pos.symbol;
      const units = pos.units || 0;
      if (!symbol || units <= 0) continue;

      const meta = getCachedDividendMetadata(symbol);
      const annualPerShare = (meta?.amountPerShare || 0) * (meta?.frequency || 0);
      if (annualPerShare <= 0) continue;

      const income = annualPerShare * units;
      const country = sourceCountry(symbol, getProfile(symbol)?.country);
      const rate = withholdingRate(cls, country);
      const withheld = income * rate;

      totalIncome += income;
      totalWithheld += withheld;
      if (acct.currency) currency = acct.currency;

      const a = byAccount.get(acctLabel) ?? { income: 0, withheld: 0 };
      a.income += income; a.withheld += withheld; byAccount.set(acctLabel, a);
      const c = byCountry.get(country) ?? { income: 0, withheld: 0 };
      c.income += income; c.withheld += withheld; byCountry.set(country, c);
    }
  }

  const toSlices = (m: Map<string, { income: number; withheld: number }>): TaxSlice[] =>
    Array.from(m.entries())
      .map(([key, v]) => ({ key, income: round2(v.income), withheld: round2(v.withheld), rate: v.income > 0 ? v.withheld / v.income : 0 }))
      .sort((a, b) => b.withheld - a.withheld);

  logger.info("Tax", `Withholding estimate: income=${round2(totalIncome)}, withheld=${round2(totalWithheld)}`);
  return {
    totalIncome: round2(totalIncome),
    totalWithheld: round2(totalWithheld),
    effectiveRate: totalIncome > 0 ? totalWithheld / totalIncome : 0,
    afterTaxIncome: round2(totalIncome - totalWithheld),
    byAccount: toSlices(byAccount),
    byCountry: toSlices(byCountry),
    currency,
  };
}

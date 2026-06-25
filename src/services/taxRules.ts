/**
 * Pure dividend withholding-tax rules (no DB/network) — unit-tested in
 * src/taxService.test.ts. The aggregation in taxService.ts uses these.
 *
 * Canada-centric rules:
 *   - Canadian-source dividends: no withholding in any account.
 *   - US-source dividends: 15% withheld — EXCEPT RRSP/RRIF (Canada–US treaty
 *     exempts these, 0%). TFSA and taxable/margin are withheld 15%.
 *   - Other foreign dividends: treated as 15% in all account types (estimate).
 */

export type AccountClass = "rrsp" | "tfsa" | "taxable";
export type SourceCountry = "Canada" | "United States" | "Other";

const norm = (s: unknown) => String(s ?? "").toUpperCase();

/** Classify an account's registration type from its broker type/name. */
export function classifyAccount(typeOrName: string): AccountClass {
  const s = norm(typeOrName);
  if (/\b(RRSP|RRIF|LIRA|LRSP|RPP|SRSP|RSP)\b/.test(s)) return "rrsp";
  if (/\b(TFSA|RESP|FHSA)\b/.test(s)) return "tfsa";
  return "taxable";
}

/** Source country bucket for a symbol from its profile or exchange suffix. */
export function sourceCountry(symbol: string, profileCountry?: string | null): SourceCountry {
  if (profileCountry) {
    if (/canada/i.test(profileCountry)) return "Canada";
    if (/united states|usa|u\.s/i.test(profileCountry)) return "United States";
    return "Other";
  }
  // Fall back to the exchange suffix (.TO/.V/.CN/.NE = Canada; bare ticker = US).
  if (/\.(TO|V|VN|CN|NE)$/i.test(symbol)) return "Canada";
  return "United States";
}

/** Withholding rate (fraction) for a country in a given account class. */
export function withholdingRate(cls: AccountClass, country: SourceCountry): number {
  if (country === "Canada") return 0;
  if (country === "United States") return cls === "rrsp" ? 0 : 0.15;
  return 0.15; // other foreign — estimate
}

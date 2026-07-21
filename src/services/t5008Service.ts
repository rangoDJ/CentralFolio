/**
 * T5008 report aggregation.
 *
 * Pulls buy/sell transactions from the cached accounts, primes the historical FX
 * cache for every currency/date pair the trades touch, and runs the pure math in
 * t5008.ts.
 *
 * Scope rule: only NON-REGISTERED accounts are included. Dispositions inside an
 * RRSP/RRIF/TFSA/RESP/FHSA are not capital dispositions for tax purposes and no
 * T5008 is issued for them — including them would overstate taxable gains.
 */

import { listPortfolios, getCachedAccounts, getActiveAccountIds, getCachedTransactions } from "../models/db.js";
import { classifyAccount } from "./taxRules.js";
import { primeFxHistory, fxRateOn, assetCurrency } from "./fxService.js";
import { computeDispositions, summarizeByYear, type Disposition, type T5008Result, type T5008Transaction } from "./t5008.js";
import { logger } from "../utils/logger.js";

const BASE_CURRENCY = "CAD";

export interface AccountDisposition extends Disposition {
  account: string;
  accountId: string;
}

export interface T5008Report extends Omit<T5008Result, "dispositions"> {
  dispositions: AccountDisposition[];
  year: number | null;              // null = all years
  availableYears: number[];
  baseCurrency: string;
  excludedRegisteredAccounts: string[];
}

/** Transactions for one reportable account, tagged with its label. */
interface AccountTxns {
  accountId: string;
  label: string;
  txns: T5008Transaction[];
}

/** Collect buy/sell transactions from every active, non-registered account. */
function collectReportableAccounts(allowedIds?: Set<string> | null): {
  accounts: AccountTxns[];
  excluded: string[];
} {
  const activeIds = getActiveAccountIds();
  const accounts: AccountTxns[] = [];
  const excluded: string[] = [];

  for (const portfolio of listPortfolios()) {
    for (const acct of getCachedAccounts(portfolio.id!)) {
      if (!activeIds.has(acct.id)) continue;
      if (allowedIds && !allowedIds.has(acct.id)) continue;

      const label = acct.customName || acct.name || "Account";
      const cls = classifyAccount(`${acct.type || ""} ${acct.customName || acct.name || ""}`);
      if (cls !== "taxable") {
        excluded.push(label);
        continue;
      }

      const txns = getCachedTransactions(acct.id) as T5008Transaction[];
      if (txns.length > 0) accounts.push({ accountId: acct.id, label, txns });
    }
  }

  return { accounts, excluded };
}

/**
 * Resolve each transaction's currency. Brokers are inconsistent about
 * `currencyCode`, so fall back to the currency implied by the ticker's exchange
 * suffix (bare ticker → USD, `.TO` → CAD).
 */
function currencyOf(t: T5008Transaction): string {
  const explicit = String(t.currencyCode ?? "").toUpperCase().trim();
  if (explicit) return explicit;
  return assetCurrency(String(t.symbol ?? ""));
}

/** Ensure the FX cache covers every non-CAD currency over the trades' date span. */
async function primeRatesFor(txns: T5008Transaction[]): Promise<void> {
  const spans = new Map<string, { min: string; max: string }>();

  for (const t of txns) {
    if (!t.date) continue;
    const cur = currencyOf(t);
    if (cur === BASE_CURRENCY) continue;
    const date = String(t.date).slice(0, 10);
    const span = spans.get(cur);
    if (!span) spans.set(cur, { min: date, max: date });
    else {
      if (date < span.min) span.min = date;
      if (date > span.max) span.max = date;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  await Promise.all(
    Array.from(spans.entries()).map(([cur, span]) =>
      primeFxHistory(cur, BASE_CURRENCY, span.min, span.max > today ? today : span.max)
    )
  );
}

/**
 * Build the T5008 report.
 *
 * ACB is always computed over the account's FULL history — `year` filters the
 * dispositions that are *displayed*, never the transactions the cost base is
 * derived from.
 */
export async function getT5008Report(
  year?: number | null,
  allowedIds?: Set<string> | null
): Promise<T5008Report> {
  const { accounts, excluded } = collectReportableAccounts(allowedIds);

  // Normalize currency once so the FX prime and the math agree on it.
  for (const a of accounts) {
    a.txns = a.txns.map(t => ({ ...t, currencyCode: currencyOf(t) }));
  }

  await primeRatesFor(accounts.flatMap(a => a.txns));

  const lookup = (currency: string, date: string) => fxRateOn(currency, BASE_CURRENCY, date);

  const allDispositions: AccountDisposition[] = [];
  const warnings: string[] = [];

  // Run per account — ACB pools are per-account here rather than per-taxpayer.
  // (CRA technically pools identical property across all non-registered accounts;
  // see the note surfaced in the UI when more than one taxable account is in play.)
  for (const acct of accounts) {
    const result = computeDispositions(acct.txns, lookup);
    for (const d of result.dispositions) {
      allDispositions.push({ ...d, account: acct.label, accountId: acct.accountId });
    }
    for (const w of result.warnings) if (!warnings.includes(w)) warnings.push(w);
  }

  if (accounts.length > 1) {
    warnings.push(
      `ACB is pooled per account across ${accounts.length} taxable accounts. CRA pools identical ` +
      `property across all your non-registered accounts — if you hold the same security in more ` +
      `than one, the combined cost base differs from the per-account figures below.`
    );
  }

  allDispositions.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

  const availableYears = Array.from(new Set(allDispositions.map(d => d.year))).sort((a, b) => b - a);
  const filtered = year ? allDispositions.filter(d => d.year === year) : allDispositions;

  logger.info(
    "T5008",
    `year=${year ?? "all"} accounts=${accounts.length} dispositions=${filtered.length} ` +
    `excludedRegistered=${excluded.length}`
  );

  // Summarize from the filtered set so a single-year view totals that year only.
  return {
    dispositions: filtered,
    summaryByYear: summarizeByYear(filtered),
    warnings,
    year: year ?? null,
    availableYears,
    baseCurrency: BASE_CURRENCY,
    excludedRegisteredAccounts: excluded,
  };
}

// ── CSV export ────────────────────────────────────────────────────────────────

/** Escape a value for CSV, guarding against spreadsheet formula injection. */
function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADERS = [
  "Account",
  "Box 14 - Date of disposition",
  "Box 17 - Identification of securities",
  "Description",
  "Box 15 - Type code",
  "Box 16 - Quantity",
  "Box 13 - Foreign currency",
  "Box 21 - Proceeds (native)",
  "Box 20 - Cost or book value (native)",
  "FX rate to CAD",
  "Proceeds (CAD)",
  "Cost or book value (CAD)",
  "Outlays and expenses (CAD)",
  "Gain/loss (CAD)",
  "Superficial loss denied (CAD)",
  "Reportable gain/loss (CAD)",
  "Notes",
];

export function dispositionsToCsv(dispositions: AccountDisposition[]): string {
  const rows = dispositions.map(d => [
    d.account,
    d.date,
    d.symbol,
    d.description,
    d.securityType,
    d.quantity,
    d.currency,
    d.proceedsNative,
    d.costBasisNative,
    d.fxRate == null ? "" : Math.round(d.fxRate * 1e6) / 1e6,
    d.proceeds,
    d.costBasis,
    d.outlays,
    d.gain,
    d.superficialLoss || "",
    d.allowableGain,
    [d.superficialNote, d.fxRateMissing ? "FX rate unavailable — 1.0 assumed" : null]
      .filter(Boolean).join("; "),
  ]);

  return [CSV_HEADERS, ...rows]
    .map(r => r.map(csvCell).join(","))
    .join("\r\n");
}

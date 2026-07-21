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
import { computeCarryingCharges, type CarryingChargesResult, type CCTransaction } from "./carryingCharges.js";
import { logger } from "../utils/logger.js";

const BASE_CURRENCY = "CAD";

/** Dispositions already carry their account label from the pooled pass. */
export type AccountDisposition = Disposition;

export interface T5008Report extends Omit<T5008Result, "dispositions"> {
  dispositions: AccountDisposition[];
  year: number | null;              // null = all years
  availableYears: number[];
  baseCurrency: string;
  excludedRegisteredAccounts: string[];
  /**
   * Schedule 4 / line 22100 — carrying charges and interest expense. Delivered
   * on the same payload because it shares this screen and the same year filter,
   * but it is a different line on the return from the T5008 dispositions.
   */
  carryingCharges: CarryingChargesResult;
}

/** Transactions for one account, tagged with its label and registration class. */
interface AccountTxns {
  accountId: string;
  label: string;
  registered: boolean;
  txns: T5008Transaction[];
}

/**
 * Collect transactions from every active account, tagged with whether the
 * account is registered.
 *
 * Registered accounts are kept rather than dropped here because the two
 * consumers need different things: dispositions must exclude them (not
 * reportable), while carrying charges need to see them in order to report how
 * many non-deductible entries were skipped.
 */
function collectAccounts(allowedIds?: Set<string> | null): {
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
      const registered = cls !== "taxable";
      // Several accounts can share a broker-assigned name; only list each once.
      if (registered && !excluded.includes(label)) excluded.push(label);

      const txns = getCachedTransactions(acct.id) as T5008Transaction[];
      if (txns.length > 0) accounts.push({ accountId: acct.id, label, registered, txns });
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
  const { accounts, excluded } = collectAccounts(allowedIds);

  // Normalize currency once so the FX prime and the math agree on it.
  for (const a of accounts) {
    a.txns = a.txns.map(t => ({ ...t, currencyCode: currencyOf(t) }));
  }

  await primeRatesFor(accounts.flatMap(a => a.txns));

  const lookup = (currency: string, date: string) => fxRateOn(currency, BASE_CURRENCY, date);

  // Tag every transaction with its account once; both passes below need it.
  const tagged = accounts.flatMap(a =>
    a.txns.map(t => ({ ...t, account: a.label, accountId: a.accountId, registered: a.registered }))
  );

  // ONE pooled pass over every taxable account. CRA treats identical property as
  // a single pool across all of a taxpayer's non-registered accounts, so the
  // transactions are tagged with their account and then merged — computing per
  // account would give a different cost base for anything held in two places.
  // Registered accounts are dropped here: their dispositions are not reportable.
  const result = computeDispositions(tagged.filter(t => !t.registered), lookup);
  const allDispositions: AccountDisposition[] = result.dispositions;
  const warnings: string[] = [...result.warnings];

  // Carrying charges see EVERY account, including registered ones, so the
  // non-deductible entries can be counted and explained rather than vanishing.
  const allCharges = computeCarryingCharges(tagged as CCTransaction[], lookup);
  const carryingCharges = year
    ? filterChargesToYear(allCharges, year)
    : allCharges;

  const availableYears = Array.from(new Set([
    ...allDispositions.map(d => d.year),
    ...allCharges.charges.map(c => c.year),
  ])).sort((a, b) => b - a);

  const filtered = year ? allDispositions.filter(d => d.year === year) : allDispositions;

  logger.info(
    "T5008",
    `year=${year ?? "all"} accounts=${accounts.length} dispositions=${filtered.length} ` +
    `carryingCharges=${carryingCharges.charges.length} (${carryingCharges.total}) ` +
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
    carryingCharges,
  };
}

/**
 * Narrow a carrying-charges result to one tax year, recomputing the totals so
 * the headline figures match the rows on screen. Warnings are kept as-is —
 * they describe the whole dataset, not the selected slice.
 */
function filterChargesToYear(r: CarryingChargesResult, year: number): CarryingChargesResult {
  const charges = r.charges.filter(c => c.year === year);
  const sum = (kind: string) =>
    Math.round(charges.filter(c => c.kind === kind).reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const totalInterest = sum("interest");
  const totalFees = sum("fee");
  return {
    ...r,
    charges,
    byYear: r.byYear.filter(y => y.year === year),
    totalInterest,
    totalFees,
    total: Math.round((totalInterest + totalFees) * 100) / 100,
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

/**
 * Carrying charges appended as a labelled second block after the dispositions.
 * Kept in the same file because they belong to the same tax year and the user
 * exports them together, but separated by a blank line and their own header so
 * nothing reads them as dispositions — they are a different line on the return.
 */
function carryingChargesCsvBlock(cc: CarryingChargesResult): string {
  if (cc.charges.length === 0) return "";
  const header = ["Date", "Charge type", "Description", "Account", "Currency", "Amount (native)", "FX rate to CAD", "Amount (CAD)"];
  const rows = cc.charges.map(c => [
    c.date,
    c.label,
    c.description,
    c.account,
    c.currency,
    c.amountNative,
    c.fxRate == null ? "" : Math.round(c.fxRate * 1e6) / 1e6,
    c.amount,
  ]);
  const total = ["", "", "", "", "", "", "TOTAL (Schedule 4, line 22100)", cc.total];

  return [
    "",
    "CARRYING CHARGES AND INTEREST EXPENSE - Schedule 4 line 22100 (NOT part of the T5008)",
    header.map(csvCell).join(","),
    ...rows.map(r => r.map(csvCell).join(",")),
    total.map(csvCell).join(","),
  ].join("\r\n");
}

export function dispositionsToCsv(dispositions: AccountDisposition[], carryingCharges?: CarryingChargesResult): string {
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

  const dispositionBlock = [CSV_HEADERS, ...rows]
    .map(r => r.map(csvCell).join(","))
    .join("\r\n");

  return carryingCharges
    ? dispositionBlock + carryingChargesCsvBlock(carryingCharges)
    : dispositionBlock;
}

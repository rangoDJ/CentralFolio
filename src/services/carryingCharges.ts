/**
 * Pure carrying-charges math (no DB/network) — unit-tested in
 * src/carryingCharges.test.ts.
 *
 * Carrying charges and interest expense go on **Schedule 4, line 22100** — NOT
 * on the T5008, which reports dispositions only. They are shown on the same
 * screen because they come from the same transaction feed and the same tax
 * year, but they are a different line on the return.
 *
 * What counts (CRA):
 *   - Interest paid on money borrowed to earn investment INCOME (interest or
 *     dividends). Margin loan interest is the common case.
 *   - Fees for the administration or management of non-registered investments.
 *
 * What deliberately does NOT count, and why:
 *   - Anything in a registered account (RRSP/RRIF/TFSA/RESP/FHSA). Fees and
 *     interest inside a registered plan are never deductible.
 *   - Trading commissions. They are not carrying charges — they adjust the ACB
 *     of the security instead, which t5008.ts already does. Counting them here
 *     would deduct the same dollar twice.
 *   - Foreign withholding tax. That is a foreign tax credit item, not a
 *     carrying charge.
 *   - Interest RECEIVED. A positive interest amount is investment income
 *     (reported on a T5), not an expense.
 *
 * Deductibility of margin interest depends on what the borrowed money was used
 * for — interest is only deductible where the borrowing earns income, not where
 * it purely funds a capital gain. That test cannot be made from a transaction
 * feed, so entries are reported as candidates, never as a settled deduction.
 */

export interface CCTransaction {
  type?: string | null;
  action?: string | null;
  description?: string | null;
  amount?: number | null;
  date?: string | null;
  currencyCode?: string | null;
  account?: string | null;
  accountId?: string | null;
  /** Set by the caller from the account's registration class. */
  registered?: boolean;
}

export type ChargeKind = "interest" | "fee";

export interface CarryingCharge {
  date: string;
  year: number;
  kind: ChargeKind;
  label: string;
  description: string;
  account: string;
  accountId: string;
  currency: string;
  amountNative: number;   // positive = money out
  amount: number;         // positive, in CAD
  fxRate: number | null;
  fxRateMissing: boolean;
}

export interface CarryingChargeYear {
  year: number;
  interest: number;
  fees: number;
  total: number;
}

export interface CarryingChargesResult {
  charges: CarryingCharge[];
  byYear: CarryingChargeYear[];
  totalInterest: number;
  totalFees: number;
  total: number;
  /** Charges found in registered accounts — reported, but NOT deductible. */
  excludedRegistered: number;
  warnings: string[];
}

const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();
const round2 = (n: number) => Math.round(n * 100) / 100;

const INTEREST_TYPES = new Set(["INTEREST", "MARGIN_INTEREST", "INTEREST_CHARGED", "LOAN_INTEREST"]);
const FEE_TYPES = new Set(["FEE", "FEES", "SERVICE_FEE", "MANAGEMENT_FEE", "ADMIN_FEE"]);

/**
 * Commission-like fees ride along with a trade and are already capitalized into
 * the ACB, so they must not also be deducted here.
 */
const COMMISSION_RE = /\bCOMMISSION\b|\bECN\b|\bSEC FEE\b|\bTAF\b|\bEXCHANGE FEE\b|\bTRADING FEE\b/i;

export interface CCFxLookup {
  (currency: string, date: string): number | null;
}

function classify(t: CCTransaction): ChargeKind | null {
  const type = norm(t.type);
  const action = norm(t.action);
  if (INTEREST_TYPES.has(type) || INTEREST_TYPES.has(action)) return "interest";
  if (FEE_TYPES.has(type) || FEE_TYPES.has(action)) return "fee";
  return null;
}

export function computeCarryingCharges(txns: CCTransaction[], fxRate: CCFxLookup): CarryingChargesResult {
  const charges: CarryingCharge[] = [];
  const warnings: string[] = [];
  let excludedRegistered = 0;
  let skippedCommission = 0;
  let interestReceived = 0;

  for (const t of txns) {
    const kind = classify(t);
    if (!kind || !t.date) continue;

    const raw = t.amount ?? 0;

    // Positive = money in. Interest received is income, not an expense.
    if (raw >= 0) {
      if (kind === "interest") interestReceived++;
      continue;
    }

    const description = String(t.description ?? "").trim();
    if (kind === "fee" && COMMISSION_RE.test(description)) {
      // Already in the ACB via t5008.ts — deducting it here would double-count.
      skippedCommission++;
      continue;
    }

    if (t.registered) {
      excludedRegistered++;
      continue;
    }

    const date = String(t.date).slice(0, 10);
    const currency = norm(t.currencyCode) || "CAD";
    const rawRate = fxRate(currency, date);
    const fxRateMissing = rawRate == null && currency !== "CAD";
    const rate = rawRate ?? 1;
    const amountNative = Math.abs(raw);

    charges.push({
      date,
      year: Number(date.slice(0, 4)),
      kind,
      label: kind === "interest" ? "Interest expense" : "Investment fee",
      description: description || (kind === "interest" ? "Interest charged" : "Fee"),
      account: String(t.account ?? "").trim() || "Account",
      accountId: String(t.accountId ?? ""),
      currency,
      amountNative: round2(amountNative),
      amount: round2(amountNative * rate),
      fxRate: rawRate,
      fxRateMissing,
    });

    if (fxRateMissing) {
      const w = `No ${currency}→CAD rate for ${date} (carrying charge) — used 1.0`;
      if (!warnings.includes(w)) warnings.push(w);
    }
  }

  charges.sort((a, b) => a.date.localeCompare(b.date));

  const byYearMap = new Map<number, CarryingChargeYear>();
  for (const c of charges) {
    const y = byYearMap.get(c.year) ?? { year: c.year, interest: 0, fees: 0, total: 0 };
    if (c.kind === "interest") y.interest += c.amount;
    else y.fees += c.amount;
    y.total += c.amount;
    byYearMap.set(c.year, y);
  }

  const byYear = Array.from(byYearMap.values())
    .map(y => ({ year: y.year, interest: round2(y.interest), fees: round2(y.fees), total: round2(y.total) }))
    .sort((a, b) => b.year - a.year);

  if (excludedRegistered > 0) {
    warnings.push(
      `${excludedRegistered} interest/fee entr${excludedRegistered === 1 ? "y" : "ies"} in registered ` +
      `accounts were excluded — fees and interest inside an RRSP/TFSA are never deductible.`
    );
  }
  if (skippedCommission > 0) {
    warnings.push(
      `${skippedCommission} commission-like fee(s) were excluded — trading commissions adjust the ACB ` +
      `of the security (already applied in the disposition table) and cannot also be claimed here.`
    );
  }
  if (interestReceived > 0) {
    warnings.push(
      `${interestReceived} interest entr${interestReceived === 1 ? "y was" : "ies were"} interest ` +
      `RECEIVED, not charged. That is investment income reported on a T5 — it is not a carrying ` +
      `charge and is excluded here.`
    );
  }

  const totalInterest = round2(charges.filter(c => c.kind === "interest").reduce((s, c) => s + c.amount, 0));
  const totalFees = round2(charges.filter(c => c.kind === "fee").reduce((s, c) => s + c.amount, 0));

  return {
    charges,
    byYear,
    totalInterest,
    totalFees,
    total: round2(totalInterest + totalFees),
    excludedRegistered,
    warnings,
  };
}

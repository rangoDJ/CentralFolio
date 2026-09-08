import { getCachedPositions } from "../models/db.js";
import { getScopedAccounts } from "./accountScope.js";
import { saveSnapshots, getSnapshotCoverage, type Snapshot } from "../repositories/snapshotRepository.js";
import { logger } from "../utils/logger.js";

/**
 * Nightly capture of what every active account is actually worth.
 *
 * Reads only the local position cache — no brokerage calls — so it is cheap and
 * cannot fail on a rate limit. It runs after the holdings refresh, so the cache
 * it reads is the day's synced data.
 */

/** Today in UTC, matching the 'YYYY-MM-DD' convention used across the app. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Value one account from its cached positions plus cash balance.
 * Exported for tests — pure given its inputs.
 */
export function valueAccount(
  positions: { marketValue?: number | null; units?: number | null; price?: number | null }[],
  cash: number,
): { marketValue: number; cash: number; positions: number } {
  let marketValue = 0;
  let counted = 0;
  for (const p of positions) {
    const value = p.marketValue ?? (p.units ?? 0) * (p.price ?? 0);
    if (!value) continue;
    marketValue += value;
    counted++;
  }
  return { marketValue: round2(marketValue), cash: round2(cash), positions: counted };
}

export interface SnapshotRunResult {
  date: string;
  accounts: number;
  skippedEmpty: number;
  totalValue: number;
}

/**
 * Capture today's snapshot for every active account.
 *
 * Accounts with no positions *and* no cash are skipped rather than written as
 * zero rows: a brokerage connection that failed to sync would otherwise record
 * a genuine-looking crash to zero in the performance history.
 */
export function captureSnapshots(date: string = todayIso()): SnapshotRunResult {
  const rows: Snapshot[] = [];
  let skippedEmpty = 0;

  for (const acct of getScopedAccounts(null)) {
    const cash = acct.balance?.cash?.amount ?? acct.cashBalance ?? 0;
    const valued = valueAccount(getCachedPositions(acct.id), cash);

    if (valued.positions === 0 && valued.cash === 0) {
      skippedEmpty++;
      continue;
    }

    rows.push({
      accountId: acct.id,
      date,
      marketValue: valued.marketValue,
      cash: valued.cash,
      currency: acct.currency ?? null,
      positions: valued.positions,
    });
  }

  saveSnapshots(rows);

  const totalValue = round2(rows.reduce((sum, r) => sum + r.marketValue + r.cash, 0));
  logger.info("Snapshots", `Captured ${rows.length} account snapshot(s) for ${date}` +
    (skippedEmpty > 0 ? `, skipped ${skippedEmpty} empty` : "") +
    ` — total ${totalValue}`);

  return { date, accounts: rows.length, skippedEmpty, totalValue };
}

/** Human-readable coverage line for the jobs panel. */
export function snapshotCoverageSummary(): string {
  const { count, firstDate, lastDate } = getSnapshotCoverage();
  if (count === 0) return "No snapshots recorded yet";
  return `${count} snapshot row(s), ${firstDate} → ${lastDate}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

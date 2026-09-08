import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

/**
 * Point-in-time record of what each account was actually worth on a given day.
 *
 * The performance chart reconstructs history by replaying transactions against
 * price history, which is only as complete as the transaction ledger. Anything
 * the broker never reported — an in-kind transfer, activity predating the
 * connection — silently vanishes from the curve; the T5008 module's
 * unrecorded-transfer detection exists precisely because that gap is common.
 *
 * A snapshot is independent of the ledger: it records the value observed that
 * day. Reconstruction still covers everything before snapshots began, so the
 * two are complementary rather than redundant.
 */

export interface Snapshot {
  accountId: string;
  date: string;          // 'YYYY-MM-DD'
  marketValue: number;   // securities only, in the account's own currency
  cash: number;
  currency: string | null;
  positions: number;
  createdAt?: string;
}

const stmtUpsert = db.prepare(`
  INSERT INTO portfolio_snapshots (accountId, date, marketValue, cash, currency, positions, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(accountId, date) DO UPDATE SET
    marketValue = excluded.marketValue,
    cash        = excluded.cash,
    currency    = excluded.currency,
    positions   = excluded.positions,
    createdAt   = CURRENT_TIMESTAMP
`);

const stmtForAccount = db.prepare(
  "SELECT * FROM portfolio_snapshots WHERE accountId = ? ORDER BY date ASC"
);

const stmtAll = db.prepare(
  "SELECT * FROM portfolio_snapshots ORDER BY date ASC"
);

const stmtLatestDate = db.prepare(
  "SELECT MAX(date) AS d FROM portfolio_snapshots"
);

const stmtEarliestDate = db.prepare(
  "SELECT MIN(date) AS d FROM portfolio_snapshots"
);

const stmtCount = db.prepare(
  "SELECT COUNT(*) AS n FROM portfolio_snapshots"
);

const stmtDeleteForAccount = db.prepare(
  "DELETE FROM portfolio_snapshots WHERE accountId = ?"
);

const stmtClearAll = db.prepare("DELETE FROM portfolio_snapshots");

/**
 * Record (or overwrite) one account's value for a date. Re-running the capture
 * job on the same day replaces that day's row rather than appending — the last
 * observation of a day is the one worth keeping.
 */
export function saveSnapshot(s: Snapshot): void {
  stmtUpsert.run(s.accountId, s.date, s.marketValue, s.cash, s.currency ?? null, s.positions);
}

export function saveSnapshots(snapshots: Snapshot[]): number {
  if (snapshots.length === 0) return 0;
  db.transaction(() => { for (const s of snapshots) saveSnapshot(s); })();
  logger.debug("Snapshots", `Saved ${snapshots.length} snapshot row(s)`);
  return snapshots.length;
}

export function getSnapshotsForAccount(accountId: string): Snapshot[] {
  return stmtForAccount.all(accountId) as Snapshot[];
}

export function getAllSnapshots(): Snapshot[] {
  return stmtAll.all() as Snapshot[];
}

/**
 * Total portfolio value per date across the given accounts (or all when null).
 *
 * Values are summed in their native currencies, matching how the rest of the
 * history pipeline treats multi-currency accounts — see the note in
 * portfolioHistory.ts.
 */
export function getSnapshotTotalsByDate(allowedIds: Set<string> | null): Map<string, number> {
  const totals = new Map<string, number>();
  for (const s of getAllSnapshots()) {
    if (allowedIds && !allowedIds.has(s.accountId)) continue;
    totals.set(s.date, (totals.get(s.date) ?? 0) + s.marketValue);
  }
  return totals;
}

export function getSnapshotCoverage(): { count: number; firstDate: string | null; lastDate: string | null } {
  return {
    count: (stmtCount.get() as { n: number }).n,
    firstDate: (stmtEarliestDate.get() as { d: string | null }).d,
    lastDate: (stmtLatestDate.get() as { d: string | null }).d,
  };
}

export function deleteSnapshotsForAccount(accountId: string): void {
  stmtDeleteForAccount.run(accountId);
}

export function clearSnapshots(): void {
  logger.warn("Snapshots", "clearSnapshots() — wiping all point-in-time history");
  stmtClearAll.run();
}

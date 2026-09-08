import { db } from "../models/database.js";
import { getCachedTransactions } from "./transactionRepository.js";
import { logger } from "../utils/logger.js";
import { emitDataChanged } from "../services/eventBus.js";

/**
 * User-entered transactions, for activity the brokerage connection never
 * supplied — trades that predate the connection, and in-kind transfers the
 * broker reports without a cost base.
 *
 * These exist because the T5008 report can *detect* a missing cost base
 * (`missingCostBasis`) and tells the user to "enter the real ACB from your
 * broker's records", but until now there was nowhere to enter it. Every such
 * disposition reports the full proceeds as a gain.
 *
 * Kept in a separate table from `transactions` rather than mixed in, because
 * that table is a broker cache: `saveCachedTransactions` upserts into it on
 * every sync and `clearTransactionsForAccount` wipes it when an account is
 * deactivated. A hand-entered row in there would be silently destroyed.
 */

export interface ManualTransaction {
  id: number;
  accountId: string;
  symbol: string | null;
  description: string | null;
  type: string;
  units: number | null;
  price: number | null;
  amount: number | null;
  date: string;              // 'YYYY-MM-DD'
  currencyCode: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ManualTransactionInput {
  accountId: string;
  symbol?: string | null;
  description?: string | null;
  type: string;
  units?: number | null;
  price?: number | null;
  amount?: number | null;
  date: string;
  currencyCode?: string | null;
  notes?: string | null;
}

// ── Prepared statements ───────────────────────────────────────────────────────

const stmtListAll = db.prepare(
  "SELECT * FROM manual_transactions ORDER BY date DESC, id DESC"
);

const stmtListForAccount = db.prepare(
  "SELECT * FROM manual_transactions WHERE accountId = ? ORDER BY date DESC, id DESC"
);

const stmtGetById = db.prepare(
  "SELECT * FROM manual_transactions WHERE id = ?"
);

const stmtInsert = db.prepare(`
  INSERT INTO manual_transactions
    (accountId, symbol, description, type, units, price, amount, date, currencyCode, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtUpdate = db.prepare(`
  UPDATE manual_transactions SET
    accountId = ?, symbol = ?, description = ?, type = ?, units = ?,
    price = ?, amount = ?, date = ?, currencyCode = ?, notes = ?
  WHERE id = ?
`);

const stmtDelete = db.prepare("DELETE FROM manual_transactions WHERE id = ?");

const stmtCountForAccount = db.prepare(
  "SELECT COUNT(*) AS n FROM manual_transactions WHERE accountId = ?"
);

// ── Mapping ───────────────────────────────────────────────────────────────────

/**
 * Present a manual row in the same shape the analytics services expect from a
 * cached brokerage transaction, so they need no special-casing.
 *
 * `transactionId` is namespaced so it can never collide with a broker-issued
 * id, and `manual` lets the ledger UI badge the row. `action` is null because
 * the side lives in `type` — `sideOf()` checks both.
 */
function toLedgerRow(r: ManualTransaction) {
  return {
    id: r.id,
    transactionId: `manual:${r.id}`,
    accountId: r.accountId,
    symbol: r.symbol,
    description: r.description,
    type: r.type,
    action: null,
    units: r.units,
    price: r.price,
    amount: r.amount,
    date: r.date,
    currencyCode: r.currencyCode,
    notes: r.notes,
    cachedAt: r.createdAt,
    manual: true,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function listManualTransactions(accountId?: string): ManualTransaction[] {
  const rows = (accountId ? stmtListForAccount.all(accountId) : stmtListAll.all()) as ManualTransaction[];
  logger.debug("DB", `listManualTransactions(${accountId ?? "all"}) → ${rows.length} row(s)`);
  return rows;
}

export function getManualTransaction(id: number): ManualTransaction | null {
  return (stmtGetById.get(id) as ManualTransaction | undefined) ?? null;
}

export function createManualTransaction(input: ManualTransactionInput): ManualTransaction {
  const res = stmtInsert.run(
    input.accountId,
    input.symbol ?? null,
    input.description ?? null,
    input.type,
    input.units ?? null,
    input.price ?? null,
    input.amount ?? null,
    input.date,
    input.currencyCode ?? null,
    input.notes ?? null,
  );
  logger.info("ManualTxn", `Created ${input.type} ${input.symbol ?? ""} on ${input.date} for account ${input.accountId}`);
  emitDataChanged("transactions");
  return getManualTransaction(res.lastInsertRowid as number)!;
}

/** Insert many rows in one transaction — used by the CSV importer. */
export function createManualTransactions(inputs: ManualTransactionInput[]): number {
  if (inputs.length === 0) return 0;
  db.transaction(() => {
    for (const input of inputs) {
      stmtInsert.run(
        input.accountId,
        input.symbol ?? null,
        input.description ?? null,
        input.type,
        input.units ?? null,
        input.price ?? null,
        input.amount ?? null,
        input.date,
        input.currencyCode ?? null,
        input.notes ?? null,
      );
    }
  })();
  logger.info("ManualTxn", `Imported ${inputs.length} transaction(s)`);
  emitDataChanged("transactions");
  return inputs.length;
}

export function updateManualTransaction(id: number, input: ManualTransactionInput): ManualTransaction | null {
  if (!getManualTransaction(id)) return null;
  stmtUpdate.run(
    input.accountId,
    input.symbol ?? null,
    input.description ?? null,
    input.type,
    input.units ?? null,
    input.price ?? null,
    input.amount ?? null,
    input.date,
    input.currencyCode ?? null,
    input.notes ?? null,
    id,
  );
  logger.info("ManualTxn", `Updated manual transaction ${id}`);
  emitDataChanged("transactions");
  return getManualTransaction(id);
}

export function deleteManualTransaction(id: number): boolean {
  const res = stmtDelete.run(id);
  if (res.changes > 0) {
    logger.info("ManualTxn", `Deleted manual transaction ${id}`);
    emitDataChanged("transactions");
  }
  return res.changes > 0;
}

export function countManualTransactions(accountId: string): number {
  return (stmtCountForAccount.get(accountId) as { n: number }).n;
}

/**
 * Every transaction for an account — broker-synced plus hand-entered — newest
 * first, matching `getCachedTransactions`'s ordering.
 *
 * This is what the analytics services read. `getCachedTransactions` stays the
 * broker-only accessor: `transactionService` uses it for incremental-sync
 * bookkeeping ("what's the newest row we already have?"), and a manual
 * backfill row must not be mistaken for synced broker data there.
 */
export function getMergedTransactions(accountId: string): any[] {
  const broker = getCachedTransactions(accountId);
  const manual = listManualTransactions(accountId).map(toLedgerRow);
  if (manual.length === 0) return broker;
  return [...broker, ...manual].sort((a, b) =>
    String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

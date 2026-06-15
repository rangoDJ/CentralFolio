import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";
import { emitDataChanged } from "../services/eventBus.js";

// ── Prepared statements (compiled once at module load for performance) ─────────

const stmtGetTransactions = db.prepare(
  "SELECT * FROM transactions WHERE accountId = ? ORDER BY date DESC LIMIT ?"
);

const stmtUpsertTransaction = db.prepare(`
  INSERT INTO transactions
    (accountId, transactionId, symbol, description, type, action, units, price, amount, date, currencyCode, cachedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(transactionId) DO UPDATE SET
    accountId    = excluded.accountId,
    symbol       = excluded.symbol,
    description  = excluded.description,
    type         = excluded.type,
    action       = excluded.action,
    units        = excluded.units,
    price        = excluded.price,
    amount       = excluded.amount,
    date         = excluded.date,
    currencyCode = excluded.currencyCode,
    cachedAt     = CURRENT_TIMESTAMP
`);

/**
 * Delete rows for accountId that have a NULL transactionId (legacy rows without
 * a unique key that cannot be de-duplicated via upsert).
 */
const stmtDeleteNullId = db.prepare(
  "DELETE FROM transactions WHERE accountId = ? AND transactionId IS NULL"
);

const stmtInsertNullIdTransaction = db.prepare(`
  INSERT INTO transactions
    (accountId, transactionId, symbol, description, type, action, units, price, amount, date, currencyCode, cachedAt)
  VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

const stmtUpdateLastTransactionsFetch = db.prepare(
  "UPDATE accounts SET lastTransactionsFetch = CURRENT_TIMESTAMP WHERE id = ?"
);

const stmtDeleteForAccount = db.prepare(
  "DELETE FROM transactions WHERE accountId = ?"
);

const stmtClearAll = db.prepare("DELETE FROM transactions");

const stmtClearForAccount = db.prepare(
  "DELETE FROM transactions WHERE accountId = ?"
);

// ── Public API ────────────────────────────────────────────────────────────────

// limit omitted / <= 0 → return ALL rows (SQLite treats LIMIT -1 as unbounded).
// Pass a positive limit only when you explicitly want to cap (e.g. 1 for "latest").
export function getCachedTransactions(accountId: string, limit?: number): any[] {
  const effective = (limit == null || limit <= 0) ? -1 : limit;
  const rows = stmtGetTransactions.all(accountId, effective);
  logger.debug('DB', `getCachedTransactions(account=${accountId}) → ${rows.length} transaction(s)`);
  return rows;
}

/**
 * Persist a batch of transactions for an account.
 *
 * Strategy:
 *   - Rows that have a `transactionId` are upserted — existing rows are updated
 *     in-place so there is no gap window and no risk of returning empty data
 *     during a concurrent read.
 *   - Rows without a `transactionId` (rare edge case from some brokers) cannot
 *     be de-duplicated, so the old NULL-id rows for this account are purged
 *     first, then the new ones inserted fresh.
 *
 * This avoids the previous DELETE-all-then-INSERT pattern which left a window
 * where a concurrent request would see an empty transaction list.
 */
export function saveCachedTransactions(accountId: string, transactions: any[]) {
  logger.info('DB', `saveCachedTransactions(account=${accountId}) — saving ${transactions.length} transaction(s)`);

  const withId    = transactions.filter(t => t.id || t.transactionId);
  const withoutId = transactions.filter(t => !t.id && !t.transactionId);

  db.transaction(() => {
    // 1. Upsert rows that have a stable transactionId
    for (const txn of withId) {
      stmtUpsertTransaction.run(
        accountId,
        txn.id || txn.transactionId,
        txn.symbol       ?? null,
        txn.description  ?? null,
        txn.type         ?? null,
        txn.action       ?? null,
        txn.units        ?? null,
        txn.price        ?? null,
        txn.amount       ?? null,
        txn.date         ?? null,
        txn.currencyCode ?? null
      );
    }

    // 2. For rows without an ID, purge the old unkeyed rows for this account
    //    then insert fresh (these are rare — most brokers provide a stable ID).
    if (withoutId.length > 0) {
      stmtDeleteNullId.run(accountId);
      for (const txn of withoutId) {
        stmtInsertNullIdTransaction.run(
          accountId,
          txn.symbol       ?? null,
          txn.description  ?? null,
          txn.type         ?? null,
          txn.action       ?? null,
          txn.units        ?? null,
          txn.price        ?? null,
          txn.amount       ?? null,
          txn.date         ?? null,
          txn.currencyCode ?? null
        );
      }
    }

    // 3. Update lastTransactionsFetch timestamp
    stmtUpdateLastTransactionsFetch.run(accountId);
  })();
  emitDataChanged('transactions');
}

export function clearTransactionCache() {
  logger.warn('DB', 'clearTransactionCache() called — wiping transactions table.');
  stmtClearAll.run();
}

export function clearTransactionsForAccount(accountId: string) {
  logger.debug('DB', `clearTransactionsForAccount(${accountId})`);
  stmtClearForAccount.run(accountId);
}

import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

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

const stmtDeleteForAccount = db.prepare(
  "DELETE FROM transactions WHERE accountId = ?"
);

const stmtClearAll = db.prepare("DELETE FROM transactions");

const stmtClearForAccount = db.prepare(
  "DELETE FROM transactions WHERE accountId = ?"
);

// ── Public API ────────────────────────────────────────────────────────────────

export function getCachedTransactions(accountId: string, limit = 500): any[] {
  const rows = stmtGetTransactions.all(accountId, limit);
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
        db.prepare(`
          INSERT INTO transactions
            (accountId, transactionId, symbol, description, type, action, units, price, amount, date, currencyCode, cachedAt)
          VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
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
  })();
}

export function clearTransactionCache() {
  logger.warn('DB', 'clearTransactionCache() called — wiping transactions table.');
  stmtClearAll.run();
}

export function clearTransactionsForAccount(accountId: string) {
  logger.debug('DB', `clearTransactionsForAccount(${accountId})`);
  stmtClearForAccount.run(accountId);
}

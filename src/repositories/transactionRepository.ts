import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

export function getCachedTransactions(accountId: string, limit = 500): any[] {
  const rows = db.prepare(
    "SELECT * FROM transactions WHERE accountId = ? ORDER BY date DESC LIMIT ?"
  ).all(accountId, limit);
  logger.debug('DB', `getCachedTransactions(account=${accountId}) → ${rows.length} transaction(s)`);
  return rows;
}

export function saveCachedTransactions(accountId: string, transactions: any[]) {
  logger.info('DB', `saveCachedTransactions(account=${accountId}) — saving ${transactions.length} transaction(s)`);

  const deleteStmt = db.prepare("DELETE FROM transactions WHERE accountId = ?");
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (accountId, transactionId, symbol, description, type, action, units, price, amount, date, currencyCode, cachedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  db.transaction((data: any[]) => {
    deleteStmt.run(accountId);
    for (const txn of data) {
      insertStmt.run(
        accountId,
        txn.id || txn.transactionId || null,
        txn.symbol || null,
        txn.description || null,
        txn.type || null,
        txn.action || null,
        txn.units || null,
        txn.price || null,
        txn.amount || null,
        txn.date || null,
        txn.currencyCode || null
      );
    }
  })(transactions);
}

export function clearTransactionCache() {
  logger.warn('DB', 'clearTransactionCache() called — wiping transactions table.');
  db.prepare("DELETE FROM transactions").run();
}

export function clearTransactionsForAccount(accountId: string) {
  logger.debug('DB', `clearTransactionsForAccount(${accountId})`);
  db.prepare("DELETE FROM transactions WHERE accountId = ?").run(accountId);
}

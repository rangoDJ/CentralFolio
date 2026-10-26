import db from "../models/database.js";

export interface CashTransactionRecord {
  id: number;
  portfolioId?: number | null;
  accountId?: string | null;
  type: 'deposit' | 'withdrawal' | 'fx_convert' | 'interest' | 'fee' | 'dividend_cash' | 'adjustment';
  amount: number;
  currency: string;
  targetAmount?: number | null;
  targetCurrency?: string | null;
  exchangeRate?: number | null;
  date: string;
  note?: string | null;
  doNotAdjust: number; // 0 or 1
  createdAt: string;
}

export function listCashTransactions(options?: {
  portfolioId?: number;
  accountId?: string;
  currency?: string;
}): CashTransactionRecord[] {
  let sql = "SELECT * FROM cash_transactions WHERE 1=1";
  const params: any[] = [];

  if (options?.portfolioId != null) {
    sql += " AND (portfolioId = ? OR portfolioId IS NULL)";
    params.push(options.portfolioId);
  }
  if (options?.accountId) {
    sql += " AND (accountId = ? OR accountId IS NULL)";
    params.push(options.accountId);
  }
  if (options?.currency) {
    sql += " AND currency = ?";
    params.push(options.currency.toUpperCase());
  }

  sql += " ORDER BY date DESC, id DESC";
  return db.prepare(sql).all(...params) as CashTransactionRecord[];
}

export function createCashTransaction(data: {
  portfolioId?: number | null;
  accountId?: string | null;
  type: 'deposit' | 'withdrawal' | 'fx_convert' | 'interest' | 'fee' | 'dividend_cash' | 'adjustment';
  amount: number;
  currency: string;
  targetAmount?: number | null;
  targetCurrency?: string | null;
  exchangeRate?: number | null;
  date: string;
  note?: string | null;
  doNotAdjust?: boolean;
}): CashTransactionRecord {
  const stmt = db.prepare(`
    INSERT INTO cash_transactions (
      portfolioId, accountId, type, amount, currency,
      targetAmount, targetCurrency, exchangeRate, date, note, doNotAdjust
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    data.portfolioId ?? null,
    data.accountId ?? null,
    data.type,
    data.amount,
    data.currency.toUpperCase(),
    data.targetAmount ?? null,
    data.targetCurrency ? data.targetCurrency.toUpperCase() : null,
    data.exchangeRate ?? null,
    data.date,
    data.note ?? null,
    data.doNotAdjust ? 1 : 0
  );
  return db.prepare("SELECT * FROM cash_transactions WHERE id = ?").get(info.lastInsertRowid) as CashTransactionRecord;
}

export function deleteCashTransaction(id: number): boolean {
  const res = db.prepare("DELETE FROM cash_transactions WHERE id = ?").run(id);
  return res.changes > 0;
}

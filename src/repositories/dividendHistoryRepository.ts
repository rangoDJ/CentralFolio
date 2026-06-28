import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";
import type { DividendPayment } from "../services/dividendGrowth.js";

const stmtGet = db.prepare(
  `SELECT exDate, amount FROM dividend_history WHERE symbol = ? ORDER BY exDate ASC`
);

const stmtLatest = db.prepare(
  `SELECT MAX(exDate) AS latest FROM dividend_history WHERE symbol = ?`
);

const stmtUpsert = db.prepare(`
  INSERT INTO dividend_history (symbol, exDate, amount, provider, cachedAt)
  VALUES (@symbol, @exDate, @amount, @provider, CURRENT_TIMESTAMP)
  ON CONFLICT(symbol, exDate) DO UPDATE SET
    amount   = excluded.amount,
    provider = excluded.provider,
    cachedAt = CURRENT_TIMESTAMP
`);

const stmtDelete = db.prepare(`DELETE FROM dividend_history WHERE symbol = ?`);

export function getDividendHistory(symbol: string): DividendPayment[] {
  return stmtGet.all(symbol) as DividendPayment[];
}

export function getLatestDividendExDate(symbol: string): string | null {
  const row = stmtLatest.get(symbol) as { latest: string | null } | undefined;
  return row?.latest ?? null;
}

export function upsertDividendHistory(
  symbol: string,
  payments: DividendPayment[],
  provider = "yahoo"
): number {
  if (payments.length === 0) return 0;
  const insertMany = db.transaction((rows: DividendPayment[]) => {
    for (const p of rows) {
      stmtUpsert.run({ symbol, exDate: p.exDate, amount: p.amount, provider });
    }
  });
  insertMany(payments);
  logger.debug("DividendHistory", `upsertDividendHistory(${symbol}) — ${payments.length} payment(s)`);
  return payments.length;
}

export function deleteDividendHistory(symbol: string): void {
  stmtDelete.run(symbol);
}

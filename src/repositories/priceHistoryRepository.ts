import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

export interface PriceCandle {
  date: string;        // 'YYYY-MM-DD'
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
}

// ── Prepared statements ────────────────────────────────────────────────────────

const stmtGetHistory = db.prepare(
  `SELECT date, open, high, low, close, adjClose, volume
     FROM price_history
    WHERE symbol = ? AND date >= ?
    ORDER BY date ASC`
);

const stmtGetHistoryAll = db.prepare(
  `SELECT date, open, high, low, close, adjClose, volume
     FROM price_history
    WHERE symbol = ?
    ORDER BY date ASC`
);

const stmtGetLatestDate = db.prepare(
  `SELECT MAX(date) AS latest FROM price_history WHERE symbol = ?`
);

// Idempotent: re-fetching an overlapping range refreshes existing rows in place
// (the latest stored day is often partial until the market closes).
const stmtUpsertCandle = db.prepare(`
  INSERT INTO price_history (symbol, date, open, high, low, close, adjClose, volume, provider, yahooSymbol, cachedAt)
  VALUES (@symbol, @date, @open, @high, @low, @close, @adjClose, @volume, @provider, @yahooSymbol, CURRENT_TIMESTAMP)
  ON CONFLICT(symbol, date) DO UPDATE SET
    open        = excluded.open,
    high        = excluded.high,
    low         = excluded.low,
    close       = excluded.close,
    adjClose    = excluded.adjClose,
    volume      = excluded.volume,
    provider    = excluded.provider,
    yahooSymbol = excluded.yahooSymbol,
    cachedAt    = CURRENT_TIMESTAMP
`);

const stmtDeleteSymbol = db.prepare(`DELETE FROM price_history WHERE symbol = ?`);

// Distinct symbols currently held across active accounts — the set the daily job syncs.
const stmtGetHeldSymbols = db.prepare(`
  SELECT DISTINCT p.symbol AS symbol
    FROM positions p
    JOIN accounts a ON a.id = p.accountId
   WHERE a.isActive = 1
     AND p.symbol IS NOT NULL
     AND p.symbol != ''
     AND p.units > 0
   ORDER BY p.symbol ASC
`);

// ── Repository functions ───────────────────────────────────────────────────────

export function getPriceHistory(symbol: string, fromDate?: string): PriceCandle[] {
  const rows = fromDate
    ? stmtGetHistory.all(symbol, fromDate)
    : stmtGetHistoryAll.all(symbol);
  return rows as PriceCandle[];
}

export function getLatestStoredDate(symbol: string): string | null {
  const row = stmtGetLatestDate.get(symbol) as { latest: string | null } | undefined;
  return row?.latest ?? null;
}

export function upsertCandles(
  symbol: string,
  candles: PriceCandle[],
  meta: { provider?: string; yahooSymbol?: string } = {}
): number {
  if (candles.length === 0) return 0;
  const provider = meta.provider ?? 'yahoo';
  const yahooSymbol = meta.yahooSymbol ?? null;
  const insertMany = db.transaction((rows: PriceCandle[]) => {
    for (const c of rows) {
      stmtUpsertCandle.run({
        symbol,
        date: c.date,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        adjClose: c.adjClose,
        volume: c.volume,
        provider,
        yahooSymbol,
      });
    }
  });
  insertMany(candles);
  logger.debug('PriceHistory', `upsertCandles(${symbol}) — ${candles.length} candle(s)`);
  return candles.length;
}

export function deletePriceHistory(symbol: string): void {
  stmtDeleteSymbol.run(symbol);
}

export function getHeldSymbols(): string[] {
  const rows = stmtGetHeldSymbols.all() as Array<{ symbol: string }>;
  return rows.map(r => r.symbol);
}

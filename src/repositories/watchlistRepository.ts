import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

export interface WatchlistEntry {
  symbol: string;
  notes: string | null;
  addedAt: string;
}

const stmtList = db.prepare(`SELECT symbol, notes, addedAt FROM watchlist ORDER BY addedAt DESC`);
const stmtGet = db.prepare(`SELECT symbol, notes, addedAt FROM watchlist WHERE symbol = ?`);
const stmtInsert = db.prepare(
  `INSERT OR IGNORE INTO watchlist (symbol, notes, addedAt) VALUES (?, ?, CURRENT_TIMESTAMP)`
);
const stmtUpdateNotes = db.prepare(`UPDATE watchlist SET notes = ? WHERE symbol = ?`);
const stmtDelete = db.prepare(`DELETE FROM watchlist WHERE symbol = ?`);

export function listWatchlist(): WatchlistEntry[] {
  return stmtList.all() as WatchlistEntry[];
}

export function getWatchlistEntry(symbol: string): WatchlistEntry | null {
  return (stmtGet.get(symbol) as WatchlistEntry | undefined) ?? null;
}

/** Returns true if a new row was inserted (false if it already existed). */
export function addWatchlistSymbol(symbol: string, notes?: string): boolean {
  const res = stmtInsert.run(symbol, notes ?? null);
  if (res.changes > 0) logger.info("Watchlist", `Added ${symbol}`);
  return res.changes > 0;
}

export function setWatchlistNotes(symbol: string, notes: string | null): void {
  stmtUpdateNotes.run(notes, symbol);
}

export function removeWatchlistSymbol(symbol: string): boolean {
  const res = stmtDelete.run(symbol);
  if (res.changes > 0) logger.info("Watchlist", `Removed ${symbol}`);
  return res.changes > 0;
}

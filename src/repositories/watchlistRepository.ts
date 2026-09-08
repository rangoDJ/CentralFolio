import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

export interface WatchlistEntry {
  symbol: string;
  notes: string | null;
  addedAt: string;
  /** Buy criteria; null means "not a condition I care about". */
  targetPrice: number | null;
  targetYieldPct: number | null;
  maxRatingScore: number | null;
  minGrowthStreak: number | null;
}

/** The four criteria, as accepted from the API. */
export interface WatchlistTargetInput {
  targetPrice?: number | null;
  targetYieldPct?: number | null;
  maxRatingScore?: number | null;
  minGrowthStreak?: number | null;
}

const COLUMNS = "symbol, notes, addedAt, targetPrice, targetYieldPct, maxRatingScore, minGrowthStreak";

const stmtList = db.prepare(`SELECT ${COLUMNS} FROM watchlist ORDER BY addedAt DESC`);
const stmtGet = db.prepare(`SELECT ${COLUMNS} FROM watchlist WHERE symbol = ?`);
const stmtSetTargets = db.prepare(`
  UPDATE watchlist SET targetPrice = ?, targetYieldPct = ?, maxRatingScore = ?, minGrowthStreak = ?
  WHERE symbol = ?
`);
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

/**
 * Replace a symbol's buy criteria. Undefined fields are cleared rather than
 * left alone, so the caller always sends the complete set — a partial update
 * that silently kept an old threshold would be hard to reason about.
 */
export function setWatchlistTargets(symbol: string, targets: WatchlistTargetInput): void {
  stmtSetTargets.run(
    targets.targetPrice ?? null,
    targets.targetYieldPct ?? null,
    targets.maxRatingScore ?? null,
    targets.minGrowthStreak ?? null,
    symbol,
  );
  logger.info("Watchlist", `Targets for ${symbol}: ${JSON.stringify(targets)}`);
}

export function removeWatchlistSymbol(symbol: string): boolean {
  const res = stmtDelete.run(symbol);
  if (res.changes > 0) logger.info("Watchlist", `Removed ${symbol}`);
  return res.changes > 0;
}

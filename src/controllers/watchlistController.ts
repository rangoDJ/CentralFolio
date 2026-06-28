import { Request, Response } from "express";
import {
  addWatchlistSymbol,
  setWatchlistNotes,
  removeWatchlistSymbol,
  getWatchlistEntry,
} from "../repositories/watchlistRepository.js";
import { getWatchlistRows, enrichWatchlistSymbol } from "../services/watchlistService.js";
import type { AddWatchlistInput } from "../schemas/watchlistSchema.js";
import { logger } from "../utils/logger.js";

const SYMBOL_RE = /^[A-Z0-9.:\-]{1,20}$/;

// GET /api/watchlist — enriched screener rows for every watched symbol.
export const getWatchlist = (_req: Request, res: Response) => {
  try {
    res.json(getWatchlistRows());
  } catch (err: any) {
    logger.error("Watchlist", `getWatchlist failed: ${err.message}`);
    res.status(500).json({ error: "Failed to load watchlist" });
  }
};

// POST /api/watchlist — add a symbol, enrich it (profile + price + dividends), return its row.
export const addWatchlist = async (req: Request, res: Response) => {
  const { symbol, notes } = req.body as AddWatchlistInput;
  try {
    const inserted = addWatchlistSymbol(symbol, notes);
    if (!inserted) {
      return res.status(409).json({ error: `${symbol} is already on your watchlist` });
    }
    // Pull free Yahoo data so the row is populated when we return it.
    await enrichWatchlistSymbol(symbol);
    const row = getWatchlistRows().find(r => r.symbol === symbol);
    res.status(201).json(row ?? { symbol });
  } catch (err: any) {
    logger.error("Watchlist", `addWatchlist(${symbol}) failed: ${err.message}`);
    res.status(500).json({ error: "Failed to add to watchlist" });
  }
};

// PATCH /api/watchlist/:symbol — update notes.
export const updateWatchlistNotes = (req: Request, res: Response) => {
  const symbol = String(req.params.symbol).toUpperCase().trim();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
  if (!getWatchlistEntry(symbol)) return res.status(404).json({ error: "Symbol not on watchlist" });
  const notes = req.body?.notes ?? null;
  setWatchlistNotes(symbol, notes == null ? null : String(notes).slice(0, 500));
  res.json({ success: true });
};

// DELETE /api/watchlist/:symbol — remove a symbol.
export const deleteWatchlist = (req: Request, res: Response) => {
  const symbol = String(req.params.symbol).toUpperCase().trim();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
  const removed = removeWatchlistSymbol(symbol);
  if (!removed) return res.status(404).json({ error: "Symbol not on watchlist" });
  res.json({ success: true });
};

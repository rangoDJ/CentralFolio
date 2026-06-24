import { Request, Response } from "express";
import { getPortfolioHistory } from "../services/portfolioHistoryService.js";
import { getDiversification } from "../services/diversificationService.js";
import { getAllRatings } from "../repositories/stockRatingRepository.js";
import { logger } from "../utils/logger.js";

const SYMBOL_RE = /^[A-Z0-9.:\-]{1,20}$/i;

/** Parse a comma-separated accountIds query param into a Set, or null for "all". */
function parseAccountIds(raw: unknown): Set<string> | null {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

// GET /api/analytics/portfolio-history?benchmark=SPY&accountIds=id1,id2
// Reconstructs portfolio market value over time from transactions + price
// history, with a net-invested line and an optional benchmark overlay.
export const portfolioHistoryHandler = async (req: Request, res: Response) => {
  const benchmark = String(req.query.benchmark ?? "SPY").toUpperCase().trim();
  if (benchmark && !SYMBOL_RE.test(benchmark)) {
    return res.status(400).json({ error: "Invalid benchmark symbol" });
  }
  const allowedIds = parseAccountIds(req.query.accountIds);
  logger.info("Analytics", `GET /api/analytics/portfolio-history benchmark=${benchmark} accountIds=${allowedIds ? allowedIds.size : 'all'}`);
  try {
    const result = await getPortfolioHistory(benchmark, allowedIds);
    res.json(result);
  } catch (err: any) {
    logger.error("Analytics", `portfolioHistory failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/analytics/stock-ratings
// Returns cached AI ratings for all held symbols.
export const stockRatingsHandler = (_req: Request, res: Response) => {
  try {
    const ratings = getAllRatings();
    res.json(ratings);
  } catch (err: any) {
    logger.error("Analytics", `stockRatings failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/analytics/diversification?accountIds=id1,id2
// Current holdings bucketed by sector, country, and asset type.
export const diversificationHandler = async (req: Request, res: Response) => {
  const allowedIds = parseAccountIds(req.query.accountIds);
  logger.info("Analytics", `GET /api/analytics/diversification accountIds=${allowedIds ? allowedIds.size : 'all'}`);
  try {
    const result = await getDiversification(allowedIds);
    res.json(result);
  } catch (err: any) {
    logger.error("Analytics", `diversification failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

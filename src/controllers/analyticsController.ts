import { Request, Response } from "express";
import { getPortfolioHistory } from "../services/portfolioHistoryService.js";
import { getDiversification } from "../services/diversificationService.js";
import { logger } from "../utils/logger.js";

const SYMBOL_RE = /^[A-Z0-9.:\-]{1,20}$/i;

// GET /api/analytics/portfolio-history?benchmark=SPY
// Reconstructs portfolio market value over time from transactions + price
// history, with a net-invested line and an optional benchmark overlay.
export const portfolioHistoryHandler = async (req: Request, res: Response) => {
  const benchmark = String(req.query.benchmark ?? "SPY").toUpperCase().trim();
  if (benchmark && !SYMBOL_RE.test(benchmark)) {
    return res.status(400).json({ error: "Invalid benchmark symbol" });
  }
  logger.info("Analytics", `GET /api/analytics/portfolio-history?benchmark=${benchmark}`);
  try {
    const result = await getPortfolioHistory(benchmark);
    res.json(result);
  } catch (err: any) {
    logger.error("Analytics", `portfolioHistory failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/analytics/diversification
// Current holdings bucketed by sector, country, and asset type.
export const diversificationHandler = async (_req: Request, res: Response) => {
  logger.info("Analytics", "GET /api/analytics/diversification");
  try {
    const result = await getDiversification();
    res.json(result);
  } catch (err: any) {
    logger.error("Analytics", `diversification failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

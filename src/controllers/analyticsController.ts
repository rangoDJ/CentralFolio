import { Request, Response } from "express";
import { getPortfolioHistory } from "../services/portfolioHistoryService.js";
import { getDiversification } from "../services/diversificationService.js";
import { getAllRatings } from "../repositories/stockRatingRepository.js";
import { computeRiskMetrics } from "../services/riskMetrics.js";
import { getDividendTaxBreakdown } from "../services/taxService.js";
import { getAttribution } from "../services/attributionService.js";
import { getRealizedGains } from "../services/realizedGainsService.js";
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

// GET /api/analytics/risk?benchmark=SPY&accountIds=id1,id2
// Portfolio risk metrics (volatility, Sharpe, max drawdown, beta) computed from
// the reconstructed daily value curve vs the benchmark.
export const riskHandler = async (req: Request, res: Response) => {
  const benchmark = String(req.query.benchmark ?? "SPY").toUpperCase().trim();
  if (benchmark && !SYMBOL_RE.test(benchmark)) {
    return res.status(400).json({ error: "Invalid benchmark symbol" });
  }
  const allowedIds = parseAccountIds(req.query.accountIds);
  logger.info("Analytics", `GET /api/analytics/risk benchmark=${benchmark} accountIds=${allowedIds ? allowedIds.size : 'all'}`);
  try {
    const hist = await getPortfolioHistory(benchmark, allowedIds);
    const valueSeries = hist.points.map(p => ({ date: p.date, value: p.value }));
    const benchSeries = hist.points.map(p => ({ date: p.date, value: p.benchmark ?? 0 }));
    const metrics = computeRiskMetrics(valueSeries, benchSeries);
    res.json({ benchmark, ...metrics });
  } catch (err: any) {
    logger.error("Analytics", `risk failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/analytics/tax?accountIds=id1,id2
// Estimated dividend withholding tax by account and source country.
export const taxHandler = (req: Request, res: Response) => {
  const allowedIds = parseAccountIds(req.query.accountIds);
  logger.info("Analytics", `GET /api/analytics/tax accountIds=${allowedIds ? allowedIds.size : 'all'}`);
  try {
    res.json(getDividendTaxBreakdown(allowedIds));
  } catch (err: any) {
    logger.error("Analytics", `tax failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/analytics/attribution?accountIds=id1,id2
// Per-holding total return (price + dividends) and contribution to overall gains.
export const attributionHandler = (req: Request, res: Response) => {
  const allowedIds = parseAccountIds(req.query.accountIds);
  logger.info("Analytics", `GET /api/analytics/attribution accountIds=${allowedIds ? allowedIds.size : 'all'}`);
  try {
    res.json(getAttribution(allowedIds));
  } catch (err: any) {
    logger.error("Analytics", `attribution failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/analytics/realized-gains?accountIds=id1,id2
// Realized capital gains (ACB method) by year and account, with the Canadian
// 50%-inclusion taxable estimate for non-registered accounts.
export const realizedGainsHandler = (req: Request, res: Response) => {
  const allowedIds = parseAccountIds(req.query.accountIds);
  logger.info("Analytics", `GET /api/analytics/realized-gains accountIds=${allowedIds ? allowedIds.size : 'all'}`);
  try {
    res.json(getRealizedGains(allowedIds));
  } catch (err: any) {
    logger.error("Analytics", `realizedGains failed: ${err.message}`);
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

import { Request, Response } from "express";
import { getPortfolio, listPortfolios, savePortfolio, deletePortfolio, setPortfolioTradingEnabled, Portfolio } from "../models/db.js";
import { getAllDividendsForAllPortfolios, getCachedAllDividends, clearAllDividendCaches } from "../services/dividendService.js";
import { onPortfolioDeleted } from "../services/cacheService.js";
import { logger } from "../utils/logger.js";

export const getPortfolios = (req: Request, res: Response) => {
  logger.info('Portfolio', 'GET /api/portfolios — listing all portfolios');
  const portfolios = listPortfolios();
  logger.info('Portfolio', `→ Returning ${portfolios.length} portfolio(s)`);
  res.json(portfolios);
};

export const getAllDividends = async (req: Request, res: Response) => {
  const forceRefresh = req.query.forceRefresh === 'true';
  logger.info('Portfolio', `GET /api/portfolios/all-dividends — forceRefresh=${forceRefresh}`);
  const start = Date.now();
  try {
    let allDividends;

    if (forceRefresh) {
      logger.info('Portfolio', 'all-dividends: force refresh requested');
      allDividends = await getAllDividendsForAllPortfolios();
    } else {
      const cached = getCachedAllDividends();
      if (cached) {
        logger.info('Portfolio', 'all-dividends: serving from 24h cache');
        allDividends = cached;
      } else {
        logger.info('Portfolio', 'all-dividends: cache empty/expired, fetching fresh data');
        allDividends = await getAllDividendsForAllPortfolios();
      }
    }

    const total = allDividends.reduce((sum, a) => sum + (a.dividends?.length ?? 0), 0);
    logger.info('Portfolio', `all-dividends complete in ${Date.now() - start}ms — ${allDividends.length} account(s), ${total} event(s) total`);
    res.json(allDividends);
  } catch (err: any) {
    logger.error('Portfolio', `all-dividends failed after ${Date.now() - start}ms: ${err.message}`);
    res.status(500).json({ error: "Failed to fetch dividends", detail: err.message });
  }
};

export const createOrUpdatePortfolio = (req: Request, res: Response) => {
  const { id, name, clientId, consumerKey, userId, userSecret } = req.body;
  const action = id ? `UPDATE id=${id}` : 'CREATE';
  logger.info('Portfolio', `POST /api/portfolios — ${action} name="${name}"`);
  
  if (!name || !clientId || !consumerKey || !userId) {
    logger.warn('Portfolio', 'createOrUpdatePortfolio — missing required fields');
    return res.status(400).json({ error: "Missing required fields: name, clientId, consumerKey, userId" });
  }

  const portfolio: Portfolio = {
    id: id ? Number(id) : undefined,
    name,
    clientId,
    consumerKey,
    userId,
    userSecret: userSecret || undefined
  };

  try {
    const savedId = savePortfolio(portfolio);
    logger.info('Portfolio', `Portfolio saved with id=${savedId}`);
    res.json({ success: true, id: savedId });
  } catch (err: any) {
    logger.error('Portfolio', `savePortfolio failed: ${err.message}`);
    res.status(500).json({ error: "Failed to save portfolio", detail: err.message });
  }
};

export const togglePortfolioTrading = (req: Request, res: Response) => {
  const { id } = req.params;
  const { tradingEnabled } = req.body;

  if (typeof tradingEnabled !== 'boolean') {
    logger.warn('Portfolio', `togglePortfolioTrading — invalid body for portfolio ${id}`);
    return res.status(400).json({ error: "Body must contain { tradingEnabled: boolean }" });
  }

  try {
    setPortfolioTradingEnabled(String(id), tradingEnabled);
    logger.info('Portfolio', `Portfolio id=${id} trading ${tradingEnabled ? 'ENABLED' : 'DISABLED'}`);
    res.json({ success: true, id, tradingEnabled });
  } catch (err: any) {
    logger.error('Portfolio', `togglePortfolioTrading(${id}) failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const clearDividendCache = (req: Request, res: Response) => {
  logger.info('Portfolio', 'POST /api/portfolios/clear-dividend-cache');
  clearAllDividendCaches();
  res.json({ success: true, message: 'Dividend cache cleared' });
};

export const removePortfolio = (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Portfolio', `DELETE /api/portfolios/${id}`);
  try {
    onPortfolioDeleted(id);
    deletePortfolio(String(id));
    logger.info('Portfolio', `Portfolio id=${id} deleted`);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Portfolio', `deletePortfolio(${id}) failed: ${err.message}`);
    res.status(500).json({ error: "Failed to delete portfolio", detail: err.message });
  }
};

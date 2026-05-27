import { Request, Response } from "express";
import { getPortfolio, listPortfolios, savePortfolio, deletePortfolio, setPortfolioTradingEnabled, Portfolio, getAllCachedDividendMetadata, listSettings } from "../models/db.js";
import { getAllDividendsForAllPortfolios, getCachedAllDividends, clearAllDividendCaches } from "../services/dividendService.js";
import { triggerJob, isJobRunning } from "../services/schedulerService.js";
import { onPortfolioDeleted } from "../services/cacheService.js";
import { logger } from "../utils/logger.js";

// Strip server-side secrets before sending portfolios to the client
function sanitizePortfolio({ consumerKey: _ck, userSecret: _us, ...safe }: Portfolio) {
  return safe;
}

export const getPortfolios = (req: Request, res: Response) => {
  logger.info('Portfolio', 'GET /api/portfolios — listing all portfolios');
  const portfolios = listPortfolios();
  logger.info('Portfolio', `→ Returning ${portfolios.length} portfolio(s)`);
  res.json(portfolios.map(sanitizePortfolio));
};

export const getAllDividends = (req: Request, res: Response) => {
  const forceRefresh = req.query.forceRefresh === 'true';
  logger.info('Portfolio', `GET /api/portfolios/all-dividends — forceRefresh=${forceRefresh}`);

  if (forceRefresh) {
    triggerJob('dividend-fetch', 'manual');
  }

  const cached = getCachedAllDividends();
  const fetching = isJobRunning('dividend-fetch');

  if (!cached && !fetching) {
    // No cache and nothing running — kick off background fetch
    triggerJob('dividend-fetch', 'on-demand');
  }

  const total = (cached ?? []).reduce((sum: number, a: any) => sum + (a.dividends?.length ?? 0), 0);
  logger.info('Portfolio', `all-dividends — serving ${cached?.length ?? 0} account(s), ${total} event(s) (fetching=${fetching})`);

  res.json({ fetching, data: cached ?? [] });
};

export const createOrUpdatePortfolio = (req: Request, res: Response) => {
  // userSecret is intentionally excluded — it is set only by the backend after SnapTrade registration
  const { id, name, clientId, consumerKey, userId } = req.body;
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

  const existing = getPortfolio(String(id));
  if (!existing) return res.status(404).json({ error: 'Portfolio not found' });

  try {
    setPortfolioTradingEnabled(String(id), tradingEnabled);
    logger.info('Portfolio', `Portfolio id=${id} trading ${tradingEnabled ? 'ENABLED' : 'DISABLED'}`);
    res.json({ success: true, id, tradingEnabled });
  } catch (err: any) {
    logger.error('Portfolio', `togglePortfolioTrading(${id}) failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const getDividendMetadata = (req: Request, res: Response) => {
  logger.info('Portfolio', 'GET /api/portfolios/dividend-metadata');
  const rows = getAllCachedDividendMetadata();
  const settings = listSettings();
  const eodhdUsed  = parseInt(settings['eodhd_daily_count']  ?? '0', 10);
  const eodhdDate  = settings['eodhd_daily_date'] ?? null;
  res.json({ rows, eodhd: { used: eodhdUsed, limit: 18, date: eodhdDate } });
};

export const clearDividendCache = (req: Request, res: Response) => {
  logger.info('Portfolio', 'POST /api/portfolios/clear-dividend-cache');
  clearAllDividendCaches();
  res.json({ success: true, message: 'Dividend cache cleared' });
};

export const removePortfolio = (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Portfolio', `DELETE /api/portfolios/${id}`);

  const existing = getPortfolio(String(id));
  if (!existing) return res.status(404).json({ error: 'Portfolio not found' });

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

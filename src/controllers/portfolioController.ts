import { Request, Response } from "express";
import { getPortfolio, listPortfolios, savePortfolio, deletePortfolio, setPortfolioTradingEnabled, Portfolio, getAllCachedDividendMetadata, listSettings, saveCachedDividendMetadata, deleteCachedDividendMetadata } from "../models/db.js";
import { getAllDividendsForAllPortfolios, getCachedAllDividends, clearAllDividendCaches, lookupDividendWithAI, getAllDividendsFromCacheOnly } from "../services/dividendService.js";
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

export const getAllDividends = async (req: Request, res: Response) => {
  const forceRefresh = req.query.forceRefresh === 'true';
  logger.info('Portfolio', `GET /api/portfolios/all-dividends — forceRefresh=${forceRefresh}`);

  if (forceRefresh) {
    triggerJob('dividend-fetch', 'manual');
  }

  const fetching = isJobRunning('dividend-fetch');

  // Calculate forecast on the fly from already cached DB data (non-blocking)
  const data = await getAllDividendsFromCacheOnly();

  const total = data.reduce((sum: number, a: any) => sum + (a.dividends?.length ?? 0), 0);
  logger.info('Portfolio', `all-dividends — serving ${data.length} account(s), ${total} event(s) (fetching=${fetching})`);

  res.json({ fetching, data });
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

const SYMBOL_RE = /^[A-Z0-9.:\-]{1,20}$/i;
const FREQ_VALUES = new Set([1, 2, 4, 6, 12, 24, 26, 52]);

export const snowballFetchDividendMetadataHandler = async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol)?.toUpperCase().trim();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  logger.info('Portfolio', `POST /api/portfolios/dividend-metadata/${symbol}/snowball-fetch`);
  try {
    const result = await lookupDividendWithAI(symbol);
    if (!result) {
      return res.status(404).json({ error: `Snowball Analytics could not find dividend data for "${symbol}". It may not pay dividends or the ticker is unrecognized.` });
    }
    res.json({ symbol, ...result });
  } catch (err: any) {
    logger.error('Portfolio', `snowballFetchDividendMetadata(${symbol}) failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const manualSaveDividendMetadataHandler = (req: Request, res: Response) => {
  const symbol = String(req.params.symbol)?.toUpperCase().trim();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }

  const { frequency, amountPerShare, lastExDate, name } = req.body;

  const freq = Number(frequency);
  if (!FREQ_VALUES.has(freq)) {
    return res.status(400).json({ error: 'frequency must be 1, 2, 4, 6, 12, 24, 26, or 52' });
  }
  const amount = parseFloat(amountPerShare);
  if (isNaN(amount) || amount < 0) {
    return res.status(400).json({ error: 'amountPerShare must be a non-negative number' });
  }
  if (lastExDate && !/^\d{4}-\d{2}-\d{2}$/.test(lastExDate)) {
    return res.status(400).json({ error: 'lastExDate must be YYYY-MM-DD or omitted' });
  }

  logger.info('Portfolio', `PUT /api/portfolios/dividend-metadata/${symbol} — manual save`);
  saveCachedDividendMetadata(symbol, {
    frequency: freq,
    amountPerShare: amount,
    lastExDate: lastExDate || null,
    name: name ? String(name).trim() : symbol,
  }, 'manual');

  res.json({ success: true, symbol });
};

export const deleteDividendMetadataHandler = (req: Request, res: Response) => {
  const symbol = String(req.params.symbol)?.toUpperCase().trim();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  const deleted = deleteCachedDividendMetadata(symbol);
  if (!deleted) return res.status(404).json({ error: `No cached entry for "${symbol}"` });
  logger.info('Portfolio', `DELETE /api/portfolios/dividend-metadata/${symbol}`);
  res.json({ success: true, symbol });
};

export const removePortfolio = (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Portfolio', `DELETE /api/portfolios/${id}`);

  const existing = getPortfolio(String(id));
  if (!existing) return res.status(404).json({ error: 'Portfolio not found' });

  try {
    onPortfolioDeleted(String(id));
    deletePortfolio(String(id));
    logger.info('Portfolio', `Portfolio id=${id} deleted`);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Portfolio', `deletePortfolio(${id}) failed: ${err.message}`);
    res.status(500).json({ error: "Failed to delete portfolio", detail: err.message });
  }
};

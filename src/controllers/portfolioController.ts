import { Request, Response } from "express";
import { getPortfolio, listPortfolios, savePortfolio, deletePortfolio, setPortfolioTradingEnabled, Portfolio, getAllCachedDividendMetadata, listSettings, saveCachedDividendMetadata, getCachedDividendMetadata, deleteCachedDividendMetadata } from "../models/db.js";
import { getAllDividendsForAllPortfolios, getCachedAllDividends, clearAllDividendCaches, clearDividendMemoryCache, lookupDividendWithAI, getAllDividendsFromCacheOnly } from "../services/dividendService.js";
import { triggerJob, isJobRunning } from "../services/schedulerService.js";
import { onPortfolioDeleted } from "../services/cacheService.js";
import { evictSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { logger } from "../utils/logger.js";
import { keyTypeOf, isPortfolioConnected } from "../utils/snapTradeKeyType.js";

// Strip server-side secrets before sending portfolios to the client, but expose a
// `registered` boolean so the UI can tell connected portfolios apart without the secret.
function sanitizePortfolio(portfolio: Portfolio) {
  // `registered` is what the UI reads to decide whether a connection is usable
  // — whether to offer "Connect Brokerage" or "Register with SnapTrade", and
  // whether trading can be turned on. A personal key is usable from the moment
  // its credentials are saved, having no registration step to complete, so this
  // asks whether the connection works rather than whether a secret was stored.
  //
  // Computed from the whole portfolio before anything is stripped: the check
  // needs consumerKey, which is exactly what must not be sent to the client.
  const registered = isPortfolioConnected(portfolio);
  const { consumerKey: _ck, userSecret: _us, ...safe } = portfolio;
  return { ...safe, registered };
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

// Credentials are pasted, and a copied key routinely carries a trailing newline
// or space. clientId and consumerKey are fed into SnapTrade's request signature,
// so a single invisible character makes every call fail with "Unable to verify
// signature sent" — an error that says nothing about where the stray byte came
// from, against a key that looks correct in the form.
// A non-string collapses to '' and is then rejected by the required-field check
// below, matching how the rest of this API refuses non-string input outright.
const trimmed = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const createOrUpdatePortfolio = (req: Request, res: Response) => {
  // userSecret is intentionally excluded — it is set only by the backend after SnapTrade registration
  const { id } = req.body;
  const name = trimmed(req.body.name);
  const clientId = trimmed(req.body.clientId);
  const consumerKey = trimmed(req.body.consumerKey);
  const submittedUserId = trimmed(req.body.userId);
  const keyType = keyTypeOf({ keyType: trimmed(req.body.keyType) });
  const personal = keyType === "personal";
  const action = id ? `UPDATE id=${id}` : 'CREATE';
  logger.info('Portfolio', `POST /api/portfolios — ${action} name="${name}" keyType=${keyType}`);

  // A personal key has no SnapTrade user to name — the key itself identifies
  // the user, and userId is never sent on the wire in that mode. The column is
  // NOT NULL, so a stable placeholder stands in rather than a required field
  // the user has no value for.
  const userId = personal ? (submittedUserId || "personal-key") : submittedUserId;

  if (!name || !clientId || !userId) {
    logger.warn('Portfolio', 'createOrUpdatePortfolio — missing required fields');
    return res.status(400).json({
      error: personal
        ? "Missing required fields: name, clientId, consumerKey"
        : "Missing required fields: name, clientId, consumerKey, userId",
    });
  }

  // A non-numeric id (e.g. a typo'd URL param echoed back) must not silently
  // fall through to an insert — Number("abc") is NaN, and NaN is falsy, so an
  // unguarded `id ? Number(id) : undefined` would create a brand-new portfolio
  // instead of failing the intended update.
  let portfolioId: number | undefined;
  if (id !== undefined && id !== null && id !== '') {
    portfolioId = Number(id);
    if (!Number.isInteger(portfolioId) || portfolioId <= 0) {
      return res.status(400).json({ error: "id must be a positive integer" });
    }
  }

  // The consumerKey is a secret and is never sent to the client, so an edit form
  // cannot echo it back. A blank one on an update therefore means "unchanged",
  // not "erase it" — otherwise saving an unrelated field on an existing
  // connection would silently destroy the key that signs its requests.
  const existing = portfolioId ? getPortfolio(portfolioId) : null;
  if (portfolioId && !existing) {
    return res.status(404).json({ error: "Portfolio not found" });
  }

  const effectiveConsumerKey = consumerKey || existing?.consumerKey || '';
  if (!effectiveConsumerKey) {
    logger.warn('Portfolio', 'createOrUpdatePortfolio — missing required fields');
    return res.status(400).json({
      error: personal
        ? "Missing required fields: name, clientId, consumerKey"
        : "Missing required fields: name, clientId, consumerKey, userId",
    });
  }

  const portfolio: Portfolio = {
    id: portfolioId,
    name,
    clientId,
    consumerKey: effectiveConsumerKey,
    userId,
    keyType,
  };

  try {
    const savedId = savePortfolio(portfolio);
    // The cached SnapTrade client was built from the previous clientId/consumerKey,
    // so it has to go or the new credentials never reach SnapTrade.
    evictSnapTradeClientForPortfolio(savedId);
    logger.info('Portfolio', `Portfolio saved with id=${savedId}`);
    res.json({ success: true, id: savedId });
  } catch (err: any) {
    logger.error('Portfolio', `savePortfolio failed: ${err.message}`);
    res.status(500).json({ error: "Failed to save portfolio" });
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
    res.status(500).json({ error: "Failed to update trading setting" });
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

  const { frequency, amountPerShare, lastExDate, payDate, name } = req.body;

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
  if (payDate && !/^\d{4}-\d{2}-\d{2}$/.test(payDate)) {
    return res.status(400).json({ error: 'payDate must be YYYY-MM-DD or omitted' });
  }

  logger.info('Portfolio', `PUT /api/portfolios/dividend-metadata/${symbol} — manual save`);
  // The save is a full row replace, so an omitted pay date would silently drop
  // whatever Snowball had recorded and send that symbol back to being placed on
  // its ex-date. Keep the stored one unless the caller is changing it.
  const existing = getCachedDividendMetadata(symbol);
  saveCachedDividendMetadata(symbol, {
    frequency: freq,
    amountPerShare: amount,
    lastExDate: lastExDate || null,
    payDate: payDate || existing?.payDate || null,
    name: name ? String(name).trim() : symbol,
  }, 'manual');

  // Dividend metadata changed — drop the in-memory forecast snapshot so the next
  // all-dividends request recomputes income stats from the updated DB data.
  clearDividendMemoryCache();

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

  // Dividend metadata changed — drop the in-memory forecast snapshot so the next
  // all-dividends request recomputes income stats from the updated DB data.
  clearDividendMemoryCache();

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
    evictSnapTradeClientForPortfolio(String(id));
    logger.info('Portfolio', `Portfolio id=${id} deleted`);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Portfolio', `deletePortfolio(${id}) failed: ${err.message}`);
    res.status(500).json({ error: "Failed to delete portfolio" });
  }
};

import { Request, Response } from "express";
import { getStockDetail } from "../services/dividendService.js";
import { getPriceHistory } from "../services/priceHistoryService.js";
import { logger } from "../utils/logger.js";

const SYMBOL_RE = /^[A-Z0-9.:\-]{1,20}$/i;
const RANGE_RE = /^(1m|3m|6m|1y|2y|5y|max|all)$/i;

// GET /api/stock/:symbol — Snowball-derived asset detail for the stock page.
export const stockDetailHandler = async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol)?.toUpperCase().trim();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  logger.info('Stock', `GET /api/stock/${symbol}`);
  try {
    const detail = await getStockDetail(symbol);
    if (!detail) {
      return res.status(404).json({ error: `No detail available for "${symbol}".` });
    }
    res.json(detail);
  } catch (err: any) {
    logger.error('Stock', `stockDetail(${symbol}) failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/stock/:symbol/history?range=1y — daily price history (Yahoo-sourced, cached).
export const priceHistoryHandler = async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol)?.toUpperCase().trim();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  const range = String(req.query.range ?? '1y');
  if (!RANGE_RE.test(range)) {
    return res.status(400).json({ error: 'Invalid range' });
  }
  logger.info('Stock', `GET /api/stock/${symbol}/history?range=${range}`);
  try {
    const candles = await getPriceHistory(symbol, range);
    res.json({ symbol, range, candles });
  } catch (err: any) {
    logger.error('Stock', `priceHistory(${symbol}) failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

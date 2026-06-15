import { Request, Response } from "express";
import { getStockDetail } from "../services/dividendService.js";
import { logger } from "../utils/logger.js";

const SYMBOL_RE = /^[A-Z0-9.:\-]{1,20}$/i;

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

import { Request, Response } from "express";
import {
  getActiveAccountIds,
  getCachedPositions,
} from "../repositories/accountRepository.js";
import { getHeldSymbols } from "../repositories/priceHistoryRepository.js";
import {
  getDividendGrowthForSymbol,
  getDividendGrowthMap,
  portfolioWeightedDgr,
} from "../services/dividendGrowthService.js";
import { logger } from "../utils/logger.js";

const SYMBOL_RE = /^[A-Z0-9.:\-]{1,20}$/;

/** Market-value weight per held symbol, aggregated across active accounts. */
function heldSymbolWeights(): Array<{ symbol: string; weight: number }> {
  const weights = new Map<string, number>();
  for (const accountId of getActiveAccountIds()) {
    for (const pos of getCachedPositions(accountId)) {
      const symbol = String(pos.symbol ?? "").toUpperCase().trim();
      const mv = Number(pos.marketValue);
      if (!symbol || !Number.isFinite(mv) || mv <= 0) continue;
      weights.set(symbol, (weights.get(symbol) ?? 0) + mv);
    }
  }
  return [...weights.entries()].map(([symbol, weight]) => ({ symbol, weight }));
}

// GET /api/dividend-growth/:symbol — dividend-growth metrics for one symbol (ensures a sync).
export const getSymbolDividendGrowth = async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol).toUpperCase().trim();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
  try {
    const metrics = await getDividendGrowthForSymbol(symbol, true);
    res.json({ symbol, ...metrics });
  } catch (err: any) {
    logger.error("DividendGrowth", `getSymbolDividendGrowth(${symbol}) failed: ${err.message}`);
    res.status(500).json({ error: "Failed to compute dividend growth" });
  }
};

// GET /api/dividend-growth — per-held-symbol metrics + a market-value-weighted
// portfolio DGR for the income-projection default.
export const getHeldDividendGrowth = (_req: Request, res: Response) => {
  try {
    const symbols = getHeldSymbols();
    const map = getDividendGrowthMap(symbols);
    const perSymbol: Record<string, unknown> = {};
    for (const [sym, m] of map) {
      perSymbol[sym] = {
        dgr1y: m.dgr1y, dgr3y: m.dgr3y, dgr5y: m.dgr5y,
        growthStreakYears: m.growthStreakYears, yearsOfData: m.yearsOfData,
      };
    }
    const portfolioDgr = portfolioWeightedDgr(heldSymbolWeights());
    res.json({ perSymbol, portfolioDgr });
  } catch (err: any) {
    logger.error("DividendGrowth", `getHeldDividendGrowth failed: ${err.message}`);
    res.status(500).json({ error: "Failed to compute dividend growth" });
  }
};

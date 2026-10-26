import { Request, Response } from "express";
import { getPortfolioHistory } from "../services/portfolioHistoryService.js";
import { getDiversification } from "../services/diversificationService.js";
import { getAllRatings } from "../repositories/stockRatingRepository.js";
import { computeRiskMetrics } from "../services/riskMetrics.js";
import { getDividendTaxBreakdown } from "../services/taxService.js";
import { getAttribution } from "../services/attributionService.js";
import { getRealizedGains } from "../services/realizedGainsService.js";
import { getT5008Report, dispositionsToCsv } from "../services/t5008Service.js";
import { getHarvestReport } from "../services/taxLossHarvestService.js";
import { computePortfolioHealth } from "../services/portfolioHealthService.js";
import { calculateClosedPositions } from "../services/closedPositionsService.js";
import { calculateFireRunway } from "../services/fireForecasterService.js";
import { getAllDividendsFromCacheOnly } from "../services/dividendService.js";
import { getCachedPositions, getCachedDividendMetadata, getMergedTransactions } from "../models/db.js";
import { getScopedAccounts } from "../services/accountScope.js";
import { ensureProfiles } from "../services/assetProfileService.js";
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

/** Parse an optional 4-digit tax year. Returns null for "all years". */
function parseYear(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "all") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1970 || n > 2100) return null;
  return n;
}

// GET /api/analytics/t5008?year=2025&accountIds=id1,id2
// Per-disposition T5008 slip data + Schedule 3 roll-up for non-registered
// accounts, in CAD at each trade's own exchange rate, with superficial losses
// identified and denied.
export const t5008Handler = async (req: Request, res: Response) => {
  const allowedIds = parseAccountIds(req.query.accountIds);
  const year = parseYear(req.query.year);
  logger.info("Analytics", `GET /api/analytics/t5008 year=${year ?? 'all'} accountIds=${allowedIds ? allowedIds.size : 'all'}`);
  try {
    res.json(await getT5008Report(year, allowedIds));
  } catch (err: any) {
    logger.error("Analytics", `t5008 failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/analytics/t5008.csv?year=2025&accountIds=id1,id2
// Same data as a CSV download for import into tax software or a spreadsheet.
export const t5008CsvHandler = async (req: Request, res: Response) => {
  const allowedIds = parseAccountIds(req.query.accountIds);
  const year = parseYear(req.query.year);
  logger.info("Analytics", `GET /api/analytics/t5008.csv year=${year ?? 'all'}`);
  try {
    const report = await getT5008Report(year, allowedIds);
    const filename = `t5008-${year ?? "all-years"}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // Excel needs a BOM to read UTF-8 CSV correctly.
    res.send("﻿" + dispositionsToCsv(report.dispositions, report.carryingCharges));
  } catch (err: any) {
    logger.error("Analytics", `t5008 CSV failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/analytics/tax-loss-harvest?marginalRatePct=43.4
// Which taxable holdings sit at a loss, how much of this year's realized gain
// each would offset, and which the superficial-loss rule would deny.
export const taxLossHarvestHandler = async (req: Request, res: Response) => {
  const raw = req.query.marginalRatePct;
  let marginalRatePct: number | null = null;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: "marginalRatePct must be between 0 and 100" });
    }
    marginalRatePct = n;
  }

  logger.info("Analytics", `GET /api/analytics/tax-loss-harvest marginalRatePct=${marginalRatePct ?? "none"}`);
  try {
    res.json(await getHarvestReport(marginalRatePct));
  } catch (err: any) {
    logger.error("Analytics", `taxLossHarvest failed: ${err.message}`);
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

// GET /api/analytics/health-score?benchmark=SPY&accountIds=id1,id2
// Snowball Analytics-style portfolio health and quality scorecard (0-100, A+ to F).
export const healthScoreHandler = async (req: Request, res: Response) => {
  const benchmark = String(req.query.benchmark ?? "SPY").toUpperCase().trim();
  const allowedIds = parseAccountIds(req.query.accountIds);
  logger.info("Analytics", `GET /api/analytics/health-score benchmark=${benchmark} accountIds=${allowedIds ? allowedIds.size : 'all'}`);
  try {
    const [divResult, hist] = await Promise.all([
      getDiversification(allowedIds),
      getPortfolioHistory(benchmark, allowedIds).catch(() => ({ points: [] as any[] })),
    ]);

    let beta: number | null = null;
    let maxDrawdown: number | null = null;
    if (hist.points && hist.points.length >= 2) {
      const valueSeries = hist.points.map((p: any) => ({ date: p.date, value: p.value }));
      const benchSeries = hist.points.map((p: any) => ({ date: p.date, value: p.benchmark ?? 0 }));
      const metrics = computeRiskMetrics(valueSeries, benchSeries);
      beta = metrics.beta;
      maxDrawdown = metrics.maxDrawdown;
    }

    // Collect individual holdings
    const holdingMap = new Map<string, { value: number; units: number }>();
    for (const acct of getScopedAccounts(allowedIds)) {
      for (const pos of getCachedPositions(acct.id)) {
        const sym = String(pos.symbol ?? '').toUpperCase().trim();
        if (!sym) continue;
        const val = pos.marketValue ?? (pos.units ?? 0) * (pos.price ?? 0);
        const cur = holdingMap.get(sym) || { value: 0, units: 0 };
        cur.value += val;
        cur.units += (pos.units || 0);
        holdingMap.set(sym, cur);
      }
    }

    const symbols = Array.from(holdingMap.keys());
    const profiles = await ensureProfiles(symbols);

    const holdings = symbols.map(sym => {
      const h = holdingMap.get(sym)!;
      const meta = getCachedDividendMetadata(sym);
      const prof = profiles.get(sym);
      const annualIncome = (meta?.frequency && meta?.amountPerShare) ? meta.frequency * meta.amountPerShare * h.units : 0;
      return {
        symbol: sym,
        value: Math.round(h.value * 100) / 100,
        sector: prof?.sector ?? null,
        assetType: prof?.assetType ?? null,
        annualIncome: Math.round(annualIncome * 100) / 100,
      };
    });

    const report = computePortfolioHealth(holdings, {
      beta,
      maxDrawdown,
      totalValue: divResult.totalValueBase,
      sectors: divResult.bySector,
    });

    res.json(report);
  } catch (err: any) {
    logger.error("Analytics", `healthScore failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/analytics/closed-positions — Snowball-style closed positions ledger
export const closedPositionsHandler = (req: Request, res: Response) => {
  const allowedIds = parseAccountIds(req.query.accountIds);
  logger.info("Analytics", `GET /api/analytics/closed-positions accountIds=${allowedIds ? allowedIds.size : 'all'}`);
  try {
    const allTxs: any[] = [];
    for (const acct of getScopedAccounts(allowedIds)) {
      const txs = getMergedTransactions(acct.id);
      allTxs.push(...txs);
    }
    const result = calculateClosedPositions(allTxs, { includePartiallyClosed: req.query.partial === 'true' });
    res.json(result);
  } catch (err: any) {
    logger.error("Analytics", `closedPositions failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/analytics/fire-runway — Snowball-style financial independence date calculator
export const fireRunwayHandler = async (req: Request, res: Response) => {
  logger.info("Analytics", "POST /api/analytics/fire-runway");
  try {
    const {
      monthlyContribution,
      targetMonthlyIncome,
      dividendGrowthRatePct,
      capitalGrowthRatePct,
      reinvestDividends,
      accountIds
    } = req.body || {};

    const allowedIds = parseAccountIds(accountIds);

    // Compute live portfolio metrics if not supplied in body
    let currentPortfolioValue = 0;
    for (const acct of getScopedAccounts(allowedIds)) {
      for (const pos of getCachedPositions(acct.id)) {
        const val = pos.marketValue ?? (pos.units ?? 0) * (pos.price ?? 0);
        currentPortfolioValue += (val || 0);
      }
    }

    let currentAnnualDividends = 0;
    try {
      const divAccounts = await getAllDividendsFromCacheOnly();
      for (const acct of divAccounts) {
        if (allowedIds && !allowedIds.has(acct.accountId)) continue;
        for (const div of (acct.dividends || [])) {
          currentAnnualDividends += (div.amountCAD ?? div.amount ?? 0);
        }
      }
    } catch (e: any) {
      logger.warn("FireRunway", `Failed to get div summary: ${e.message}`);
    }

    const sim = calculateFireRunway({
      currentPortfolioValue: req.body?.currentPortfolioValue ?? currentPortfolioValue,
      currentAnnualDividends: req.body?.currentAnnualDividends ?? currentAnnualDividends,
      monthlyContribution: Number(monthlyContribution ?? 500),
      targetMonthlyIncome: Number(targetMonthlyIncome ?? (currentAnnualDividends > 0 ? (currentAnnualDividends / 12) * 2 : 1000)),
      dividendGrowthRatePct: dividendGrowthRatePct != null ? Number(dividendGrowthRatePct) : 6,
      capitalGrowthRatePct: capitalGrowthRatePct != null ? Number(capitalGrowthRatePct) : 5,
      reinvestDividends: reinvestDividends !== false,
    });

    res.json(sim);
  } catch (err: any) {
    logger.error("Analytics", `fireRunway failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

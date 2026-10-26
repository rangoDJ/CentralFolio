import { Router } from "express";
import {
  portfolioHistoryHandler,
  diversificationHandler,
  stockRatingsHandler,
  riskHandler,
  taxHandler,
  attributionHandler,
  realizedGainsHandler,
  t5008Handler,
  t5008CsvHandler,
  taxLossHarvestHandler,
  healthScoreHandler,
  closedPositionsHandler,
  fireRunwayHandler,
  statementReportHandler,
  statementReportCsvHandler,
  dipFinderHandler,
  dividendSafetyHandler,
  etfOverlapHandler,
  etfXrayHandler,
  backtestHandler,
  saveBacktestPortfolioHandler,
  annualRecapHandler,
  bondsScreenerHandler,
  congressTradingHandler,
  benchmarkOverlayHandler,
} from "../controllers/analyticsController.js";

const router = Router();

router.get("/portfolio-history", portfolioHistoryHandler);
router.get("/diversification", diversificationHandler);
router.get("/health-score", healthScoreHandler);
router.get("/closed-positions", closedPositionsHandler);
router.post("/fire-runway", fireRunwayHandler);
router.get("/stock-ratings", stockRatingsHandler);
router.get("/risk", riskHandler);
router.get("/tax", taxHandler);
router.get("/tax-loss-harvest", taxLossHarvestHandler);
router.get("/attribution", attributionHandler);
router.get("/realized-gains", realizedGainsHandler);

// Statement Report (Snowball Analytics /report)
router.get("/statement-report.csv", statementReportCsvHandler);
router.get("/statement-report", statementReportHandler);

// Dip Finder (Snowball Analytics /findthedip)
router.get("/dip-finder", dipFinderHandler);

// Dividend Safety Score (Snowball Analytics /dividend-rating)
router.get("/dividend-safety", dividendSafetyHandler);

// ETF Overlap & ETF X-Ray (Snowball Analytics /etf-overlap & X-Ray)
router.get("/etf-overlap", etfOverlapHandler);
router.get("/etf-xray", etfXrayHandler);

// Portfolio Lab & Backtest (Snowball Analytics /portfoliolab & /dividends-backtesting)
router.post("/backtest", backtestHandler);
router.post("/backtest/save", saveBacktestPortfolioHandler);

// Annual Recap Story (Snowball Analytics /recap25)
router.get("/recap/:year?", annualRecapHandler);

// Bonds Screener (Snowball Analytics /bonds-screener)
router.get("/bonds-screener", bondsScreenerHandler);

// Congress Trading Tracker (Snowball Analytics /congresstrading)
router.get("/congress-trading", congressTradingHandler);

// Multi-Benchmark Alpha Overlay
router.get("/benchmark-overlay", benchmarkOverlayHandler);

// Registered before the JSON route so ".csv" is not swallowed as a path param.
router.get("/t5008.csv", t5008CsvHandler);
router.get("/t5008", t5008Handler);

export default router;

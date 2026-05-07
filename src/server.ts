import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRoutes from "./routes/apiRoutes.js";
import { logger, requestLogger } from "./utils/logger.js";
import { getAllDividendsForAllPortfolios } from "./services/dividendService.js";
import { refreshAllHoldings } from "./services/holdingsService.js";
import { refreshAllTransactions } from "./services/transactionService.js";
import { getSetting } from "./models/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json());
app.use(requestLogger); // Log every HTTP request + response status + duration
app.use(express.static(path.resolve(__dirname, "../public")));

// --- Routes ---
app.use("/api", apiRoutes);

// Global error handler — catches anything unhandled by controllers
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Server', `Unhandled error on ${req.method} ${req.path}: ${err.message}`, err.stack);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({
      error: "Internal Server Error",
      detail: err.message || "An unexpected error occurred"
    });
  }
  next(err);
});

// Schedule dividend fetch every 24 hours
function scheduleDividendFetch() {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minute max timeout per fetch

  async function fetchAndCache() {
    try {
      logger.info('Scheduler', 'Starting scheduled dividend fetch...');
      const start = Date.now();

      const fetchPromise = getAllDividendsForAllPortfolios();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Fetch timeout after ${FETCH_TIMEOUT_MS}ms`)), FETCH_TIMEOUT_MS)
      );

      await Promise.race([fetchPromise, timeoutPromise]);
      const elapsed = Date.now() - start;
      logger.info('Scheduler', `Scheduled dividend fetch completed in ${elapsed}ms`);
    } catch (err: any) {
      logger.error('Scheduler', `Scheduled dividend fetch failed: ${err.message}`);
    }
  }

  // Schedule for every 24 hours (no fetch on startup)
  setInterval(() => {
    logger.info('Scheduler', 'Running 24h scheduled dividend fetch...');
    fetchAndCache();
  }, TWENTY_FOUR_HOURS_MS);
  logger.info('Scheduler', 'Dividend fetch scheduled for every 24 hours');
}

function scheduleDataRefresh() {
  const HOURLY_MS = 60 * 60 * 1000;

  async function runRefreshCycle() {
    const hours = Math.max(1, parseInt(getSetting('data_refresh_interval_hours') ?? '24', 10));
    const intervalMs = hours * HOURLY_MS;
    logger.info('Scheduler', `Data refresh cycle — interval=${hours}h`);
    try {
      await refreshAllHoldings(intervalMs);
      await refreshAllTransactions(false, intervalMs);
    } catch (err: any) {
      logger.error('Scheduler', `Data refresh cycle failed: ${err.message}`);
    }
  }

  // Run once on startup (10s delay to let server finish initialising)
  setTimeout(() => {
    logger.info('Scheduler', 'Running initial data refresh on startup...');
    runRefreshCycle();
  }, 10_000);

  // Then check every hour — uses the configured interval for staleness checks
  setInterval(runRefreshCycle, HOURLY_MS);
  logger.info('Scheduler', 'Data refresh scheduler started (hourly checks, interval from settings)');
}

app.listen(port, () => {
  logger.info('Server', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info('Server', `  CentralFolio backend started`);
  logger.info('Server', `  Listening at http://localhost:${port}`);
  logger.info('Server', `  LOG_LEVEL=${process.env.LOG_LEVEL ?? 'info'}`);
  logger.info('Server', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // Start schedulers
  scheduleDividendFetch();
  scheduleDataRefresh();
});

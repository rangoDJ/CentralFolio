import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRoutes from "./routes/apiRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { requireAuth } from "./middleware/auth.js";
import { logger, requestLogger } from "./utils/logger.js";
import { getAllDividendsForAllPortfolios } from "./services/dividendService.js";
import { refreshAllHoldings } from "./services/holdingsService.js";
import { refreshAllTransactions } from "./services/transactionService.js";
import { getSetting } from "./models/db.js";
import { registerJob, updateJobInterval } from "./services/schedulerService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json());
app.use(requestLogger);
app.use(express.static(path.resolve(__dirname, "../public")));

// --- Auth routes (public) ---
app.use("/auth", authRoutes);

// --- Protected API routes ---
app.use("/api", requireAuth, apiRoutes);

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Server', `Unhandled error on ${req.method} ${req.path}: ${err.message}`, err.stack);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: "Internal Server Error", detail: err.message });
  }
  next(err);
});

app.listen(port, () => {
  logger.info('Server', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info('Server', `  CentralFolio backend started`);
  logger.info('Server', `  Listening at http://localhost:${port}`);
  logger.info('Server', `  LOG_LEVEL=${process.env.LOG_LEVEL ?? 'info'}`);
  logger.info('Server', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const hourMs = 60 * 60 * 1000;

  // Helper: read stored custom interval from DB, fall back to default
  function storedInterval(jobName: string, defaultMs: number): number {
    const stored = getSetting(`job_${jobName}_interval_hours`);
    if (stored) {
      const h = parseFloat(stored);
      if (!isNaN(h) && h > 0) return Math.round(h * hourMs);
    }
    return defaultMs;
  }

  registerJob(
    'dividend-fetch',
    'Dividend Data Fetch',
    storedInterval('dividend-fetch', 7 * 24 * hourMs),
    () => getAllDividendsForAllPortfolios(),
    false
  );

  registerJob(
    'holdings-refresh',
    'Holdings Refresh',
    storedInterval('holdings-refresh', hourMs),
    async () => {
      const hours = Math.max(1, parseInt(getSetting('data_refresh_interval_hours') ?? '24', 10));
      await refreshAllHoldings(hours * hourMs);
    },
    false
  );

  registerJob(
    'transactions-refresh',
    'Transactions Refresh',
    storedInterval('transactions-refresh', hourMs),
    async () => {
      const hours = Math.max(1, parseInt(getSetting('data_refresh_interval_hours') ?? '24', 10));
      await refreshAllTransactions(false, hours * hourMs);
    },
    false
  );
});

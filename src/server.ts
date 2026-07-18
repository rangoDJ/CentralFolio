import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRoutes from "./routes/apiRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { requireAuth, issueSSETicket, consumeSSETicket } from "./middleware/auth.js";
import { streamEvents } from "./controllers/eventsController.js";
import { logger, requestLogger } from "./utils/logger.js";
import { getAllDividendsForAllPortfolios } from "./services/dividendService.js";
import { refreshAllHoldings } from "./services/holdingsService.js";
import { refreshAllTransactions } from "./services/transactionService.js";
import { syncAllHeldSymbols } from "./services/priceHistoryService.js";
import { refreshStockRatings } from "./services/stockRatingService.js";
import { getSetting } from "./models/db.js";
import { registerJob, updateJobInterval } from "./services/schedulerService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const hourMs = 60 * 60 * 1000;

function storedInterval(jobName: string, defaultMs: number): number {
  const stored = getSetting(`job_${jobName}_interval_hours`);
  if (stored) {
    const h = parseFloat(stored);
    if (!isNaN(h) && h > 0) return Math.round(h * hourMs);
  }
  return defaultMs;
}

app.set('trust proxy', 1);
// Caps request bodies well above any legitimate payload (trade orders, settings)
// while blocking unbounded uploads from exhausting memory.
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

// Baseline security headers — cheap to set, no dependency needed for this small a set.
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
  });
  next();
});

app.use(express.static(path.resolve(__dirname, "../public")));

// --- Auth routes (public) ---
app.use("/auth", authRoutes);

// --- SSE event routes (own auth layer, mounted before global requireAuth) ---
// /api/events/ticket  authenticated via Bearer, issues a 30-second one-time ticket.
// /api/events         authenticated via ticket (EventSource cannot send headers).
app.get("/api/events/ticket", requireAuth, issueSSETicket);
app.get("/api/events", consumeSSETicket, streamEvents);

// --- Protected API routes ---
app.use("/api", requireAuth, apiRoutes);

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Server', `Unhandled error on ${req.method} ${req.path}: ${err.message}`, err.stack);
  if (req.path.startsWith('/api/')) {
    // Detail is logged above; do not expose internals to the client.
    return res.status(500).json({ error: "Internal Server Error" });
  }
  next(err);
});

const server = app.listen(port, () => {
  logger.info('Server', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info('Server', `  CentralFolio backend started`);
  logger.info('Server', `  Listening at http://localhost:${port}`);
  logger.info('Server', `  LOG_LEVEL=${process.env.LOG_LEVEL ?? 'info'}`);
  logger.info('Server', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  registerJob(
    'dividend-fetch',
    'Dividend Data Fetch',
    storedInterval('dividend-fetch', 7 * 24 * hourMs),
    async (trigger: string) => {
      const bgFetchEnabled = getSetting('dividend_background_fetch_enabled') !== 'false';
      if (!bgFetchEnabled && trigger !== 'manual') {
        logger.info('Scheduler', `Skipping ${trigger} dividend fetch because automatic background sync is disabled`);
        return 'Skipped: Background sync is disabled';
      }
      const allowExternal = (trigger !== 'startup');
      const forceRefresh = (trigger === 'scheduled' || trigger === 'manual');
      logger.info('Scheduler', `Running dividend fetch (trigger: ${trigger}, forceRefresh: ${forceRefresh}, allowExternal: ${allowExternal})`);
      const results = await getAllDividendsForAllPortfolios(forceRefresh, allowExternal);
      const totalEvents = results.reduce((s, r) => s + (r.dividends?.length ?? 0), 0);
      return `Processed ${results.length} account(s), projected ${totalEvents} dividend event(s)`;
    },
    false
  );

  registerJob(
    'holdings-refresh',
    'Holdings Refresh',
    storedInterval('holdings-refresh', hourMs),
    async (trigger: string) => {
      const hours = Math.max(1, parseInt(getSetting('data_refresh_interval_hours') ?? '24', 10));
      if (trigger === 'startup') {
        logger.info('Scheduler', `Skipping holdings refresh on startup — loading cached data from database`);
        return 'Skipped on startup';
      }
      const forceRefresh = (trigger === 'scheduled' || trigger === 'manual');
      logger.info('Scheduler', `Running holdings refresh (trigger: ${trigger}, forceRefresh: ${forceRefresh})`);
      const stats = await refreshAllHoldings(hours * hourMs, forceRefresh);
      const holdingParts = [`Processed ${stats.processed} account(s)`];
      if (stats.skippedInactive > 0) holdingParts.push(`${stats.skippedInactive} inactive skipped`);
      if (stats.skipped > 0) holdingParts.push(`${stats.skipped} cache-fresh skipped`);
      holdingParts.push(`${stats.newHoldings} new holding(s)`);
      holdingParts.push(`errors: ${stats.errors}`);
      return holdingParts.join(', ');
    },
    false
  );

  registerJob(
    'transactions-refresh',
    'Transactions Refresh',
    storedInterval('transactions-refresh', hourMs),
    async (trigger: string) => {
      const hours = Math.max(1, parseInt(getSetting('data_refresh_interval_hours') ?? '24', 10));
      if (trigger === 'startup') {
        logger.info('Scheduler', `Skipping transactions refresh on startup — loading cached data from database`);
        return 'Skipped on startup';
      }
      const forceRefresh = (trigger === 'scheduled' || trigger === 'manual');
      // A manual "Run now" pulls full history (backfill); automatic runs are incremental.
      const fullHistory = (trigger === 'manual');
      logger.info('Scheduler', `Running transactions refresh (trigger: ${trigger}, forceRefresh: ${forceRefresh}, fullHistory: ${fullHistory})`);
      const stats = await refreshAllTransactions(forceRefresh, hours * hourMs, fullHistory);
      const txnParts = [`Processed ${stats.processedCount} account(s)`];
      if (stats.skippedInactive > 0) txnParts.push(`${stats.skippedInactive} inactive skipped`);
      txnParts.push(`${stats.newTransactions} new transaction(s)`);
      txnParts.push(`errors: ${stats.errorCount}`);
      return txnParts.join(', ');
    },
    false
  );

  registerJob(
    'price-history-sync',
    'Price History Sync',
    storedInterval('price-history-sync', 24 * hourMs),
    async (trigger: string) => {
      if (trigger === 'startup') {
        logger.info('Scheduler', `Skipping price history sync on startup — serving cached data`);
        return 'Skipped on startup';
      }
      logger.info('Scheduler', `Running price history sync (trigger: ${trigger})`);
      const stats = await syncAllHeldSymbols();
      return `Synced ${stats.symbols} symbol(s), ${stats.updated} candle(s) written, errors: ${stats.errors}`;
    },
    false
  );

  registerJob(
    'stock-rating',
    'Stock Rating (AI)',
    storedInterval('stock-rating', 7 * 24 * hourMs),
    async (trigger: string) => {
      if (trigger === 'startup') {
        logger.info('Scheduler', 'Skipping stock rating on startup');
        return 'Skipped on startup';
      }
      const forceRefresh = trigger === 'manual';
      logger.info('Scheduler', `Running AI stock rating (trigger: ${trigger}, force: ${forceRefresh})`);
      const stats = await refreshStockRatings(forceRefresh);
      return `Analysed ${stats.analysed} symbol(s), skipped ${stats.skipped} (fresh), errors: ${stats.errors}`;
    },
    false
  );
});

function shutdown(signal: string) {
  logger.info('Server', `${signal} received — closing HTTP server`);
  server.close(() => {
    logger.info('Server', 'HTTP server closed, exiting');
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('Server', 'Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

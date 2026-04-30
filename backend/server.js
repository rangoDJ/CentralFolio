const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const log = require('./logger');
const db = require('./db');
const configManager = require('./configManager');
const { loadFromDisk } = require('./services/cache');
const { performSync } = require('./services/syncService');

const accountsRouter     = require('./routes/accounts');
const connectionsRouter  = require('./routes/connections');
const ordersRouter       = require('./routes/orders');
const transactionsRouter = require('./routes/transactions');
const automationsRouter  = require('./routes/automations');
const settingsRouter     = require('./routes/settings');
const snapTradeKeysRouter = require('./routes/snaptrade-keys');
const automationWorker  = require('./workers/automationWorker');
const cacheWorker       = require('./workers/cacheWorker');
const schedulerWorker   = require('./workers/schedulerWorker');

const cfLog  = log.make('centralfolio');
const httpLog = log.make('http');

(async () => {
  cfLog.info('Initializing configuration', { logLevel: log.activeLevel });
  await configManager.init();

  cfLog.info('Initializing database');
  db.initDb();

  cfLog.info('Restoring cache from disk');
  loadFromDisk();

  cfLog.info('Starting Express server');
  const app = express();
  const PORT = process.env.PORT || 3001;

  // Trust X-Forwarded-* headers from nginx/Caddy so rate limiting sees real client IPs
  app.set('trust proxy', 1);

  // Middleware
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5173'];
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json());

  app.use((req, res, next) => {
    const t0 = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - t0;
      const lvl = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'verbose';
      httpLog[lvl](`${req.method} ${req.path}`, {
        method: req.method, path: req.path,
        status: res.statusCode, durationMs: ms,
        ip: req.ip, query: Object.keys(req.query).length ? req.query : undefined
      });
    });
    next();
  });

  app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000, max: 200,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  }));

  // Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // Routes
  app.use('/api', accountsRouter);
  app.use('/api/connections', connectionsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/automations', automationsRouter);
  app.use('/api/automation-history', (_req, res) => res.json(db.getAutomationLogs())); // legacy alias
  app.use('/api/snaptrade-keys', snapTradeKeysRouter);
  app.use('/api', settingsRouter);

  const server = app.listen(PORT, () => {
    cfLog.info('Backend server running', { port: PORT, logLevel: log.activeLevel });

    // Start background workers
    automationWorker.start();
    cacheWorker.start();
    schedulerWorker.start();

    // Initial sync
    const hasAnyKeys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].some(i => {
      const clientId = db.getSetting(`SNAPTRADE_CLIENT_ID_${i}`) || (i === 1 ? db.getSetting('SNAPTRADE_CLIENT_ID') : null);
      const consumerKey = db.getSetting(`SNAPTRADE_CONSUMER_KEY_${i}`) || (i === 1 ? db.getSetting('SNAPTRADE_CONSUMER_KEY') : null);
      return clientId && (clientId.startsWith('PERS-') || consumerKey);
    });

    if (hasAnyKeys) {
      cfLog.info('SnapTrade keys detected, starting background auto-sync');
      performSync().catch(err => cfLog.error('Background startup sync failed', { error: err.message }));
    } else {
      cfLog.warn('Auto-sync skipped: No SnapTrade keys found in config or database');
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    cfLog.info('Shutting down gracefully');
    server.close(() => {
      try { db.db.close(); } catch (_) {}
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})();

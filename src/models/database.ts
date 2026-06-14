import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.resolve(__dirname, "../..");
const dbPath = path.join(dataDir, "snaptrade.db");

logger.info('DB', `Opening database at: ${dbPath}`);
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    clientId TEXT NOT NULL,
    consumerKey TEXT NOT NULL,
    userId TEXT NOT NULL,
    userSecret TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    portfolioId INTEGER NOT NULL,
    name TEXT,
    number TEXT,
    type TEXT,
    currency TEXT,
    isActive INTEGER NOT NULL DEFAULT 1,
    cachedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (portfolioId) REFERENCES portfolios (id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accountId TEXT NOT NULL,
    symbol TEXT,
    description TEXT,
    units REAL,
    price REAL,
    marketValue REAL,
    cachedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (accountId) REFERENCES accounts (id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS dividend_metadata (
    symbol TEXT PRIMARY KEY,
    frequency INTEGER,
    lastExDate TEXT,
    amountPerShare REAL,
    name TEXT,
    cachedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accountId TEXT NOT NULL,
    transactionId TEXT UNIQUE,
    symbol TEXT,
    description TEXT,
    type TEXT,
    action TEXT,
    units REAL,
    price REAL,
    amount REAL,
    date DATETIME,
    currencyCode TEXT,
    cachedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (accountId) REFERENCES accounts (id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#7c3aed',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_portfolio_accounts (
    portfolio_id INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    PRIMARY KEY (portfolio_id, account_id),
    FOREIGN KEY (portfolio_id) REFERENCES user_portfolios (id) ON DELETE CASCADE
  )
`);

// ── Indexes ───────────────────────────────────────────────────────────────────

db.exec(`CREATE INDEX IF NOT EXISTS idx_positions_accountId   ON positions(accountId)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_portfolioId  ON accounts(portfolioId)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_accountId ON transactions(accountId)`);

// ── Migration tracking table ───────────────────────────────────────────────────
// Records which migrations have been applied so each one runs exactly once.

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name      TEXT PRIMARY KEY,
    appliedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ── Migrations ────────────────────────────────────────────────────────────────

const migrations: Array<{ name: string; sql: string }> = [
  { name: 'accounts.isActive',          sql: `ALTER TABLE accounts ADD COLUMN isActive INTEGER NOT NULL DEFAULT 1` },
  { name: 'accounts.balanceTotal',      sql: `ALTER TABLE accounts ADD COLUMN balanceTotal REAL` },
  { name: 'accounts.customName',        sql: `ALTER TABLE accounts ADD COLUMN customName TEXT` },
  { name: 'positions.symbolId',         sql: `ALTER TABLE positions ADD COLUMN symbolId TEXT` },
  { name: 'portfolios.tradingEnabled',  sql: `ALTER TABLE portfolios ADD COLUMN tradingEnabled INTEGER NOT NULL DEFAULT 0` },
  { name: 'dividend_metadata.provider', sql: `ALTER TABLE dividend_metadata ADD COLUMN provider TEXT` },
];

const checkApplied = db.prepare(`SELECT 1 FROM schema_migrations WHERE name = ?`);
const markApplied  = db.prepare(`INSERT INTO schema_migrations (name) VALUES (?)`);

for (const m of migrations) {
  if (checkApplied.get(m.name)) {
    // Already applied in a previous run — skip silently
    continue;
  }
  try {
    db.exec(m.sql);
    markApplied.run(m.name);
    logger.info('Migration', `Applied: ${m.name}`);
  } catch (e: any) {
    // Tolerate "duplicate column" in case the DB was partially migrated before
    // schema_migrations existed (first boot after this upgrade).
    if (/duplicate column name/i.test(e.message ?? '')) {
      markApplied.run(m.name); // record as applied so we never try again
      logger.info('Migration', `Already present (backfilled): ${m.name}`);
    } else {
      logger.error('Migration', `Failed to apply "${m.name}": ${e.message}`);
    }
  }
}

// ── Startup log ───────────────────────────────────────────────────────────────

const count = (db.prepare("SELECT count(*) as count FROM portfolios").get() as any).count;
logger.info('DB', `Schema initialized. Found ${count} persisted portfolio(s).`);
if (count > 0) {
  const portfolios = db.prepare(
    "SELECT name, userId, (userSecret IS NOT NULL AND userSecret != '') AS registered FROM portfolios"
  ).all() as any[];
  portfolios.forEach(p => {
    logger.info('DB', `  • "${p.name}" — userId: ${p.userId} | registered: ${p.registered === 1}`);
  });
}

// ── Legacy data migration / env seed ─────────────────────────────────────────

try {
  const settingsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
  const portfoliosEmpty = (db.prepare("SELECT count(*) as count FROM portfolios").get() as any).count === 0;

  if (settingsTable && portfoliosEmpty) {
    const old = db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
    if (old) {
      logger.info('Migration', 'Migrating legacy settings row → portfolios table...');
      db.prepare(`INSERT INTO portfolios (name, clientId, consumerKey, userId, userSecret) VALUES (?, ?, ?, ?, ?)`)
        .run("Default Portfolio", old.clientId, old.consumerKey, old.userId, old.userSecret);
      logger.info('Migration', 'Migration complete.');
    }
  }


} catch (e) {
  logger.warn('Migration', `Migration/seed check failed: ${(e as any).message}`);
}

export default db;

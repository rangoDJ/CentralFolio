import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "../../snaptrade.db");

logger.info('DB', `Opening database at: ${dbPath}`);
export const db = new Database(dbPath);

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

// ── Migrations ────────────────────────────────────────────────────────────────

const migrations: Array<{ name: string; sql: string }> = [
  { name: 'accounts.isActive',       sql: `ALTER TABLE accounts ADD COLUMN isActive INTEGER NOT NULL DEFAULT 1` },
  { name: 'accounts.balanceTotal',   sql: `ALTER TABLE accounts ADD COLUMN balanceTotal REAL` },
  { name: 'accounts.customName',     sql: `ALTER TABLE accounts ADD COLUMN customName TEXT` },
  { name: 'positions.symbolId',      sql: `ALTER TABLE positions ADD COLUMN symbolId TEXT` },
  { name: 'portfolios.tradingEnabled', sql: `ALTER TABLE portfolios ADD COLUMN tradingEnabled INTEGER NOT NULL DEFAULT 0` },
];

for (const m of migrations) {
  try {
    db.exec(m.sql);
    logger.info('Migration', `Applied: ${m.name}`);
  } catch {
    // Column already exists — expected on every run after first
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

  const stillEmpty = (db.prepare("SELECT count(*) as count FROM portfolios").get() as any).count === 0;
  if (stillEmpty && process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY) {
    logger.info('Migration', 'Seeding initial portfolio from environment variables...');
    db.prepare(`INSERT INTO portfolios (name, clientId, consumerKey, userId, userSecret) VALUES (?, ?, ?, ?, ?)`)
      .run(
        "Default Portfolio",
        process.env.SNAPTRADE_CLIENT_ID,
        process.env.SNAPTRADE_CONSUMER_KEY,
        process.env.SNAPTRADE_USER_ID || "default-user",
        process.env.SNAPTRADE_USER_SECRET || null
      );
    logger.info('Migration', 'Seeded default portfolio from env.');
  }
} catch (e) {
  logger.warn('Migration', `Migration/seed check failed: ${(e as any).message}`);
}

export default db;

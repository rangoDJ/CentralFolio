import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Adjusted path for src/models/db.ts
const dbPath = path.resolve(__dirname, "../../snaptrade.db");

logger.info('DB', `Opening database at: ${dbPath}`);
const db = new Database(dbPath);

// Initialize tables
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

// Migration: add isActive column to existing accounts tables that don't have it
try {
  db.exec(`ALTER TABLE accounts ADD COLUMN isActive INTEGER NOT NULL DEFAULT 1`);
  logger.info('Migration', 'Added isActive column to accounts table');
} catch (_) {
  // Column already exists — ignore
}

// Migration: add balanceTotal column to store account balance for dashboard display
try {
  db.exec(`ALTER TABLE accounts ADD COLUMN balanceTotal REAL`);
  logger.info('Migration', 'Added balanceTotal column to accounts table');
} catch (_) {
  // Column already exists — ignore
}

// Migration: add symbolId to positions for trade order placement
try {
  db.exec(`ALTER TABLE positions ADD COLUMN symbolId TEXT`);
  logger.info('Migration', 'Added symbolId column to positions table');
} catch (_) {
  // Column already exists — ignore
}

// Migration: add customName column for user-assigned account nicknames
try {
  db.exec(`ALTER TABLE accounts ADD COLUMN customName TEXT`);
  logger.info('Migration', 'Added customName column to accounts table');
} catch (_) {
  // Column already exists — ignore
}

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

// Migration: add tradingEnabled column to portfolios
try {
  db.exec(`ALTER TABLE portfolios ADD COLUMN tradingEnabled INTEGER NOT NULL DEFAULT 0`);
  logger.info('Migration', 'Added tradingEnabled column to portfolios table');
} catch (_) {
  // Column already exists — ignore
}

// Startup verification log
const count = (db.prepare("SELECT count(*) as count FROM portfolios").get() as any).count;
logger.info('DB', `Schema initialized. Found ${count} persisted portfolio(s).`);
if (count > 0) {
  const portfolios = db.prepare("SELECT name, userId, userSecret FROM portfolios").all() as any[];
  portfolios.forEach(p => {
    logger.info('DB', `  • "${p.name}" — userId: ${p.userId} | registered: ${!!p.userSecret}`);
  });
}

// Migration: Check if old settings table exists and has data
try {
  const settingsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
  const portfoliosEmpty = (db.prepare("SELECT count(*) as count FROM portfolios").get() as any).count === 0;

  if (settingsTable && portfoliosEmpty) {
    const oldSettings = db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
    if (oldSettings) {
      logger.info('Migration', 'Migrating legacy settings row → portfolios table...');
      db.prepare(`
        INSERT INTO portfolios (name, clientId, consumerKey, userId, userSecret)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        "Default Portfolio",
        oldSettings.clientId,
        oldSettings.consumerKey,
        oldSettings.userId,
        oldSettings.userSecret
      );
      logger.info('Migration', 'Migration complete.');
    }
  }

  // Seed from .env if still empty
  const stillEmpty = (db.prepare("SELECT count(*) as count FROM portfolios").get() as any).count === 0;
  if (stillEmpty && process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY) {
    logger.info('Migration', 'Seeding initial portfolio from environment variables...');
    db.prepare(`
      INSERT INTO portfolios (name, clientId, consumerKey, userId, userSecret)
      VALUES (?, ?, ?, ?, ?)
    `).run(
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

export interface Portfolio {
  id?: number;
  name: string;
  clientId: string;
  consumerKey: string;
  userId: string;
  userSecret?: string;
  tradingEnabled?: boolean | number;
}

export function listPortfolios(): Portfolio[] {
  const rows = db.prepare("SELECT * FROM portfolios ORDER BY id ASC").all() as Portfolio[];
  logger.debug('DB', `listPortfolios → ${rows.length} row(s)`);
  return rows;
}

export function getPortfolio(id: number | string): Portfolio | null {
  const row = db.prepare("SELECT * FROM portfolios WHERE id = ?").get(id) as Portfolio || null;
  logger.debug('DB', `getPortfolio(${id}) → ${row ? `"${row.name}"` : 'null'}`);
  return row;
}

export function savePortfolio(portfolio: Portfolio): number {
  if (portfolio.id) {
    logger.info('DB', `Updating portfolio id=${portfolio.id} name="${portfolio.name}"`);
    const existing = getPortfolio(portfolio.id);
    db.prepare(`
      UPDATE portfolios 
      SET name = ?, clientId = ?, consumerKey = ?, userId = ?, userSecret = ?
      WHERE id = ?
    `).run(
      portfolio.name,
      portfolio.clientId,
      portfolio.consumerKey,
      portfolio.userId,
      portfolio.userSecret || existing?.userSecret || null,
      portfolio.id
    );
    return portfolio.id;
  } else {
    logger.info('DB', `Inserting new portfolio name="${portfolio.name}"`);
    const result = db.prepare(`
      INSERT INTO portfolios (name, clientId, consumerKey, userId, userSecret)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      portfolio.name,
      portfolio.clientId,
      portfolio.consumerKey,
      portfolio.userId,
      portfolio.userSecret || null
    );
    const newId = result.lastInsertRowid as number;
    logger.info('DB', `New portfolio inserted with id=${newId}`);
    return newId;
  }
}

export function deletePortfolio(id: number | string) {
  logger.info('DB', `Deleting portfolio id=${id}`);
  db.prepare("DELETE FROM portfolios WHERE id = ?").run(id);
}

export function setPortfolioTradingEnabled(id: number | string, enabled: boolean) {
  logger.info('DB', `setPortfolioTradingEnabled(${id}) → ${enabled}`);
  db.prepare("UPDATE portfolios SET tradingEnabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

// Caching functions
export function getCachedAccounts(portfolioId: number | string): any[] {
  const rows = db.prepare("SELECT * FROM accounts WHERE portfolioId = ?").all(portfolioId) as any[];
  logger.debug('DB', `getCachedAccounts(portfolio=${portfolioId}) → ${rows.length} row(s)`);
  return rows.map(r => ({
    ...r,
    isActive: r.isActive === 1 || r.isActive === true,
    balance: r.balanceTotal != null ? { total: { amount: r.balanceTotal, currency: r.currency } } : undefined,
  }));
}

export function getActiveAccountIds(): Set<string> {
  const rows = db.prepare("SELECT id FROM accounts WHERE isActive = 1").all() as any[];
  const ids = new Set<string>(rows.map(r => r.id));
  logger.debug('DB', `getActiveAccountIds → ${ids.size} active account(s)`);
  return ids;
}

export function setAccountActive(accountId: string, isActive: boolean) {
  logger.info('DB', `setAccountActive(${accountId}) → ${isActive}`);
  db.prepare("UPDATE accounts SET isActive = ? WHERE id = ?").run(isActive ? 1 : 0, accountId);
}

export function getAccountActive(accountId: string): boolean | null {
  const row = db.prepare("SELECT isActive FROM accounts WHERE id = ?").get(accountId) as any;
  if (!row) {
    logger.debug('DB', `getAccountActive(${accountId}) → null (account not found)`);
    return null;
  }
  const isActive = row.isActive === 1 || row.isActive === true;
  logger.debug('DB', `getAccountActive(${accountId}) → ${isActive}`);
  return isActive;
}

export function getDividendProviders(): Record<string, any> {
  const providers = getSetting("dividend_providers");
  if (!providers) {
    return { yahoo: true, polygon: false, alphavantage: false, finnhub: false };
  }
  try {
    return JSON.parse(providers);
  } catch {
    return { yahoo: true, polygon: false, alphavantage: false, finnhub: false };
  }
}

export function setDividendProviders(providers: Record<string, boolean>) {
  setSetting("dividend_providers", JSON.stringify(providers));
}

export function saveCachedAccounts(portfolioId: number | string, accounts: any[]) {
  logger.info('DB', `saveCachedAccounts(portfolio=${portfolioId}) — saving ${accounts.length} account(s), preserving isActive flags and custom names`);

  // Preserve existing isActive flags and custom names before wiping the table
  const existing = db.prepare("SELECT id, isActive, customName FROM accounts WHERE portfolioId = ?").all(portfolioId) as any[];
  const activeMap = new Map<string, number>(existing.map(r => [r.id, r.isActive]));
  const customNameMap = new Map<string, string | null>(existing.map(r => [r.id, r.customName]));

  const deleteStmt = db.prepare("DELETE FROM accounts WHERE portfolioId = ?");
  const insertStmt = db.prepare(`
    INSERT INTO accounts (id, portfolioId, name, number, type, currency, isActive, balanceTotal, customName, cachedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const transaction = db.transaction((data) => {
    deleteStmt.run(portfolioId);
    for (const acc of data) {
      const isActive = activeMap.has(acc.id) ? activeMap.get(acc.id) : 1;
      const balanceTotal = acc.balance?.total?.amount ?? null;
      const customName = customNameMap.get(acc.id) ?? null;
      insertStmt.run(
        acc.id,
        portfolioId,
        acc.name || null,
        acc.number || null,
        acc.type || null,
        acc.currency || null,
        isActive,
        balanceTotal,
        customName
      );
    }
  });

  transaction(accounts);
}

export function setAccountCustomName(accountId: string, customName: string | null) {
  logger.info('DB', `setAccountCustomName(${accountId}) → "${customName}"`);
  db.prepare("UPDATE accounts SET customName = ? WHERE id = ?").run(customName || null, accountId);
}

export function getCachedPositions(accountId: string): any[] {
  const rows = db.prepare("SELECT * FROM positions WHERE accountId = ?").all(accountId);
  logger.debug('DB', `getCachedPositions(account=${accountId}) → ${rows.length} position(s)`);
  return rows;
}

export function saveCachedPositions(accountId: string, positions: any[]) {
  logger.info('DB', `saveCachedPositions(account=${accountId}) — saving ${positions.length} position(s)`);
  const deleteStmt = db.prepare("DELETE FROM positions WHERE accountId = ?");
  const insertStmt = db.prepare(`
    INSERT INTO positions (accountId, symbol, symbolId, description, units, price, marketValue, cachedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const transaction = db.transaction((data) => {
    deleteStmt.run(accountId);
    if (data.length > 0) {
      logger.info('DB', `saveCachedPositions — first pos keys: ${Object.keys(data[0]).join(', ')}`);
      logger.info('DB', `saveCachedPositions — first pos raw: ${JSON.stringify(data[0]).slice(0, 400)}`);
    }
    for (const pos of data) {
      // Support both V2 (instrument) and V1 (symbol) SnapTrade response shapes
      const symbol = pos.instrument?.symbol || pos.instrument?.raw_symbol
        || (pos.symbol as any)?.symbol?.symbol || pos.symbol?.symbol || pos.symbol;
      const symbolId = pos.instrument?.id || (pos.symbol as any)?.symbol?.id || null;
      const description = pos.instrument?.description
        || (pos.symbol as any)?.description || pos.description;
      logger.info('DB', `  pos: symbol=${symbol} symbolId=${symbolId}`);

      insertStmt.run(
        accountId,
        symbol || null,
        symbolId || null,
        description || null,
        pos.units || 0,
        pos.price || 0,
        pos.marketValue || 0
      );
    }
  });

  transaction(positions);
}

export function clearCache() {
  logger.warn('DB', 'clearCache() called — wiping accounts, positions, and dividend_metadata tables.');
  db.prepare("DELETE FROM accounts").run();
  db.prepare("DELETE FROM positions").run();
  db.prepare("DELETE FROM dividend_metadata").run();
}

export function getCachedDividendMetadata(symbol: string): any | null {
  const row = db.prepare("SELECT * FROM dividend_metadata WHERE symbol = ?").get(symbol) || null;
  logger.debug('DB', `getCachedDividendMetadata(${symbol}) → ${row ? 'HIT' : 'MISS'}`);
  return row;
}

export function saveCachedDividendMetadata(symbol: string, data: any) {
  logger.debug('DB', `saveCachedDividendMetadata(${symbol}) frequency=${data.frequency} amount=${data.amountPerShare}`);
  db.prepare(`
    INSERT OR REPLACE INTO dividend_metadata (symbol, frequency, lastExDate, amountPerShare, name, cachedAt)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    symbol,
    data.frequency ?? null,
    data.lastExDate ?? null,
    data.amountPerShare ?? null,
    data.name ?? null
  );
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM global_settings WHERE key = ?").get(key) as any;
  logger.debug('DB', `getSetting("${key}") → ${row ? '"' + row.value + '"' : 'null'}`);
  return row ? row.value : null;
}

export function setSetting(key: string, value: string) {
  logger.info('DB', `setSetting("${key}") = "${value}"`);
  db.prepare("INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)").run(key, value);
}

export function listSettings(): Record<string, string> {
  const rows = db.prepare("SELECT * FROM global_settings").all() as any[];
  logger.debug('DB', `listSettings() → ${rows.length} key(s)`);
  const settings: Record<string, string> = {};
  rows.forEach(row => {
    settings[row.key] = row.value;
  });
  return settings;
}

// Transaction caching functions
export function getCachedTransactions(accountId: string, limit: number = 500): any[] {
  const rows = db.prepare("SELECT * FROM transactions WHERE accountId = ? ORDER BY date DESC LIMIT ?").all(accountId, limit);
  logger.debug('DB', `getCachedTransactions(account=${accountId}) → ${rows.length} transaction(s)`);
  return rows;
}

export function saveCachedTransactions(accountId: string, transactions: any[]) {
  logger.info('DB', `saveCachedTransactions(account=${accountId}) — saving ${transactions.length} transaction(s)`);

  const deleteStmt = db.prepare("DELETE FROM transactions WHERE accountId = ?");
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO transactions (accountId, transactionId, symbol, description, type, action, units, price, amount, date, currencyCode, cachedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const transaction = db.transaction((data) => {
    deleteStmt.run(accountId);
    for (const txn of data) {
      insertStmt.run(
        accountId,
        txn.id || txn.transactionId || null,
        txn.symbol || null,
        txn.description || null,
        txn.type || null,
        txn.action || null,
        txn.units || null,
        txn.price || null,
        txn.amount || null,
        txn.date || null,
        txn.currencyCode || null
      );
    }
  });

  transaction(transactions);
}

export function clearTransactionCache() {
  logger.warn('DB', 'clearTransactionCache() called — wiping transactions table.');
  db.prepare("DELETE FROM transactions").run();
}

// Backward compatibility (deprecated)
export function getSettings() {
  const all = listPortfolios();
  return all.length > 0 ? all[0] : null;
}

export default db;

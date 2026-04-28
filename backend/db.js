const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { encrypt, decrypt } = require('./cryptoUtils');
const log = require('./logger');
const dbLog = log.make('db');

// All persistent data lives under DATA_DIR so a single Docker volume covers everything.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'user_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'folio.db');
const db = new DatabaseSync(dbPath);

// Initialize Tables
const initDb = () => {
  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Brokerage Connections table
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      brokerage_name TEXT,
      connection_status TEXT,
      last_synced DATETIME
    )
  `);

  // Individual brokerage accounts (populated after sync; user assigns portfolio names)
  db.exec(`
    CREATE TABLE IF NOT EXISTS brokerage_accounts (
      id             TEXT PRIMARY KEY,
      connection_id  TEXT,
      brokerage      TEXT,
      account_name   TEXT,
      account_number TEXT,
      currency       TEXT,
      portfolio      TEXT DEFAULT NULL,
      is_selected    BOOLEAN DEFAULT 0
    )
  `);

  // Transactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      trade_date DATETIME,
      type TEXT,
      amount REAL,
      currency TEXT,
      symbol TEXT,
      description TEXT,
      category TEXT
    )
  `);
  // Automations table (Refactored to account-level)
  db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT UNIQUE,
      percentage REAL DEFAULT 100,
      is_active BOOLEAN DEFAULT 1
    )
  `);

  // Migration: Ensure automations table has correct columns for account-level rules
  try { db.exec(`ALTER TABLE automations ADD COLUMN account_id TEXT UNIQUE`); } catch (e) {}
  try { db.exec(`ALTER TABLE automations ADD COLUMN percentage REAL DEFAULT 100`); } catch (e) {}
  try { db.exec(`ALTER TABLE automations ADD COLUMN is_active BOOLEAN DEFAULT 1`); } catch (e) {}
  try { db.exec(`ALTER TABLE automations ADD COLUMN excluded_symbols TEXT DEFAULT ''`); } catch (e) {}

  // Automation Logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_id INTEGER,
      transaction_id TEXT UNIQUE,
      order_id TEXT,
      amount_reinvested REAL,
      status TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Pending Automations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_automations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_id INTEGER,
      transaction_id TEXT UNIQUE,
      amount REAL,
      symbol TEXT,
      account_id TEXT,
      process_after DATETIME,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: Add is_selected if it doesn't exist (for existing DBs)
  try {
    db.exec(`ALTER TABLE brokerage_accounts ADD COLUMN is_selected BOOLEAN DEFAULT 0`);
  } catch (e) {
    // Ignore error if column already exists
  }

  // Indexes for frequent query patterns
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(trade_date DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pending_automations_status ON pending_automations(status, process_after)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_automation_logs_tx ON automation_logs(transaction_id)`);

  // Purge legacy mock data if it exists
  try {
    db.exec("DELETE FROM connections WHERE id = 'mock_ws_1'");
    db.exec("DELETE FROM brokerage_accounts WHERE connection_id = 'mock_ws_1'");
  } catch (e) {}

  dbLog.info('Database initialized', { dataDir: DATA_DIR, dbPath });
};

const getSetting = (key) => {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get(key);
  if (!row) return null;
  if (key.includes('SECRET') || key.includes('KEY') || key.includes('TOKEN')) {
    return decrypt(row.value);
  }
  return row.value;
};

const setSetting = (key, value) => {
  let finalValue = value;
  if (key.includes('SECRET') || key.includes('KEY') || key.includes('TOKEN')) {
    finalValue = encrypt(value);
  }
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  stmt.run(key, finalValue);
};

const getAllSettings = () => {
  const stmt = db.prepare('SELECT * FROM settings');
  return stmt.all();
};

const upsertConnection = (id, brokerage, status) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO connections (id, brokerage_name, connection_status, last_synced) VALUES (?, ?, ?, CURRENT_TIMESTAMP)');
  stmt.run(id, brokerage, status);
};

const getAllConnections = () => {
  const stmt = db.prepare('SELECT * FROM connections');
  return stmt.all();
};

// Upserts a brokerage account but preserves an existing portfolio assignment
const upsertBrokerageAccount = (id, connectionId, brokerage, accountName, accountNumber, currency) => {
  const stmt = db.prepare(`
    INSERT INTO brokerage_accounts (id, connection_id, brokerage, account_name, account_number, currency)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      connection_id  = excluded.connection_id,
      brokerage      = excluded.brokerage,
      account_name   = excluded.account_name,
      account_number = excluded.account_number,
      currency       = excluded.currency
  `);
  stmt.run(id, connectionId, brokerage, accountName, accountNumber, currency);
};

const getAllBrokerageAccounts = () => {
  const stmt = db.prepare('SELECT * FROM brokerage_accounts ORDER BY brokerage, account_name');
  return stmt.all();
};

const setAccountPortfolio = (id, portfolio) => {
  const stmt = db.prepare('UPDATE brokerage_accounts SET portfolio = ? WHERE id = ?');
  stmt.run(portfolio, id);
};

const toggleAccountSelection = (id, isSelected) => {
  const stmt = db.prepare('UPDATE brokerage_accounts SET is_selected = ? WHERE id = ?');
  stmt.run(isSelected ? 1 : 0, id);
};

const upsertTransaction = (tx) => {
  const stmt = db.prepare(`
    INSERT INTO transactions (id, account_id, trade_date, type, amount, currency, symbol, description, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      amount = excluded.amount,
      symbol = excluded.symbol,
      description = excluded.description,
      category = COALESCE(transactions.category, excluded.category)
  `);
  stmt.run(
    tx.id, tx.account_id, tx.trade_date, tx.type, tx.amount, tx.currency, 
    tx.symbol, tx.description, tx.category
  );
};

const getTransactions = (filters = {}) => {
  let query = 'SELECT * FROM transactions';
  const conditions = [];
  const params = [];
  
  if (filters.category) {
    conditions.push('category = ?');
    params.push(filters.category);
  }
  
  if (filters.account_id) {
    conditions.push('account_id = ?');
    params.push(filters.account_id);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY trade_date DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  if (filters.offset) {
    query += ' OFFSET ?';
    params.push(filters.offset);
  }

  return db.prepare(query).all(...params);
};

const updateTransactionCategory = (id, category) => {
  const stmt = db.prepare('UPDATE transactions SET category = ? WHERE id = ?');
  stmt.run(category, id);
};

const getAutomations = () => {
  const stmt = db.prepare('SELECT * FROM automations');
  return stmt.all();
};

const upsertAutomation = (account_id, percentage, excluded_symbols = '') => {
  const stmt = db.prepare('INSERT OR REPLACE INTO automations (account_id, percentage, excluded_symbols, is_active) VALUES (?, ?, ?, 1)');
  stmt.run(account_id, percentage, excluded_symbols);
};

const deleteAutomation = (id) => {
  const stmt = db.prepare('DELETE FROM automations WHERE id = ?');
  stmt.run(id);
};

const getAutomationLogs = () => {
  const stmt = db.prepare('SELECT * FROM automation_logs ORDER BY timestamp DESC LIMIT 50');
  return stmt.all();
};

const logAutomationAction = (automation_id, transaction_id, order_id, amount, status) => {
  const stmt = db.prepare('INSERT INTO automation_logs (automation_id, transaction_id, order_id, amount_reinvested, status) VALUES (?, ?, ?, ?, ?)');
  stmt.run(automation_id, transaction_id, order_id, amount, status);
};

const isTransactionProcessed = (transaction_id) => {
  const stmt = db.prepare('SELECT id FROM automation_logs WHERE transaction_id = ?');
  return !!stmt.get(transaction_id);
};
const addPendingAutomation = (automation_id, transaction_id, amount, symbol, account_id, processAfter) => {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO pending_automations (automation_id, transaction_id, amount, symbol, account_id, process_after)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(automation_id, transaction_id, amount, symbol, account_id, processAfter);
};

const getReadyPendingAutomations = () => {
  const stmt = db.prepare("SELECT * FROM pending_automations WHERE status = 'PENDING' AND process_after <= CURRENT_TIMESTAMP");
  return stmt.all();
};

const updatePendingStatus = (id, status) => {
  const stmt = db.prepare('UPDATE pending_automations SET status = ? WHERE id = ?');
  stmt.run(status, id);
};

const deletePendingAutomation = (id) => {
  const stmt = db.prepare('DELETE FROM pending_automations WHERE id = ?');
  stmt.run(id);
};

const isTransactionQueued = (transaction_id) => {
  const stmt = db.prepare('SELECT id FROM pending_automations WHERE transaction_id = ?');
  return !!stmt.get(transaction_id);
};

module.exports = {
  db,
  initDb,
  getSetting,
  setSetting,
  getAllSettings,
  upsertConnection,
  getAllConnections,
  upsertBrokerageAccount,
  getAllBrokerageAccounts,
  setAccountPortfolio,
  toggleAccountSelection,
  upsertTransaction,
  getTransactions,
  updateTransactionCategory,
  getAutomations,
  upsertAutomation,
  deleteAutomation,
  getAutomationLogs,
  logAutomationAction,
  isTransactionProcessed,
  addPendingAutomation,
  getReadyPendingAutomations,
  updatePendingStatus,
  deletePendingAutomation,
  isTransactionQueued
};

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "../snaptrade.db");

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

// Startup verification log
const count = (db.prepare("SELECT count(*) as count FROM portfolios").get() as any).count;
console.log(`[DB] Database initialized. Found ${count} persisted portfolios.`);
if (count > 0) {
  const portfolios = db.prepare("SELECT name, userId, userSecret FROM portfolios").all() as any[];
  portfolios.forEach(p => {
    console.log(`[DB] - Portfolio: "${p.name}" (User: ${p.userId}, Registered: ${!!p.userSecret})`);
  });
}

// Migration: Check if old settings table exists and has data
try {
  const settingsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
  const portfoliosEmpty = (db.prepare("SELECT count(*) as count FROM portfolios").get() as any).count === 0;

  if (settingsTable && portfoliosEmpty) {
    const oldSettings = db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
    if (oldSettings) {
      console.log("Migrating legacy settings to portfolios table...");
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
    }
  }

  // Seed from .env if still empty
  const stillEmpty = (db.prepare("SELECT count(*) as count FROM portfolios").get() as any).count === 0;
  if (stillEmpty && process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY) {
    console.log("Seeding initial portfolio from environment variables...");
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
  }
} catch (e) {
  console.warn("Migration check failed:", e);
}

export interface Portfolio {
  id?: number;
  name: string;
  clientId: string;
  consumerKey: string;
  userId: string;
  userSecret?: string;
}

export function listPortfolios(): Portfolio[] {
  return db.prepare("SELECT * FROM portfolios ORDER BY id ASC").all() as Portfolio[];
}

export function getPortfolio(id: number | string): Portfolio | null {
  return db.prepare("SELECT * FROM portfolios WHERE id = ?").get(id) as Portfolio || null;
}

export function savePortfolio(portfolio: Portfolio): number {
  if (portfolio.id) {
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
    return result.lastInsertRowid as number;
  }
}

export function deletePortfolio(id: number | string) {
  db.prepare("DELETE FROM portfolios WHERE id = ?").run(id);
}

// Backward compatibility (deprecated)
export function getSettings() {
  const all = listPortfolios();
  return all.length > 0 ? all[0] : null;
}

export default db;

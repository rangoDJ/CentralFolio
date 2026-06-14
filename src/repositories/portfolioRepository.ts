import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

export interface Portfolio {
  id?: number;
  name: string;
  clientId: string;
  consumerKey: string;
  userId: string;
  userSecret?: string;
  tradingEnabled?: boolean | number;
}

// ── Prepared statements (compiled once at module load for performance) ─────────

const stmtListPortfolios = db.prepare(
  "SELECT * FROM portfolios ORDER BY id ASC"
);

const stmtGetPortfolio = db.prepare(
  "SELECT * FROM portfolios WHERE id = ?"
);

const stmtUpdatePortfolio = db.prepare(`
  UPDATE portfolios
  SET name = ?, clientId = ?, consumerKey = ?, userId = ?, userSecret = ?
  WHERE id = ?
`);

const stmtInsertPortfolio = db.prepare(`
  INSERT INTO portfolios (name, clientId, consumerKey, userId, userSecret)
  VALUES (?, ?, ?, ?, ?)
`);

const stmtDeletePortfolio = db.prepare(
  "DELETE FROM portfolios WHERE id = ?"
);

const stmtSetTradingEnabled = db.prepare(
  "UPDATE portfolios SET tradingEnabled = ? WHERE id = ?"
);

// ── Public API ────────────────────────────────────────────────────────────────

export function listPortfolios(): Portfolio[] {
  const rows = stmtListPortfolios.all() as Portfolio[];
  logger.debug('DB', `listPortfolios → ${rows.length} row(s)`);
  return rows;
}

export function getPortfolio(id: number | string): Portfolio | null {
  const row = stmtGetPortfolio.get(id) as Portfolio || null;
  logger.debug('DB', `getPortfolio(${id}) → ${row ? `"${row.name}"` : 'null'}`);
  return row;
}

export function savePortfolio(portfolio: Portfolio): number {
  if (portfolio.id) {
    logger.info('DB', `Updating portfolio id=${portfolio.id} name="${portfolio.name}"`);
    const existing = getPortfolio(portfolio.id);
    stmtUpdatePortfolio.run(
      portfolio.name,
      portfolio.clientId,
      portfolio.consumerKey,
      portfolio.userId,
      portfolio.userSecret || existing?.userSecret || null,
      portfolio.id
    );
    return portfolio.id;
  }

  logger.info('DB', `Inserting new portfolio name="${portfolio.name}"`);
  const result = stmtInsertPortfolio.run(
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

export function deletePortfolio(id: number | string) {
  logger.info('DB', `Deleting portfolio id=${id}`);
  stmtDeletePortfolio.run(id);
}

export function setPortfolioTradingEnabled(id: number | string, enabled: boolean) {
  logger.info('DB', `setPortfolioTradingEnabled(${id}) → ${enabled}`);
  stmtSetTradingEnabled.run(enabled ? 1 : 0, id);
}

import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";
import { emitDataChanged } from "../services/eventBus.js";

export interface TargetAllocation {
  portfolioId: number;
  symbol: string;
  targetPct: number;
}

const stmtGetTargets = db.prepare(
  "SELECT symbol, target_pct AS targetPct FROM user_portfolio_targets WHERE portfolio_id = ?"
);

const stmtDeleteTargets = db.prepare(
  "DELETE FROM user_portfolio_targets WHERE portfolio_id = ?"
);

const stmtInsertTarget = db.prepare(
  "INSERT INTO user_portfolio_targets (portfolio_id, symbol, target_pct) VALUES (?, ?, ?)"
);

export function getPortfolioTargets(portfolioId: number): { symbol: string; targetPct: number }[] {
  const rows = stmtGetTargets.all(portfolioId) as { symbol: string; targetPct: number }[];
  logger.debug('DB', `getPortfolioTargets(${portfolioId}) → ${rows.length} target(s)`);
  return rows;
}

export function setPortfolioTargets(portfolioId: number, targets: { symbol: string; targetPct: number }[]): void {
  logger.info('DB', `setPortfolioTargets(${portfolioId}) — setting ${targets.length} target(s)`);
  db.transaction(() => {
    stmtDeleteTargets.run(portfolioId);
    for (const t of targets) {
      stmtInsertTarget.run(portfolioId, t.symbol.toUpperCase().trim(), t.targetPct);
    }
  })();
  emitDataChanged('targets');
}

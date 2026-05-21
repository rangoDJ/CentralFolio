import { db } from "../models/db.js";

export interface UserPortfolio {
  id: number;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  accountIds?: string[];
}

export function getAllUserPortfolios(): UserPortfolio[] {
  const portfolios = db.prepare(`
    SELECT id, name, description, color, createdAt FROM user_portfolios ORDER BY name ASC
  `).all() as UserPortfolio[];

  const accountMap = new Map<number, string[]>();
  const links = db.prepare(`SELECT portfolio_id, account_id FROM user_portfolio_accounts`).all() as { portfolio_id: number; account_id: string }[];
  for (const link of links) {
    if (!accountMap.has(link.portfolio_id)) accountMap.set(link.portfolio_id, []);
    accountMap.get(link.portfolio_id)!.push(link.account_id);
  }

  return portfolios.map(p => ({ ...p, accountIds: accountMap.get(p.id) ?? [] }));
}

export function getUserPortfolioById(id: number): UserPortfolio | null {
  const p = db.prepare(`SELECT id, name, description, color, createdAt FROM user_portfolios WHERE id = ?`).get(id) as UserPortfolio | undefined;
  if (!p) return null;
  const accountIds = (db.prepare(`SELECT account_id FROM user_portfolio_accounts WHERE portfolio_id = ?`).all(id) as { account_id: string }[]).map(r => r.account_id);
  return { ...p, accountIds };
}

export function createUserPortfolio(name: string, description: string | null, color: string): UserPortfolio {
  const result = db.prepare(`INSERT INTO user_portfolios (name, description, color) VALUES (?, ?, ?)`).run(name, description, color);
  return getUserPortfolioById(result.lastInsertRowid as number)!;
}

export function updateUserPortfolio(id: number, name: string, description: string | null, color: string): UserPortfolio | null {
  db.prepare(`UPDATE user_portfolios SET name = ?, description = ?, color = ? WHERE id = ?`).run(name, description, color, id);
  return getUserPortfolioById(id);
}

export function deleteUserPortfolio(id: number): boolean {
  const result = db.prepare(`DELETE FROM user_portfolios WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function setUserPortfolioAccounts(portfolioId: number, accountIds: string[]): void {
  const deleteStmt = db.prepare(`DELETE FROM user_portfolio_accounts WHERE portfolio_id = ?`);
  const insertStmt = db.prepare(`INSERT OR IGNORE INTO user_portfolio_accounts (portfolio_id, account_id) VALUES (?, ?)`);

  const run = db.transaction(() => {
    deleteStmt.run(portfolioId);
    for (const aid of accountIds) {
      insertStmt.run(portfolioId, aid);
    }
  });
  run();
}

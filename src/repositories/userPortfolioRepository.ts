import { db } from "../models/database.js";

export interface UserPortfolio {
  id: number;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  accountIds?: string[];
}

// ── Prepared statements (compiled once at module load for performance) ─────────

const stmtListPortfolios = db.prepare(
  "SELECT id, name, description, color, createdAt FROM user_portfolios ORDER BY name ASC"
);

const stmtGetAllLinks = db.prepare(
  "SELECT portfolio_id, account_id FROM user_portfolio_accounts"
);

const stmtGetPortfolioById = db.prepare(
  "SELECT id, name, description, color, createdAt FROM user_portfolios WHERE id = ?"
);

const stmtGetAccountIdsForPortfolio = db.prepare(
  "SELECT account_id FROM user_portfolio_accounts WHERE portfolio_id = ?"
);

const stmtInsertPortfolio = db.prepare(
  "INSERT INTO user_portfolios (name, description, color) VALUES (?, ?, ?)"
);

const stmtUpdatePortfolio = db.prepare(
  "UPDATE user_portfolios SET name = ?, description = ?, color = ? WHERE id = ?"
);

const stmtDeletePortfolio = db.prepare(
  "DELETE FROM user_portfolios WHERE id = ?"
);

const stmtDeletePortfolioAccounts = db.prepare(
  "DELETE FROM user_portfolio_accounts WHERE portfolio_id = ?"
);

const stmtInsertPortfolioAccount = db.prepare(
  "INSERT OR IGNORE INTO user_portfolio_accounts (portfolio_id, account_id) VALUES (?, ?)"
);

// ── Public API ────────────────────────────────────────────────────────────────

export function getAllUserPortfolios(): UserPortfolio[] {
  const portfolios = stmtListPortfolios.all() as UserPortfolio[];

  const accountMap = new Map<number, string[]>();
  const links = stmtGetAllLinks.all() as { portfolio_id: number; account_id: string }[];
  for (const link of links) {
    if (!accountMap.has(link.portfolio_id)) accountMap.set(link.portfolio_id, []);
    accountMap.get(link.portfolio_id)!.push(link.account_id);
  }

  return portfolios.map(p => ({ ...p, accountIds: accountMap.get(p.id) ?? [] }));
}

export function getUserPortfolioById(id: number): UserPortfolio | null {
  const p = stmtGetPortfolioById.get(id) as UserPortfolio | undefined;
  if (!p) return null;
  const accountIds = (stmtGetAccountIdsForPortfolio.all(id) as { account_id: string }[]).map(r => r.account_id);
  return { ...p, accountIds };
}

export function createUserPortfolio(name: string, description: string | null, color: string): UserPortfolio {
  const result = stmtInsertPortfolio.run(name, description, color);
  return getUserPortfolioById(result.lastInsertRowid as number)!;
}

export function updateUserPortfolio(id: number, name: string, description: string | null, color: string): UserPortfolio | null {
  stmtUpdatePortfolio.run(name, description, color, id);
  return getUserPortfolioById(id);
}

export function deleteUserPortfolio(id: number): boolean {
  const result = stmtDeletePortfolio.run(id);
  return result.changes > 0;
}

export function setUserPortfolioAccounts(portfolioId: number, accountIds: string[]): void {
  db.transaction(() => {
    stmtDeletePortfolioAccounts.run(portfolioId);
    for (const aid of accountIds) {
      stmtInsertPortfolioAccount.run(portfolioId, aid);
    }
  })();
}

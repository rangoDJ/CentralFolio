import db from "../models/database.js";

export interface CompositePortfolioRecord {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  createdAt: string;
  memberPortfolioIds?: number[];
}

export function listCompositePortfolios(): CompositePortfolioRecord[] {
  const composites = db.prepare(
    "SELECT * FROM composite_portfolios ORDER BY id ASC"
  ).all() as CompositePortfolioRecord[];

  const memberStmt = db.prepare(
    "SELECT portfolio_id FROM composite_portfolio_members WHERE composite_id = ?"
  );

  for (const c of composites) {
    const members = memberStmt.all(c.id) as Array<{ portfolio_id: number }>;
    c.memberPortfolioIds = members.map(m => m.portfolio_id);
  }

  return composites;
}

export function createCompositePortfolio(name: string, description?: string, color = '#2563eb', memberIds: number[] = []): CompositePortfolioRecord {
  const insert = db.prepare("INSERT INTO composite_portfolios (name, description, color) VALUES (?, ?, ?)");
  const info = insert.run(name, description ?? null, color);
  const compositeId = Number(info.lastInsertRowid);

  if (memberIds.length > 0) {
    const insertMember = db.prepare(
      "INSERT OR IGNORE INTO composite_portfolio_members (composite_id, portfolio_id) VALUES (?, ?)"
    );
    const tx = db.transaction((ids: number[]) => {
      for (const id of ids) {
        insertMember.run(compositeId, id);
      }
    });
    tx(memberIds);
  }

  return {
    id: compositeId,
    name,
    description: description ?? null,
    color,
    createdAt: new Date().toISOString(),
    memberPortfolioIds: memberIds
  };
}

export function deleteCompositePortfolio(id: number): boolean {
  const res = db.prepare("DELETE FROM composite_portfolios WHERE id = ?").run(id);
  return res.changes > 0;
}

import db from "../models/database.js";

export interface CorporateActionRecord {
  id: number;
  symbol: string;
  eventType: 'split' | 'reverse_split' | 'spinoff' | 'merger' | 'ticker_change';
  ratio: number;
  date: string;
  spinoffSymbol?: string | null;
  notes?: string | null;
  createdAt: string;
}

export function listCorporateActions(symbol?: string): CorporateActionRecord[] {
  if (symbol) {
    return db.prepare(
      "SELECT * FROM corporate_actions WHERE symbol = ? ORDER BY date DESC, id DESC"
    ).all(symbol.toUpperCase()) as CorporateActionRecord[];
  }
  return db.prepare(
    "SELECT * FROM corporate_actions ORDER BY date DESC, id DESC"
  ).all() as CorporateActionRecord[];
}

export function getCorporateActionsForSymbols(symbols: string[]): CorporateActionRecord[] {
  if (!symbols || symbols.length === 0) return [];
  const placeholders = symbols.map(() => "?").join(",");
  return db.prepare(
    `SELECT * FROM corporate_actions WHERE symbol IN (${placeholders}) ORDER BY date ASC`
  ).all(...symbols.map(s => s.toUpperCase())) as CorporateActionRecord[];
}

export function createCorporateAction(data: {
  symbol: string;
  eventType: 'split' | 'reverse_split' | 'spinoff' | 'merger' | 'ticker_change';
  ratio: number;
  date: string;
  spinoffSymbol?: string | null;
  notes?: string | null;
}): CorporateActionRecord {
  const stmt = db.prepare(`
    INSERT INTO corporate_actions (symbol, eventType, ratio, date, spinoffSymbol, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    data.symbol.toUpperCase(),
    data.eventType,
    data.ratio,
    data.date,
    data.spinoffSymbol ? data.spinoffSymbol.toUpperCase() : null,
    data.notes ?? null
  );
  return db.prepare("SELECT * FROM corporate_actions WHERE id = ?").get(info.lastInsertRowid) as CorporateActionRecord;
}

export function deleteCorporateAction(id: number): boolean {
  const res = db.prepare("DELETE FROM corporate_actions WHERE id = ?").run(id);
  return res.changes > 0;
}

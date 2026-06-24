import { db } from "../models/database.js";

export interface StockRating {
  symbol: string;
  score: number;         // 1–5 (1 = Strong Buy, 5 = Risky)
  label: string;         // Strong Buy / Buy / Hold / Caution / Risky
  sentiment: string;     // positive / neutral / negative
  summary: string;
  keyRisks: string[];
  confidence: string;    // high / medium / low
  analyzedAt?: string;
}

const stmtGet    = db.prepare(`SELECT * FROM stock_ratings WHERE symbol = ?`);
const stmtGetAll = db.prepare(`SELECT * FROM stock_ratings ORDER BY symbol`);
const stmtUpsert = db.prepare(`
  INSERT INTO stock_ratings (symbol, score, label, sentiment, summary, keyRisks, confidence, analyzedAt)
  VALUES (@symbol, @score, @label, @sentiment, @summary, @keyRisks, @confidence, CURRENT_TIMESTAMP)
  ON CONFLICT(symbol) DO UPDATE SET
    score      = excluded.score,
    label      = excluded.label,
    sentiment  = excluded.sentiment,
    summary    = excluded.summary,
    keyRisks   = excluded.keyRisks,
    confidence = excluded.confidence,
    analyzedAt = CURRENT_TIMESTAMP
`);
const stmtDelete = db.prepare(`DELETE FROM stock_ratings WHERE symbol = ?`);

function deserialize(row: any): StockRating {
  return {
    ...row,
    keyRisks: (() => { try { return JSON.parse(row.keyRisks || '[]'); } catch { return []; } })(),
  };
}

export function getRating(symbol: string): StockRating | null {
  const row = stmtGet.get(symbol);
  return row ? deserialize(row) : null;
}

export function getAllRatings(): StockRating[] {
  return (stmtGetAll.all() as any[]).map(deserialize);
}

export function upsertRating(r: StockRating): void {
  stmtUpsert.run({
    symbol:    r.symbol,
    score:     r.score,
    label:     r.label,
    sentiment: r.sentiment,
    summary:   r.summary,
    keyRisks:  JSON.stringify(r.keyRisks ?? []),
    confidence: r.confidence,
  });
}

export function deleteRating(symbol: string): void {
  stmtDelete.run(symbol);
}

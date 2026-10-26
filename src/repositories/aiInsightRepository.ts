import { db } from "../models/database.js";

export interface AiInsightRecord {
  symbol: string;
  markdown: string;
  summary: string;
  score: number;       // 1 (Strong Buy) - 5 (Risky)
  label: string;       // Strong Buy / Buy / Hold / Caution / Risky
  provider: string;    // 'gemini' | 'anthropic' | 'openai' | 'rule_engine'
  analyzedAt?: string;
}

const stmtGet = db.prepare(`SELECT * FROM ai_insights WHERE symbol = ?`);
const stmtUpsert = db.prepare(`
  INSERT INTO ai_insights (symbol, markdown, summary, score, label, provider, analyzedAt)
  VALUES (@symbol, @markdown, @summary, @score, @label, @provider, CURRENT_TIMESTAMP)
  ON CONFLICT(symbol) DO UPDATE SET
    markdown   = excluded.markdown,
    summary    = excluded.summary,
    score      = excluded.score,
    label      = excluded.label,
    provider   = excluded.provider,
    analyzedAt = CURRENT_TIMESTAMP
`);
const stmtDelete = db.prepare(`DELETE FROM ai_insights WHERE symbol = ?`);

export function getAiInsight(symbol: string): AiInsightRecord | null {
  const row = stmtGet.get(symbol.toUpperCase().trim()) as any;
  if (!row) return null;
  return {
    symbol: row.symbol,
    markdown: row.markdown,
    summary: row.summary || "",
    score: row.score,
    label: row.label,
    provider: row.provider,
    analyzedAt: row.analyzedAt,
  };
}

export function upsertAiInsight(insight: AiInsightRecord): void {
  stmtUpsert.run({
    symbol: insight.symbol.toUpperCase().trim(),
    markdown: insight.markdown,
    summary: insight.summary || "",
    score: insight.score,
    label: insight.label,
    provider: insight.provider || "rule_engine",
  });
}

export function deleteAiInsight(symbol: string): void {
  stmtDelete.run(symbol.toUpperCase().trim());
}

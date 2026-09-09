import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";
import { emitDataChanged } from "../services/eventBus.js";

// ── Prepared statements (compiled once at module load for performance) ─────────

const stmtGetMetadata = db.prepare(
  "SELECT * FROM dividend_metadata WHERE symbol = ?"
);

const stmtUpsertMetadata = db.prepare(`
  INSERT OR REPLACE INTO dividend_metadata (symbol, frequency, lastExDate, payDate, amountPerShare, name, provider, currency, cachedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

// Newest write across the whole table, as epoch ms. The assembled forecast is
// cached in memory for a week; without this it kept serving dates from before
// the last Snowball pull.
const stmtMaxCachedAt = db.prepare(
  "SELECT MAX(cachedAt) AS maxCachedAt FROM dividend_metadata"
);

const stmtGetAllMetadata = db.prepare(
  "SELECT * FROM dividend_metadata ORDER BY cachedAt DESC"
);

const stmtDeleteMetadata = db.prepare(
  "DELETE FROM dividend_metadata WHERE symbol = ?"
);

const stmtClearMetadata = db.prepare(
  "DELETE FROM dividend_metadata"
);

// ── Public API ────────────────────────────────────────────────────────────────

import { getSetting, setSetting } from "./settingsRepository.js";

export function getCachedDividendMetadata(symbol: string): any | null {
  const row = stmtGetMetadata.get(symbol) || null;
  logger.debug('DB', `getCachedDividendMetadata(${symbol}) → ${row ? 'HIT' : 'MISS'}`);
  return row;
}

export function saveCachedDividendMetadata(symbol: string, data: any, provider?: string) {
  logger.debug('DB', `saveCachedDividendMetadata(${symbol}) provider=${provider} frequency=${data.frequency} amount=${data.amountPerShare}`);
  stmtUpsertMetadata.run(
    symbol,
    data.frequency       ?? null,
    data.lastExDate      ?? null,
    data.payDate         ?? null,
    data.amountPerShare  ?? null,
    data.name            ?? null,
    provider             ?? null,
    data.currency        ?? null
  );
  emitDataChanged('dividends');
}

/** Epoch ms of the most recent metadata write, or 0 when the table is empty. */
export function getDividendMetadataMaxCachedAt(): number {
  const row = stmtMaxCachedAt.get() as { maxCachedAt: string | null } | undefined;
  if (!row?.maxCachedAt) return 0;
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC, with no zone marker.
  const ms = new Date(row.maxCachedAt.replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function getAllCachedDividendMetadata(): any[] {
  return stmtGetAllMetadata.all();
}

export function deleteCachedDividendMetadata(symbol: string): boolean {
  const result = stmtDeleteMetadata.run(symbol);
  if (result.changes > 0) emitDataChanged('dividends');
  return result.changes > 0;
}

export function clearDividendMetadataCache() {
  stmtClearMetadata.run();
}

export function getDividendProviders(): Record<string, any> {
  const raw = getSetting("dividend_providers");
  const allDisabled = { yahoo: false, tiingo: false, eodhd: false, polygon: false, alphavantage: false, finnhub: false };
  if (!raw) return allDisabled;
  try {
    return { ...allDisabled, ...JSON.parse(raw) };
  } catch {
    return allDisabled;
  }
}

export function setDividendProviders(providers: Record<string, boolean>) {
  setSetting("dividend_providers", JSON.stringify(providers));
}

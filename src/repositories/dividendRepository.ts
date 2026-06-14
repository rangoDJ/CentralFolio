import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

// ── Prepared statements (compiled once at module load for performance) ─────────

const stmtGetMetadata = db.prepare(
  "SELECT * FROM dividend_metadata WHERE symbol = ?"
);

const stmtUpsertMetadata = db.prepare(`
  INSERT OR REPLACE INTO dividend_metadata (symbol, frequency, lastExDate, amountPerShare, name, provider, cachedAt)
  VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

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
    data.amountPerShare  ?? null,
    data.name            ?? null,
    provider             ?? null
  );
}

export function getAllCachedDividendMetadata(): any[] {
  return stmtGetAllMetadata.all();
}

export function deleteCachedDividendMetadata(symbol: string): boolean {
  const result = stmtDeleteMetadata.run(symbol);
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

import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";
import { getSetting, setSetting } from "./settingsRepository.js";

export function getCachedDividendMetadata(symbol: string): any | null {
  const row = db.prepare("SELECT * FROM dividend_metadata WHERE symbol = ?").get(symbol) || null;
  logger.debug('DB', `getCachedDividendMetadata(${symbol}) → ${row ? 'HIT' : 'MISS'}`);
  return row;
}

export function saveCachedDividendMetadata(symbol: string, data: any) {
  logger.debug('DB', `saveCachedDividendMetadata(${symbol}) frequency=${data.frequency} amount=${data.amountPerShare}`);
  db.prepare(`
    INSERT OR REPLACE INTO dividend_metadata (symbol, frequency, lastExDate, amountPerShare, name, cachedAt)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    symbol,
    data.frequency ?? null,
    data.lastExDate ?? null,
    data.amountPerShare ?? null,
    data.name ?? null
  );
}

export function clearDividendMetadataCache() {
  db.prepare("DELETE FROM dividend_metadata").run();
}

export function getDividendProviders(): Record<string, any> {
  const raw = getSetting("dividend_providers");
  if (!raw) return { yahoo: true, tiingo: false, polygon: false, alphavantage: false, finnhub: false };
  try {
    return JSON.parse(raw);
  } catch {
    return { yahoo: true, tiingo: false, polygon: false, alphavantage: false, finnhub: false };
  }
}

export function setDividendProviders(providers: Record<string, boolean>) {
  setSetting("dividend_providers", JSON.stringify(providers));
}

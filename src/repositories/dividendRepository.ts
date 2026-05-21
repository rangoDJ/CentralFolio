import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";
import { getSetting, setSetting } from "./settingsRepository.js";

export function getCachedDividendMetadata(symbol: string): any | null {
  const row = db.prepare("SELECT * FROM dividend_metadata WHERE symbol = ?").get(symbol) || null;
  logger.debug('DB', `getCachedDividendMetadata(${symbol}) → ${row ? 'HIT' : 'MISS'}`);
  return row;
}

export function saveCachedDividendMetadata(symbol: string, data: any, provider?: string) {
  logger.debug('DB', `saveCachedDividendMetadata(${symbol}) provider=${provider} frequency=${data.frequency} amount=${data.amountPerShare}`);
  db.prepare(`
    INSERT OR REPLACE INTO dividend_metadata (symbol, frequency, lastExDate, amountPerShare, name, provider, cachedAt)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    symbol,
    data.frequency ?? null,
    data.lastExDate ?? null,
    data.amountPerShare ?? null,
    data.name ?? null,
    provider ?? null
  );
}

export function getAllCachedDividendMetadata(): any[] {
  return db.prepare("SELECT * FROM dividend_metadata ORDER BY cachedAt DESC").all();
}

export function clearDividendMetadataCache() {
  db.prepare("DELETE FROM dividend_metadata").run();
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

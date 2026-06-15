import { Portfolio, listPortfolios, getCachedPositions, saveCachedPositions, getCachedAccounts, saveCachedAccounts, getCachedDividendMetadata, saveCachedDividendMetadata, getSetting, setSetting, getActiveAccountIds, clearDividendMetadataCache, getAccountFetchTimestamps } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "./snaptrade.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { SNAPTRADE_CACHE_TTL_MS } from "../utils/constants.js";
import { emitDataChanged } from "./eventBus.js";

// In-memory cache for dividend metadata (24h TTL)
const divMetadataCache = new Map<string, { 
  frequency: number, 
  lastExDate: string, 
  amountPerShare: number, 
  name: string,
  timestamp: number 
}>();

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — dividend schedules rarely change

// Cap the in-memory metadata cache so a long-running process can't grow it without bound.
// SQLite remains the source of truth, so evicting a memory entry only costs a DB lookup.
const DIV_CACHE_MAX_ENTRIES = 2000;
type DivCacheEntry = { frequency: number; lastExDate: string | null; amountPerShare: number; name: string; timestamp: number };

function setDivCache(symbol: string, data: DivCacheEntry) {
  // Refresh insertion order (Map iterates oldest-first) so eviction approximates LRU.
  divMetadataCache.delete(symbol);
  divMetadataCache.set(symbol, data);
  while (divMetadataCache.size > DIV_CACHE_MAX_ENTRIES) {
    const oldest = divMetadataCache.keys().next().value;
    if (oldest === undefined) break;
    divMetadataCache.delete(oldest);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

export interface DividendEvent {
  symbol: string;
  date: string;
  amount: number;
  amountPerShare: number;
  units: number;
  frequency: number;
  name: string;
  portfolioName?: string;
  accountName?: string;
  accountId?: string;
}

function getSnowballUrls(symbol: string): string[] {
  let mapped = symbol.toUpperCase().trim();
  const dotIndex = mapped.lastIndexOf('.');
  if (dotIndex !== -1) {
    let ticker = mapped.slice(0, dotIndex);
    const exchange = mapped.slice(dotIndex + 1);
    ticker = ticker.replace(/\./g, '-');

    // Snowball now uses native exchange codes (e.g. .TO for the TSX) rather than
    // its older remapped codes (.CA / .V / .NEO). Probe the native suffix first,
    // then fall back to the legacy remapped suffix for backward compatibility.
    const legacyExchange =
      exchange === 'TO' ? 'CA' :
      exchange === 'VN' ? 'V' :
      exchange === 'NE' ? 'NEO' :
      exchange;

    const bases = legacyExchange === exchange
      ? [`${ticker}.${exchange}`]
      : [`${ticker}.${exchange}`, `${ticker}.${legacyExchange}`];

    return bases.flatMap((base) => [
      `https://snowball-analytics.com/public/asset/${base}`,
      `https://snowball-analytics.com/public/asset/${base}.CAD`,
    ]);
  } else {
    return [
      `https://snowball-analytics.com/public/asset/${mapped}.US`,
      `https://snowball-analytics.com/public/asset/${mapped}.US.USD`,
    ];
  }
}

const SNOWBALL_INTERVAL_MS = 20_000; // 20s (max 3 req/min)
let lastSnowballRequestTime = 0;

async function rateLimitSnowball() {
  const elapsed = Date.now() - lastSnowballRequestTime;
  if (elapsed < SNOWBALL_INTERVAL_MS) {
    const delay = SNOWBALL_INTERVAL_MS - elapsed;
    logger.info('Snowball', `Rate limiting: sleeping for ${(delay / 1000).toFixed(1)}s...`);
    await sleep(delay);
  }
  lastSnowballRequestTime = Date.now();
}

// Fetch and return the raw Snowball `asset` JSON object for a symbol, or null.
// `applyRateLimit` gates the background dividend job (3 req/min); user-initiated
// lookups (the stock detail page) pass false to stay responsive.
async function fetchSnowballAsset(symbol: string, applyRateLimit = true): Promise<any | null> {
  if (applyRateLimit) await rateLimitSnowball();
  const urls = getSnowballUrls(symbol);
  for (const url of urls) {
    try {
      logger.info('Snowball', `Fetching ${symbol} from ${url}...`);

      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      if (!res.ok) {
        logger.debug('Snowball', `${symbol} -> HTTP ${res.status} on ${url}`);
        continue;
      }
      const html = await res.text();
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
      if (!nextDataMatch) {
        logger.debug('Snowball', `${symbol} -> __NEXT_DATA__ tag not found on ${url}`);
        continue;
      }
      const parsed = JSON.parse(nextDataMatch[1]);
      const asset = parsed.props?.pageProps?.asset;
      if (!asset) {
        logger.debug('Snowball', `${symbol} -> asset details not found in JSON on ${url}`);
        continue;
      }
      return asset;
    } catch (err: any) {
      logger.warn('Snowball', `Error fetching ${symbol} from ${url}: ${err.message}`);
    }
  }
  return null;
}

async function fetchFromSnowball(symbol: string): Promise<any> {
  const asset = await fetchSnowballAsset(symbol, true);
  if (!asset) return null;

  const frequency = asset.divFrequency ?? 0;
  const annualPayout = asset.divPerYearFWD ?? 0;
  const amountPerShare = (frequency > 0 && annualPayout > 0) ? (annualPayout / frequency) : 0;
  const lastExDate = asset.exDividendDate ? asset.exDividendDate.split("T")[0] : null;

  logger.info('Snowball', `${symbol} -> found dividend data (annualPayout=${annualPayout}, freq=${frequency}, lastEx=${lastExDate})`);
  return {
    frequency,
    lastExDate,
    amountPerShare,
    name: asset.description || asset.name || symbol,
    timestamp: Date.now(),
  };
}

// Exported so controllers can trigger a manual Snowball lookup for a specific symbol
export async function lookupDividendWithAI(symbol: string): Promise<any> {
  return fetchFromSnowball(symbol);
}

// ── Stock detail (Snowball-style asset page) ────────────────────────────────
export interface StockDetail {
  symbol: string;
  name: string;
  ticker: string | null;
  exchange: string | null;
  currency: string | null;
  price: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  dividendYield: number | null;
  annualPayout: number | null;
  exDividendDate: string | null;
  nextDividendDate: string | null;
  frequency: number | null;
  growthStreak: number | null;
  growth5Y: number | null;
  sector: string | null;
  logoURL: string | null;
  description: string | null;
}

const STOCK_DETAIL_TTL_MS = 15 * 60 * 1000;
const stockDetailCache = new Map<string, { data: StockDetail, ts: number }>();

function mapAssetToStockDetail(symbol: string, asset: any): StockDetail {
  const dateOnly = (s: any) => (typeof s === 'string' && s) ? s.split('T')[0] : null;
  return {
    symbol,
    name: asset.description || asset.name || symbol,
    ticker: asset.ticker ?? null,
    exchange: asset.exchange ?? null,
    currency: asset.divCurrency || asset.currency || null,
    price: asset.currentPrice ?? null,
    dayChange: asset.lastDayGainsAmount ?? null,
    dayChangePct: asset.lastDayGainsPercent ?? null,
    dividendYield: asset.divYieldFWD ?? null,
    annualPayout: asset.divPerYearFWD ?? null,
    exDividendDate: dateOnly(asset.exDividendDate),
    nextDividendDate: dateOnly(asset.nextDividendDate),
    frequency: asset.divFrequency ?? null,
    growthStreak: asset.divGrowthStreak ?? asset.divStreak ?? null,
    growth5Y: asset.divGrowth5Y ?? null,
    sector: asset.sector ?? null,
    logoURL: asset.primaryLogoURL || asset.logoURL || null,
    description: asset.companyDescription || null,
  };
}

// Rich asset detail for the stock detail page. Cached ~15 min; user-initiated
// so it skips the background rate-limiter to keep the click responsive.
export async function getStockDetail(symbol: string): Promise<StockDetail | null> {
  const key = symbol.toUpperCase().trim();
  const cached = stockDetailCache.get(key);
  if (cached && Date.now() - cached.ts < STOCK_DETAIL_TTL_MS) {
    logger.debug('Snowball', `getStockDetail(${key}) → cache HIT`);
    return cached.data;
  }
  const asset = await fetchSnowballAsset(key, false);
  if (!asset) return null;
  const detail = mapAssetToStockDetail(key, asset);
  stockDetailCache.set(key, { data: detail, ts: Date.now() });
  return detail;
}

/**
 * Helper to fetch dividend metadata with cache-only non-blocking option
 */
export async function fetchDividendMetadata(symbol: string, allowExternalFetch: boolean = true): Promise<any> {
  const now = Date.now();

  // 1. Check in-memory Cache
  if (divMetadataCache.has(symbol)) {
    const cached = divMetadataCache.get(symbol)!;
    const isPlaceholder = cached.name === 'No Dividend Data' || cached.frequency === 0;
    const currentTtl = isPlaceholder ? 24 * 60 * 60 * 1000 : CACHE_TTL_MS;
    if (now - cached.timestamp < currentTtl) {
      logger.debug('Cache', `fetchDividendMetadata(${symbol}) → memory HIT`);
      return cached;
    }
  }

  // 2. Check DB Cache
  const dbCached = getCachedDividendMetadata(symbol);
  if (dbCached) {
    // SQLite CURRENT_TIMESTAMP is UTC. Convert it to standard ISO-8601 UTC timestamp and parse.
    const cachedAt = new Date(dbCached.cachedAt.replace(' ', 'T') + 'Z').getTime();
    const isPlaceholder = dbCached.name === 'No Dividend Data' || dbCached.frequency === 0;
    const currentTtl = isPlaceholder ? 24 * 60 * 60 * 1000 : CACHE_TTL_MS;
    
    // Hard Rule: If pulled in the last 24 hours, skip pulling and return cached data
    if (now - cachedAt < 24 * 60 * 60 * 1000) {
      logger.info('Cache', `fetchDividendMetadata(${symbol}) → DB HIT (skip pulling: pulled within last 24h at ${dbCached.cachedAt} UTC)`);
      const data = {
        frequency: dbCached.frequency,
        lastExDate: dbCached.lastExDate,
        amountPerShare: dbCached.amountPerShare,
        name: dbCached.name,
        timestamp: cachedAt
      };
      setDivCache(symbol, data);
      return data;
    }

    // If within calculated TTL, or if we are in cache-only mode (external fetch disabled), return cached data
    if (now - cachedAt < currentTtl || !allowExternalFetch) {
      logger.debug('Cache', `fetchDividendMetadata(${symbol}) → DB HIT (allowExternalFetch=${allowExternalFetch})`);
      const data = {
        frequency: dbCached.frequency,
        lastExDate: dbCached.lastExDate,
        amountPerShare: dbCached.amountPerShare,
        name: dbCached.name,
        timestamp: cachedAt
      };
      setDivCache(symbol, data);
      return data;
    }
  }

  // If external fetch is not allowed, return null immediately (keeps WebUI snappy)
  if (!allowExternalFetch) {
    logger.debug('Dividend', `fetchDividendMetadata(${symbol}) → Cache MISS (external fetch disabled)`);
    return null;
  }

  // 3. Fetch from Snowball
  const data = await fetchFromSnowball(symbol);
  if (data) {
    setDivCache(symbol, data);
    saveCachedDividendMetadata(symbol, data, 'snowball');
    logger.info('Dividend', `${symbol} → saved to cache via snowball`);
    return data;
  } else {
    // Save a placeholder in the DB cache to indicate that we checked this symbol and no dividend data was found.
    // This prevents re-pulling from Snowball for at least 24 hours.
    const placeholder = {
      frequency: 0,
      lastExDate: null,
      amountPerShare: 0,
      name: 'No Dividend Data',
      timestamp: Date.now()
    };
    setDivCache(symbol, placeholder);
    saveCachedDividendMetadata(symbol, placeholder, 'snowball');
    logger.info('Dividend', `${symbol} → saved 'No Dividend Data' placeholder to cache to avoid re-pulling for 24h`);
    return null;
  }
}


function advanceDate(date: Date, frequency: number): Date {
  const newDate = new Date(date.getTime());
  if (frequency === 1 || frequency === 2 || frequency === 4 || frequency === 6 || frequency === 12) {
    const monthsToAdd = 12 / frequency;
    newDate.setUTCMonth(newDate.getUTCMonth() + monthsToAdd);
  } else {
    // Fallback to days for weekly (52), bi-weekly (26), semi-monthly (24) or others
    const daysToAdd = Math.round(365.25 / frequency);
    newDate.setUTCDate(newDate.getUTCDate() + daysToAdd);
  }
  return newDate;
}

export async function getDividendForecastForAccount(
  portfolio: Portfolio,
  accountId: string,
  forceRefresh: boolean = false,
  allowExternalFetch: boolean = true
): Promise<DividendEvent[]> {
  if (!portfolio.userSecret) throw new Error(`Portfolio "${portfolio.name}" is not registered with SnapTrade`);
  logger.info('Forecast', `getDividendForecastForAccount — portfolio="${portfolio.name}" account=${accountId} forceRefresh=${forceRefresh} allowExternalFetch=${allowExternalFetch}`);

  try {
    let positions: any[] = [];

    const cached = getCachedPositions(accountId);
    const timestamps = getAccountFetchTimestamps(accountId);
    const lastFetch = timestamps?.lastPositionsFetch;
    const lastFetchTime = lastFetch ? new Date(lastFetch.replace(' ', 'T') + 'Z').getTime() : 0;
    const isFresh = lastFetchTime > 0 && (Date.now() - lastFetchTime < SNAPTRADE_CACHE_TTL_MS);

    if (isFresh || !allowExternalFetch) {
      logger.info('Cache', `getDividendForecastForAccount — positions cache HIT (or loading from database only) for account ${accountId} (${cached.length} position(s))`);
      positions = cached.map(p => ({
        symbol: { symbol: { symbol: p.symbol }, description: p.description },
        units: p.units
      }));
    } else {
      logger.info('SnapTrade', `getDividendForecastForAccount — fetching fresh positions for account ${accountId}...`);
      const client = getSnapTradeClientForPortfolio(portfolio);
      const positionsResponse = await client.accountInformation.getUserAccountPositions({
        userId: portfolio.userId,
        userSecret: portfolio.userSecret!,
        accountId: accountId,
      });
      positions = positionsResponse.data;
      const posCount = Array.isArray(positions) ? positions.length : 0;
      logger.info('SnapTrade', `getDividendForecastForAccount — received ${posCount} position(s), saving to cache`);
      saveCachedPositions(accountId, positions);
    }

    const forecast: DividendEvent[] = [];
    const now = new Date();
    const validPositions = positions.filter(p => {
      const sym = (p.symbol as any)?.symbol?.symbol;
      const units = p.units || 0;
      return sym && units > 0;
    });

    logger.info('Forecast', `Processing ${validPositions.length} valid position(s) for account ${accountId}...`);

    let positionIdx = 0;
    for (const position of validPositions) {
      positionIdx++;
      const symbolInfo = (position.symbol as any)?.symbol;
      const symbol = symbolInfo?.symbol;
      const units = position.units || 0;

      try {
        const idx = positionIdx;
        const total = validPositions.length;
        logger.info('Forecast', `  [${idx}/${total}] Processing ${symbol} (${units} units)...`);

        const METADATA_TIMEOUT_MS = 45000; // 45 second overall timeout per symbol
        let metadata;
        try {
          metadata = await withTimeout(
            fetchDividendMetadata(symbol, allowExternalFetch),
            METADATA_TIMEOUT_MS,
            `fetchDividendMetadata(${symbol})`
          );
        } catch (timeoutErr: any) {
          logger.warn('Forecast', `  ${symbol} — TIMEOUT after ${METADATA_TIMEOUT_MS}ms: ${timeoutErr.message}`);
          continue;
        }

        if (!metadata) {
          logger.warn('Forecast', `  ${symbol} — no dividend data available`);
          continue;
        }

        const { frequency, lastExDate, amountPerShare, name } = metadata;
        logger.info('Forecast', `  ${symbol} — metadata: freq=${frequency}, lastEx=${lastExDate}, amount=${amountPerShare}`);

        // Validate metadata
        if (!frequency || frequency <= 0 || !lastExDate || amountPerShare < 0) {
          logger.warn('Forecast', `  ${symbol} — invalid metadata (freq=${frequency}, lastEx=${lastExDate}), skipping`);
          continue;
        }

        let currentProjDate = new Date(lastExDate);
        logger.info('Forecast', `  ${symbol} — starting projection from ${currentProjDate.toISOString()}`);

        let loopCount = 0;
        while (currentProjDate < now && loopCount < 100) {
          currentProjDate = advanceDate(currentProjDate, frequency);
          loopCount++;
        }
        if (loopCount >= 100) {
          logger.warn('Forecast', `  ${symbol} — hit 100-iteration safety cap; lastExDate=${lastExDate} may be stale`);
        }
        logger.info('Forecast', `  ${symbol} — caught up to present in ${loopCount} iterations`);

        for (let i = 0; i < frequency; i++) {
          forecast.push({
            symbol,
            date: currentProjDate.toISOString(),
            amount: amountPerShare * units,
            amountPerShare,
            frequency,
            units,
            name
          });
          currentProjDate = advanceDate(currentProjDate, frequency);
        }
        logger.info('Forecast', `  ${symbol} → added ${frequency} projected event(s)`);
      } catch (err) {
        logger.warn('Forecast', `  ${symbol} — error: ${(err as any).message}`);
      }
    }

    const sorted = forecast.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    logger.info('Forecast', `getDividendForecastForAccount complete — account ${accountId}: ${sorted.length} event(s) projected`);
    return sorted;
  } catch (err: any) {
    logger.error('DividendSvc', `getDividendForecastForAccount failed — account ${accountId}: ${err.message}`);
    throw err;
  }
}

let cachedAllDividends: any[] = [];
let cachedDividendsTime: number = 0;
const CACHE_DIVIDENDS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function getAllDividendsForAllPortfolios(
  forceRefresh: boolean = false,
  allowExternalFetch: boolean = true
): Promise<any[]> {
  if (!forceRefresh) {
    const mem = getCachedAllDividends();
    if (mem) {
      logger.debug('Cache', 'getAllDividendsForAllPortfolios — returning in-memory cached dividends');
      return mem;
    }
  }

  const portfolios = listPortfolios();
  const results = [];

  // Fetch active account IDs once — accounts toggled off in the UI are excluded from dividend forecasting
  const activeAccountIds = getActiveAccountIds();
  logger.info('DividendSvc', `getAllDividendsForAllPortfolios — ${activeAccountIds.size} active account(s) across ${portfolios.length} portfolio(s)`);
  if (activeAccountIds.size === 0) {
    logger.warn('DividendSvc', 'No active accounts found — all accounts may be toggled off. Returning empty results.');
    return [];
  }

  for (const portfolio of portfolios) {
    if (!portfolio.userSecret) {
      logger.warn('DividendSvc', `  "${portfolio.name}" — not registered (no userSecret), skipping`);
      continue;
    }

    logger.info('DividendSvc', `  Processing portfolio "${portfolio.name}"...`);
    try {
      let accounts: any[] = [];
      const cached = getCachedAccounts(portfolio.id!);
      const isFresh = cached.length > 0 && (Date.now() - new Date(cached[0].cachedAt).getTime() < SNAPTRADE_CACHE_TTL_MS);

      if (isFresh || !allowExternalFetch) {
        logger.info('Cache', `  "${portfolio.name}" — accounts cache HIT (or loading from database only) (${cached.length} account(s))`);
        accounts = cached;
      } else {
        logger.info('SnapTrade', `  "${portfolio.name}" — accounts cache MISS, fetching from SnapTrade...`);
        const client = getSnapTradeClientForPortfolio(portfolio);
        const accountsResponse = await client.accountInformation.listUserAccounts({
          userId: portfolio.userId,
          userSecret: portfolio.userSecret,
        });
        accounts = accountsResponse.data;
        const accCount = Array.isArray(accounts) ? accounts.length : 0;
        logger.info('SnapTrade', `  "${portfolio.name}" — received ${accCount} account(s), saving to cache`);
        saveCachedAccounts(portfolio.id!, accounts);
      }

      const activeAccounts = accounts.filter(acc => activeAccountIds.has(acc.id));
      const skipped = accounts.length - activeAccounts.length;

      logger.info('DividendSvc', `  "${portfolio.name}" — ${activeAccounts.length} active account(s) of ${accounts.length} total (${skipped} inactive, skipped)`);

      for (const acc of activeAccounts) {
        logger.info('DividendSvc', `    Account: "${acc.name ?? acc.id}" (${acc.id})`);
        try {
          const dividends = await getDividendForecastForAccount(portfolio, acc.id, forceRefresh, allowExternalFetch);
          logger.info('DividendSvc', `    → ${dividends.length} projected dividend event(s)`);
          results.push({
            portfolioName: portfolio.name,
            accountName: acc.customName || acc.name,
            accountId: acc.id,
            dividends: dividends
          });
        } catch (err: any) {
          logger.warn('DividendSvc', `    → forecast failed for "${acc.customName || acc.name}": ${err.message}`);
          results.push({
            portfolioName: portfolio.name,
            accountName: acc.customName || acc.name,
            accountId: acc.id,
            error: err.message,
            dividends: []
          });
        }
      }
    } catch (err: any) {
      logger.error('DividendSvc', `  Failed to fetch accounts for portfolio "${portfolio.name}": ${err.message}`);
    }
  }

  const totalEvents = results.reduce((s, r) => s + (r.dividends?.length ?? 0), 0);
  logger.info('DividendSvc', `getAllDividendsForAllPortfolios complete — ${results.length} account(s), ${totalEvents} total event(s)`);
  
  cachedAllDividends = results;
  cachedDividendsTime = Date.now();
  emitDataChanged('dividends');
  return results;
}

export async function getAllDividendsFromCacheOnly(): Promise<any[]> {
  return getAllDividendsForAllPortfolios(false, false);
}

export function getCachedAllDividends(): any[] | null {
  const now = Date.now();
  if (cachedAllDividends.length > 0 && (now - cachedDividendsTime < CACHE_DIVIDENDS_TTL_MS)) {
    logger.debug('Cache', 'getCachedAllDividends → cache HIT');
    return cachedAllDividends;
  }
  logger.debug('Cache', 'getCachedAllDividends → cache MISS or expired');
  return null;
}

export function clearDividendMemoryCache() {
  divMetadataCache.clear();
  cachedAllDividends = [];
  cachedDividendsTime = 0;
  logger.info('Cache', 'clearDividendMemoryCache() — in-memory dividend caches cleared');
}

export function clearAllDividendCaches() {
  clearDividendMemoryCache();
  clearDividendMetadataCache();
  logger.info('Cache', 'clearAllDividendCaches() — memory + DB dividend caches cleared');
}

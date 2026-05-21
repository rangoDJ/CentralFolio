import { Portfolio, listPortfolios, getCachedPositions, saveCachedPositions, getCachedAccounts, saveCachedAccounts, getCachedDividendMetadata, saveCachedDividendMetadata, getSetting, setSetting, getActiveAccountIds, getDividendProviders, clearDividendMetadataCache } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "./snaptrade.js";
import { logger } from "../utils/logger.js";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

// Per-provider rate limiting — Yahoo needs a much larger gap
const lastRequestTime: Record<string, number> = {};
const PROVIDER_INTERVAL_MS: Record<string, number> = {
  yahoo:        1500,
  tiingo:        300,
  eodhd:        3500, // 20 req/min → one every 3s, using 3.5s to be safe
  polygon:       300,
  alphavantage:  300,
  finnhub:       300,
};

async function rateLimit(provider: string) {
  const interval = PROVIDER_INTERVAL_MS[provider] ?? 300;
  const elapsed = Date.now() - (lastRequestTime[provider] ?? 0);
  if (elapsed < interval) await sleep(interval - elapsed);
  lastRequestTime[provider] = Date.now();
}

// In-memory cache for dividend metadata (24h TTL)
const divMetadataCache = new Map<string, { 
  frequency: number, 
  lastExDate: string, 
  amountPerShare: number, 
  name: string,
  timestamp: number 
}>();

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — dividend schedules rarely change

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

/**
 * Infer dividend frequency from the average gap between historical ex-dates.
 * Expects records sorted descending by ex_dividend_date.
 */
function inferFrequencyFromHistory(records: { ex_dividend_date: string }[]): number {
  if (records.length < 2) return 4;
  const dates = records
    .map(r => new Date(r.ex_dividend_date).getTime())
    .filter(t => !isNaN(t))
    .sort((a, b) => b - a);
  if (dates.length < 2) return 4;
  const gaps: number[] = [];
  for (let i = 0; i < Math.min(dates.length - 1, 6); i++) {
    gaps.push(dates[i] - dates[i + 1]);
  }
  const avgDays = gaps.reduce((s, g) => s + g, 0) / gaps.length / (1000 * 60 * 60 * 24);
  if (avgDays <= 45)       return 12; // monthly
  if (avgDays <= 120)      return 4;  // quarterly
  if (avgDays <= 240)      return 2;  // semi-annual
  return 1;                           // annual
}

async function fetchFromYahooFinance(symbol: string): Promise<any> {
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    logger.info('YahooFinance', `Fetching dividend data for ${symbol}${attempt > 1 ? ` (attempt ${attempt})` : ''}...`);
    await rateLimit('yahoo');

    const quote = await yahooFinance.quote(symbol);
    const companyName = quote.longName || quote.shortName || symbol;

    if (quote && quote.dividendDate) {
      const quoteSummary = await yahooFinance.quoteSummary(symbol, { modules: ['fundProfile', 'summaryDetail'] });
      const summaryData = quoteSummary.summaryDetail;

      const annualRate = summaryData?.trailingAnnualDividendRate || quote.trailingAnnualDividendRate || 0;
      const perPayment = summaryData?.dividendRate || 0;

      const amountPerShare = annualRate || perPayment || 0;

      // Derive frequency from annual ÷ per-payment ratio
      let frequency = 4; // default quarterly
      if (perPayment > 0 && annualRate > 0) {
        const ratio = annualRate / perPayment;
        if (ratio <= 1.5)      frequency = 1;   // annual
        else if (ratio <= 3)   frequency = 2;   // semi-annual
        else if (ratio <= 6)   frequency = 4;   // quarterly
        else                   frequency = 12;  // monthly
      }

      const lastExDate = quote.dividendDate
        ? new Date(quote.dividendDate * 1000).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      const data = {
        frequency,
        lastExDate,
        amountPerShare: amountPerShare || 0,
        name: companyName,
        timestamp: Date.now()
      };

      logger.info('YahooFinance', `${symbol} → found dividend data (amount=$${data.amountPerShare})`);
      return data;
    }
    return null;
  } catch (err: any) {
    const isRateLimit = /too many|rate limit|429/i.test(err.message ?? '');
    if (isRateLimit && attempt < MAX_RETRIES) {
      const backoff = attempt * 3000;
      logger.warn('YahooFinance', `${symbol} — rate limited, retrying in ${backoff / 1000}s...`);
      await sleep(backoff);
      continue;
    }
    logger.warn('YahooFinance', `${symbol} — error: ${err.message}`);
    return null;
  }
  }
  return null;
}

async function fetchFromTiingo(symbol: string): Promise<any> {
  const apiKey = getSetting("tiingo_api_key");
  if (!apiKey) {
    logger.debug('Tiingo', `${symbol} — API key not configured`);
    return null;
  }

  // Tiingo uses ticker without exchange suffix (e.g. "RY" not "RY.TO")
  const ticker = symbol.split('.')[0];

  try {
    logger.info('Tiingo', `Fetching dividend data for ${ticker}...`);
    await rateLimit('tiingo');

    const startDate = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const res = await fetch(
      `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/dividends?startDate=${startDate}`,
      { headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' } }
    );

    if (res.status === 404) {
      logger.info('Tiingo', `${ticker} — not found`);
      return null;
    }
    if (!res.ok) {
      logger.warn('Tiingo', `${ticker} — HTTP ${res.status}`);
      return null;
    }

    const dividends: any[] = await res.json();
    if (!Array.isArray(dividends) || dividends.length === 0) {
      logger.info('Tiingo', `${ticker} — no dividend history found`);
      return null;
    }

    // Tiingo returns { exDate, date, value } — filter out zero/missing entries
    const sorted = dividends
      .filter(d => d.exDate && d.value > 0)
      .sort((a, b) => new Date(b.exDate).getTime() - new Date(a.exDate).getTime());

    if (sorted.length === 0) return null;

    const latest = sorted[0];
    const frequency = inferFrequencyFromHistory(sorted.map(d => ({ ex_dividend_date: d.exDate })));

    logger.info('Tiingo', `${ticker} → freq=${frequency}, lastEx=${latest.exDate}, amount=${latest.value}`);
    return {
      frequency,
      lastExDate: latest.exDate.split('T')[0],
      amountPerShare: latest.value,
      name: ticker,
      timestamp: Date.now()
    };
  } catch (err: any) {
    logger.error('Tiingo', `${ticker} — error: ${err.message}`);
    return null;
  }
}

// ── EODHD daily quota tracker ─────────────────────────────────────────────────
const EODHD_DAILY_LIMIT = 18; // leave 2 buffer from the 20/day free plan

function eodhdQuotaAvailable(): boolean {
  const today = new Date().toISOString().split('T')[0];
  const storedDate = getSetting('eodhd_daily_date');
  if (storedDate !== today) {
    setSetting('eodhd_daily_date', today);
    setSetting('eodhd_daily_count', '0');
    return true;
  }
  const count = parseInt(getSetting('eodhd_daily_count') ?? '0', 10);
  return count < EODHD_DAILY_LIMIT;
}

function eodhdIncrementQuota() {
  const count = parseInt(getSetting('eodhd_daily_count') ?? '0', 10);
  setSetting('eodhd_daily_count', String(count + 1));
}

async function fetchFromEODHD(symbol: string): Promise<any> {
  const apiKey = getSetting('eodhd_api_key');
  if (!apiKey) {
    logger.debug('EODHD', `${symbol} — API key not configured`);
    return null;
  }

  if (!eodhdQuotaAvailable()) {
    const used = getSetting('eodhd_daily_count') ?? '0';
    logger.warn('EODHD', `${symbol} — daily quota reached (${used}/${EODHD_DAILY_LIMIT}), skipping`);
    return null;
  }

  // EODHD ticker format: RY.TO stays as-is; plain US tickers need .US suffix
  const ticker = symbol.includes('.') ? symbol.toUpperCase() : `${symbol.toUpperCase()}.US`;

  try {
    logger.info('EODHD', `Fetching dividend data for ${ticker} (quota: ${getSetting('eodhd_daily_count') ?? '0'}/${EODHD_DAILY_LIMIT})...`);
    await rateLimit('eodhd');

    const fromDate = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const res = await fetch(
      `https://eodhistoricaldata.com/api/div/${encodeURIComponent(ticker)}?api_token=${apiKey}&fmt=json&from=${fromDate}`
    );

    eodhdIncrementQuota();

    if (res.status === 404) {
      logger.info('EODHD', `${ticker} — not found (404)`);
      return null;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn('EODHD', `${ticker} — HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const dividends: any[] = await res.json();
    if (!Array.isArray(dividends) || dividends.length === 0) {
      logger.info('EODHD', `${ticker} — no dividend history found`);
      return null;
    }

    // EODHD returns [{ date, dividends, currency }] sorted ascending — reverse it
    const sorted = dividends
      .filter(d => d.date && d.dividends > 0)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (sorted.length === 0) return null;

    const latest = sorted[0];
    const frequency = inferFrequencyFromHistory(sorted.map(d => ({ ex_dividend_date: d.date })));

    logger.info('EODHD', `${ticker} → freq=${frequency}, lastEx=${latest.date}, amount=${latest.dividends}`);
    return {
      frequency,
      lastExDate: latest.date,
      amountPerShare: latest.dividends,
      name: ticker,
      timestamp: Date.now()
    };
  } catch (err: any) {
    logger.error('EODHD', `${ticker} — error: ${err.message}`);
    return null;
  }
}

async function fetchFromPolygon(symbol: string): Promise<any> {
  const apiKey = getSetting("polygon_api_key");
  if (!apiKey) {
    logger.debug('Polygon', `${symbol} — API key not configured`);
    return null;
  }

  try {
    logger.info('Polygon', `Fetching dividend data for ${symbol}...`);
    await rateLimit('polygon');

    // v3 API returns frequency field and uses Authorization header (key not in URL)
    const res = await fetch(
      `https://api.polygon.io/v3/reference/dividends?ticker=${encodeURIComponent(symbol)}&limit=12&sort=ex_dividend_date&order=desc`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    if (!res.ok) {
      logger.warn('Polygon', `${symbol} — HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      logger.info('Polygon', `${symbol} — no dividend data found`);
      return null;
    }

    const latest = data.results[0];

    // v3 frequency: 0=unspecified, 1=annual, 2=bi-annual, 4=quarterly, 12=monthly
    const freqMap: Record<number, number> = { 1: 1, 2: 2, 4: 4, 12: 12 };
    const frequency = freqMap[latest.frequency] ?? inferFrequencyFromHistory(data.results);

    return {
      frequency,
      lastExDate: latest.ex_dividend_date || new Date().toISOString().split('T')[0],
      amountPerShare: parseFloat(latest.cash_amount) || 0,
      name: symbol,
      timestamp: Date.now()
    };
  } catch (err: any) {
    logger.error('Polygon', `${symbol} — error: ${err.message}`);
    return null;
  }
}

async function fetchFromAlphaVantage(symbol: string): Promise<any> {
  const apiKey = getSetting("alphavantage_api_key");
  if (!apiKey) {
    logger.debug('AlphaVantage', `${symbol} — API key not configured`);
    return null;
  }

  try {
    logger.info('AlphaVantage', `Fetching dividend data for ${symbol}...`);
    await rateLimit('alphavantage');

    // OVERVIEW endpoint provides ExDividendDate, DividendDate, DividendPerShare, and frequency hints
    const res = await fetch(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
    );

    if (!res.ok) {
      logger.warn('AlphaVantage', `${symbol} — HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!data['Symbol'] || data['Symbol'] !== symbol) {
      logger.info('AlphaVantage', `${symbol} — no overview data found`);
      return null;
    }

    const dividendPerShare = parseFloat(data['DividendPerShare'] || '0');
    if (!dividendPerShare || dividendPerShare === 0) {
      logger.info('AlphaVantage', `${symbol} — no dividend per share found`);
      return null;
    }

    const exDateRaw = data['ExDividendDate'];
    const annualDivYield = parseFloat(data['DividendYield'] || '0');
    const price = parseFloat(data['AnalystTargetPrice'] || '0');
    const annualRate = annualDivYield > 0 && price > 0 ? annualDivYield * price : 0;

    // Detect frequency from annual ÷ per-payment
    let frequency = 4;
    if (annualRate > 0 && dividendPerShare > 0) {
      const ratio = annualRate / dividendPerShare;
      if (ratio <= 1.5)      frequency = 1;
      else if (ratio <= 3)   frequency = 2;
      else if (ratio <= 6)   frequency = 4;
      else                   frequency = 12;
    }

    const lastExDate = (exDateRaw && exDateRaw !== 'None' && exDateRaw !== '0000-00-00')
      ? exDateRaw
      : new Date().toISOString().split('T')[0];

    return {
      frequency,
      lastExDate,
      amountPerShare: dividendPerShare,
      name: data['Name'] || symbol,
      timestamp: Date.now()
    };
  } catch (err: any) {
    logger.error('AlphaVantage', `${symbol} — error: ${err.message}`);
    return null;
  }
}

async function fetchFromFinnhub(symbol: string): Promise<any> {
  const apiKey = getSetting("finnhub_api_key");
  if (!apiKey) {
    logger.debug('Finnhub', `${symbol} — API key not configured`);
    return null;
  }

  try {
    logger.info('Finnhub', `Fetching dividend data for ${symbol}...`);
    await rateLimit('finnhub');

    // Use X-Finnhub-Token header to keep key out of URL
    const fromDate = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const toDate = new Date().toISOString().split('T')[0];
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/dividend?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}`,
      { headers: { 'X-Finnhub-Token': apiKey } }
    );

    if (!res.ok) {
      logger.warn('Finnhub', `${symbol} — HTTP ${res.status}`);
      return null;
    }

    const dividends = await res.json();
    if (!dividends || dividends.length === 0) {
      logger.info('Finnhub', `${symbol} — no dividend history found`);
      return null;
    }

    const sorted = dividends.sort((a: any, b: any) =>
      new Date(b.exDate).getTime() - new Date(a.exDate).getTime()
    );
    const latest = sorted[0];

    return {
      frequency: inferFrequencyFromHistory(sorted.map((d: any) => ({ ex_dividend_date: d.exDate }))),
      lastExDate: latest.exDate,
      amountPerShare: latest.amount ?? 0,
      name: symbol,
      timestamp: Date.now()
    };
  } catch (err: any) {
    logger.error('Finnhub', `${symbol} — error: ${err.message}`);
    return null;
  }
}

/**
 * Helper to fetch dividend metadata with multiple provider fallback
 */
async function fetchDividendMetadata(symbol: string): Promise<any> {
  const now = Date.now();

  // 1. Check in-memory Cache
  if (divMetadataCache.has(symbol)) {
    const cached = divMetadataCache.get(symbol)!;
    if (now - cached.timestamp < CACHE_TTL_MS) {
      logger.debug('Cache', `fetchDividendMetadata(${symbol}) → memory HIT`);
      return cached;
    }
  }

  // 2. Check DB Cache
  const dbCached = getCachedDividendMetadata(symbol);
  if (dbCached) {
    const cachedAt = new Date(dbCached.cachedAt).getTime();
    if (now - cachedAt < CACHE_TTL_MS) {
      logger.debug('Cache', `fetchDividendMetadata(${symbol}) → DB HIT`);
      const data = {
        frequency: dbCached.frequency,
        lastExDate: dbCached.lastExDate,
        amountPerShare: dbCached.amountPerShare,
        name: dbCached.name,
        timestamp: cachedAt
      };
      divMetadataCache.set(symbol, data);
      return data;
    }
  }

  // 3. Get enabled providers from settings
  const providers = getDividendProviders();

  // Canadian exchange suffixes — only Yahoo covers these reliably
  const isCanadian = /\.(TO|TSX|V|CN|NEO)$/i.test(symbol);

  // When Tiingo is enabled:
  //   Canadian symbols → Yahoo first (Tiingo has no TSX data), others as fallback
  //   US symbols       → Tiingo first, Yahoo last (avoids hitting Yahoo rate limit for US)
  // Routing strategy:
  //   Canadian (.TO/.TSX/.V/.CN/.NEO):
  //     EODHD (good CA coverage, limited daily quota) →
  //     Yahoo (best CA coverage, rate-limited) →
  //     others as last resort
  //   US / unknown:
  //     Tiingo (paid, reliable US) →
  //     EODHD →
  //     Polygon / AlphaVantage / Finnhub →
  //     Yahoo last (avoid burning Yahoo quota on US symbols)
  const providerOrder = isCanadian
    ? [
        { name: 'eodhd',        enabled: providers.eodhd,        fn: fetchFromEODHD },
        { name: 'yahoo',        enabled: providers.yahoo,        fn: fetchFromYahooFinance },
        { name: 'tiingo',       enabled: providers.tiingo,       fn: fetchFromTiingo },
        { name: 'polygon',      enabled: providers.polygon,      fn: fetchFromPolygon },
        { name: 'alphavantage', enabled: providers.alphavantage, fn: fetchFromAlphaVantage },
        { name: 'finnhub',      enabled: providers.finnhub,      fn: fetchFromFinnhub },
      ]
    : [
        { name: 'tiingo',       enabled: providers.tiingo,       fn: fetchFromTiingo },
        { name: 'eodhd',        enabled: providers.eodhd,        fn: fetchFromEODHD },
        { name: 'polygon',      enabled: providers.polygon,      fn: fetchFromPolygon },
        { name: 'alphavantage', enabled: providers.alphavantage, fn: fetchFromAlphaVantage },
        { name: 'finnhub',      enabled: providers.finnhub,      fn: fetchFromFinnhub },
        { name: 'yahoo',        enabled: providers.yahoo,        fn: fetchFromYahooFinance },
      ];

  logger.debug('Dividend', `${symbol} — routing: ${isCanadian ? 'Canadian' : 'US'} → [${providerOrder.filter(p => p.enabled).map(p => p.name).join(', ')}]`);

  // Try each enabled provider in order
  for (const provider of providerOrder) {
    if (!provider.enabled) continue;

    const data = await provider.fn(symbol);
    if (data) {
      divMetadataCache.set(symbol, data);
      saveCachedDividendMetadata(symbol, data, provider.name);
      logger.info('Dividend', `${symbol} → saved to cache via ${provider.name}`);
      return data;
    }
  }

  logger.warn('Dividend', `${symbol} — no dividend data available from any provider`);
  return null;
}

export async function getDividendForecastForAccount(portfolio: Portfolio, accountId: string, forceRefresh: boolean = false): Promise<DividendEvent[]> {
  const TTL_MS = 24 * 60 * 60 * 1000;
  logger.info('Forecast', `getDividendForecastForAccount — portfolio="${portfolio.name}" account=${accountId} forceRefresh=${forceRefresh}`);

  try {
    let positions: any[] = [];
    
    const cached = getCachedPositions(accountId);
    const isFresh = cached.length > 0 && (Date.now() - new Date(cached[0].cachedAt).getTime() < TTL_MS);

    if (isFresh && !forceRefresh) {
      logger.info('Cache', `getDividendForecastForAccount — positions cache HIT for account ${accountId} (${cached.length} position(s))`);
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

    for (const position of validPositions) {
      const symbolInfo = (position.symbol as any)?.symbol;
      const symbol = symbolInfo?.symbol;
      const units = position.units || 0;

      try {
        const idx = validPositions.indexOf(position) + 1;
        const total = validPositions.length;
        logger.info('Forecast', `  [${idx}/${total}] Processing ${symbol} (${units} units)...`);

        const METADATA_TIMEOUT_MS = 45000; // 45 second overall timeout per symbol
        let metadata;
        try {
          metadata = await withTimeout(
            fetchDividendMetadata(symbol),
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

        const monthsToAdd = 12 / frequency;
        logger.info('Forecast', `  ${symbol} — monthsToAdd=${monthsToAdd}`);

        let currentProjDate = new Date(lastExDate);
        logger.info('Forecast', `  ${symbol} — starting projection from ${currentProjDate.toISOString()}`);

        let loopCount = 0;
        while (currentProjDate < now && loopCount < 100) {
          currentProjDate.setMonth(currentProjDate.getMonth() + monthsToAdd);
          loopCount++;
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
          currentProjDate.setMonth(currentProjDate.getMonth() + monthsToAdd);
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

export async function getAllDividendsForAllPortfolios(): Promise<any[]> {
  const portfolios = listPortfolios();
  const results = [];
  const TTL_MS = 24 * 60 * 60 * 1000;

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
      const isFresh = cached.length > 0 && (Date.now() - new Date(cached[0].cachedAt).getTime() < TTL_MS);

      if (isFresh) {
        logger.info('Cache', `  "${portfolio.name}" — accounts cache HIT (${cached.length} account(s))`);
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

      const allAccounts: any[] = accounts;
      const activeAccounts = allAccounts.filter(acc => activeAccountIds.has(acc.id));
      const skipped = allAccounts.length - activeAccounts.length;

      logger.info('DividendSvc', `  "${portfolio.name}" — ${activeAccounts.length} active account(s) of ${allAccounts.length} total (${skipped} inactive, skipped)`);

      for (const acc of activeAccounts) {
        logger.info('DividendSvc', `    Account: "${acc.name ?? acc.id}" (${acc.id})`);
        try {
          const dividends = await getDividendForecastForAccount(portfolio, acc.id);
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
  return results;
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

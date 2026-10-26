import { getPriceHistory, getHeldSymbols } from "../repositories/priceHistoryRepository.js";
import { listWatchlist } from "../repositories/watchlistRepository.js";
import { getCachedPositions } from "../repositories/accountRepository.js";

export interface DipMetrics {
  symbol: string;
  name?: string;
  currentPrice: number;
  sma10?: number | null;
  sma50?: number | null;
  sma100?: number | null;
  sma200?: number | null;
  vsSma10Pct?: number | null;
  vsSma50Pct?: number | null;
  vsSma100Pct?: number | null;
  vsSma200Pct?: number | null;
  high52w?: number | null;
  low52w?: number | null;
  from52wLowPct?: number | null;
  from52wHighPct?: number | null;
  dipScore: number; // 0 - 100
  rating: 'Deep Dip' | 'Moderate Dip' | 'Mild Dip' | 'Fair Value' | 'Overextended';
  isHeld: boolean;
  isWatchlist: boolean;
}

function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period || period <= 0) return null;
  const slice = prices.slice(prices.length - period);
  const sum = slice.reduce((acc, p) => acc + p, 0);
  return sum / period;
}

export function computeDipMetrics(symbol: string, isHeld = false, isWatchlist = false): DipMetrics | null {
  const candles = getPriceHistory(symbol.toUpperCase());
  if (!candles || candles.length === 0) return null;

  const validCandles = candles.filter(c => c.close != null && c.close > 0);
  if (validCandles.length === 0) return null;

  const closes = validCandles.map(c => c.close!);
  const currentPrice = closes[closes.length - 1];

  const sma10 = calculateSMA(closes, 10);
  const sma50 = calculateSMA(closes, 50);
  const sma100 = calculateSMA(closes, 100);
  const sma200 = calculateSMA(closes, 200);

  const vsSma10Pct = sma10 != null ? ((currentPrice - sma10) / sma10) * 100 : null;
  const vsSma50Pct = sma50 != null ? ((currentPrice - sma50) / sma50) * 100 : null;
  const vsSma100Pct = sma100 != null ? ((currentPrice - sma100) / sma100) * 100 : null;
  const vsSma200Pct = sma200 != null ? ((currentPrice - sma200) / sma200) * 100 : null;

  // 52-week window (last 252 trading days)
  const window52w = validCandles.slice(-252);
  let high52w = -Infinity;
  let low52w = Infinity;

  for (const c of window52w) {
    const high = c.high ?? c.close!;
    const low = c.low ?? c.close!;
    if (high > high52w) high52w = high;
    if (low < low52w) low52w = low;
  }

  const from52wLowPct = low52w < Infinity ? ((currentPrice - low52w) / low52w) * 100 : null;
  const from52wHighPct = high52w > -Infinity ? ((currentPrice - high52w) / high52w) * 100 : null;

  // Dip Score calculation: 0 to 100
  // Components:
  // - Discount vs SMA200 (up to 40 pts if 20% below SMA200)
  // - Discount vs SMA50 (up to 30 pts if 15% below SMA50)
  // - Proximity to 52W low (up to 30 pts if within 10% of 52W low)
  let dipScore = 0;

  if (vsSma200Pct != null && vsSma200Pct < 0) {
    const pts = Math.min(40, Math.abs(vsSma200Pct) * 2);
    dipScore += pts;
  }
  if (vsSma50Pct != null && vsSma50Pct < 0) {
    const pts = Math.min(30, Math.abs(vsSma50Pct) * 2);
    dipScore += pts;
  }
  if (from52wLowPct != null && from52wLowPct >= 0) {
    if (from52wLowPct < 10) {
      dipScore += 30;
    } else if (from52wLowPct < 20) {
      dipScore += 15;
    }
  }

  dipScore = Math.min(100, Math.round(dipScore));

  let rating: DipMetrics['rating'] = 'Fair Value';
  if (dipScore >= 70) {
    rating = 'Deep Dip';
  } else if (dipScore >= 45) {
    rating = 'Moderate Dip';
  } else if (dipScore >= 20) {
    rating = 'Mild Dip';
  } else if (vsSma50Pct != null && vsSma50Pct > 15) {
    rating = 'Overextended';
  }

  return {
    symbol: symbol.toUpperCase(),
    currentPrice: Math.round(currentPrice * 100) / 100,
    sma10: sma10 != null ? Math.round(sma10 * 100) / 100 : null,
    sma50: sma50 != null ? Math.round(sma50 * 100) / 100 : null,
    sma100: sma100 != null ? Math.round(sma100 * 100) / 100 : null,
    sma200: sma200 != null ? Math.round(sma200 * 100) / 100 : null,
    vsSma10Pct: vsSma10Pct != null ? Math.round(vsSma10Pct * 10) / 10 : null,
    vsSma50Pct: vsSma50Pct != null ? Math.round(vsSma50Pct * 10) / 10 : null,
    vsSma100Pct: vsSma100Pct != null ? Math.round(vsSma100Pct * 10) / 10 : null,
    vsSma200Pct: vsSma200Pct != null ? Math.round(vsSma200Pct * 10) / 10 : null,
    high52w: high52w > -Infinity ? Math.round(high52w * 100) / 100 : null,
    low52w: low52w < Infinity ? Math.round(low52w * 100) / 100 : null,
    from52wLowPct: from52wLowPct != null ? Math.round(from52wLowPct * 10) / 10 : null,
    from52wHighPct: from52wHighPct != null ? Math.round(from52wHighPct * 10) / 10 : null,
    dipScore,
    rating,
    isHeld,
    isWatchlist
  };
}

export function scanDipOpportunities(): DipMetrics[] {
  const held = new Set(getHeldSymbols().map(s => s.toUpperCase()));
  const watchlist = new Set(listWatchlist().map(w => w.symbol.toUpperCase()));

  const allSymbols = new Set([...held, ...watchlist]);
  const results: DipMetrics[] = [];

  for (const sym of allSymbols) {
    const metrics = computeDipMetrics(sym, held.has(sym), watchlist.has(sym));
    if (metrics) {
      results.push(metrics);
    }
  }

  // Sort by highest dip score first
  return results.sort((a, b) => b.dipScore - a.dipScore);
}

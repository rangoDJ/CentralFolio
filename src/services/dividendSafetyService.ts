import { getDividendHistory } from "../repositories/dividendHistoryRepository.js";
import { getCachedDividendMetadata } from "../repositories/dividendRepository.js";
import { getRating } from "../repositories/stockRatingRepository.js";
import { getHeldSymbols } from "../repositories/priceHistoryRepository.js";

export interface DividendSafetyReport {
  symbol: string;
  score: number; // 0 - 100
  safetyTier: 'Very Safe' | 'Safe' | 'Borderline' | 'Risky';
  payoutRatioPct: number | null;
  growthStreakYears: number;
  latestPayout: number | null;
  previousPayout: number | null;
  dividendSurprisePct: number | null;
  status: 'declared' | 'estimated' | 'recommended' | 'paid';
  reasons: string[];
}

export function computeDividendSafety(symbol: string): DividendSafetyReport {
  const sym = symbol.toUpperCase();
  const history = getDividendHistory(sym); // sorted DESC or ASC
  const meta = getCachedDividendMetadata(sym);
  const rating = getRating(sym);

  let score = 70; // baseline
  const reasons: string[] = [];

  // Payout analysis from history
  let latestPayout: number | null = null;
  let previousPayout: number | null = null;
  let dividendSurprisePct: number | null = null;

  if (history && history.length >= 2) {
    // Sort chronologically
    const sorted = [...history].sort((a, b) => a.exDate.localeCompare(b.exDate));
    latestPayout = sorted[sorted.length - 1].amount;
    previousPayout = sorted[sorted.length - 2].amount;

    if (previousPayout > 0 && latestPayout != null) {
      dividendSurprisePct = Math.round(((latestPayout - previousPayout) / previousPayout) * 1000) / 10;
    }
  } else if (meta?.amountPerShare) {
    latestPayout = meta.amountPerShare;
  }

  // Dividend growth streak estimation
  let growthStreak = 0;
  if (history && history.length >= 4) {
    // Group dividends by calendar year
    const byYear = new Map<number, number>();
    for (const h of history) {
      const y = parseInt(h.exDate.slice(0, 4), 10);
      if (!isNaN(y)) {
        byYear.set(y, (byYear.get(y) ?? 0) + h.amount);
      }
    }
    const years = Array.from(byYear.keys()).sort((a, b) => b - a); // DESC
    for (let i = 0; i < years.length - 1; i++) {
      const cur = byYear.get(years[i]) ?? 0;
      const prev = byYear.get(years[i + 1]) ?? 0;
      if (cur >= prev * 0.99) {
        growthStreak++;
      } else {
        break;
      }
    }
  }

  // Score adjustments
  if (growthStreak >= 10) {
    score += 20;
    reasons.push("10+ years consecutive dividend continuity");
  } else if (growthStreak >= 5) {
    score += 10;
    reasons.push("5+ years continuous dividend growth");
  } else if (growthStreak === 0 && history.length >= 8) {
    score -= 15;
    reasons.push("Recent dividend freeze or reduction detected");
  }

  if (dividendSurprisePct != null) {
    if (dividendSurprisePct > 0) {
      score += 5;
      reasons.push(`Latest payout increased by +${dividendSurprisePct}%`);
    } else if (dividendSurprisePct < 0) {
      score -= 25;
      reasons.push(`Latest payout cut by ${dividendSurprisePct}%`);
    }
  }

  // Analyst consensus factor
  if (rating?.label) {
    const lbl = rating.label.toLowerCase();
    if (lbl.includes("buy")) {
      score += 5;
    } else if (lbl.includes("caution") || lbl.includes("risky")) {
      score -= 15;
      reasons.push("Analyst rating is Caution/Risky");
    }
  }

  score = Math.max(10, Math.min(100, Math.round(score)));

  let safetyTier: DividendSafetyReport['safetyTier'] = 'Borderline';
  if (score >= 80) safetyTier = 'Very Safe';
  else if (score >= 60) safetyTier = 'Safe';
  else if (score >= 40) safetyTier = 'Borderline';
  else safetyTier = 'Risky';

  // Status: if payDate is upcoming in future, declared
  let status: DividendSafetyReport['status'] = 'estimated';
  const today = new Date().toISOString().slice(0, 10);
  if (meta?.payDate && meta.payDate >= today) {
    status = 'declared';
  } else if (meta?.lastExDate && meta.lastExDate >= today) {
    status = 'declared';
  } else {
    status = 'estimated';
  }

  return {
    symbol: sym,
    score,
    safetyTier,
    payoutRatioPct: null,
    growthStreakYears: growthStreak,
    latestPayout,
    previousPayout,
    dividendSurprisePct,
    status,
    reasons
  };
}

export function batchComputeDividendSafety(symbols?: string[]): DividendSafetyReport[] {
  const targetSymbols = symbols ?? getHeldSymbols();
  return targetSymbols.map(sym => computeDividendSafety(sym));
}

/**
 * Pure risk/volatility math over a daily value series — no DB, no network, so it
 * can be unit-tested directly (see src/riskMetrics.test.ts). Used for both the
 * reconstructed portfolio value curve and individual price-history series.
 */

const TRADING_DAYS = 252;

export interface RiskPoint { date: string; value: number; }

export interface RiskMetrics {
  volatility: number | null;   // annualized stdev of daily returns (fraction, e.g. 0.18 = 18%)
  sharpe: number | null;       // annualized, risk-free rate assumed 0
  maxDrawdown: number | null;  // largest peak-to-trough decline (fraction, positive)
  beta: number | null;         // vs benchmark (null if no benchmark given)
  return1y: number | null;     // trailing ~1y total return (fraction)
  points: number;              // sample size used
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Daily simple returns keyed by the (later) date, from a date-sorted series. */
export function dailyReturns(series: RiskPoint[]): Map<string, number> {
  const sorted = [...series].filter(p => p.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value, cur = sorted[i].value;
    if (prev > 0) out.set(sorted[i].date, cur / prev - 1);
  }
  return out;
}

export function maxDrawdown(series: RiskPoint[]): number | null {
  const sorted = [...series].filter(p => p.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;
  let peak = sorted[0].value, mdd = 0;
  for (const p of sorted) {
    if (p.value > peak) peak = p.value;
    const dd = (peak - p.value) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

export function computeRiskMetrics(series: RiskPoint[], benchmark?: RiskPoint[]): RiskMetrics {
  const sorted = [...series].filter(p => p.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  const retMap = dailyReturns(sorted);
  const rets = Array.from(retMap.values());

  const empty: RiskMetrics = { volatility: null, sharpe: null, maxDrawdown: null, beta: null, return1y: null, points: rets.length };
  if (rets.length < 5) return empty;

  const sd = stdev(rets);
  const volatility = sd * Math.sqrt(TRADING_DAYS);
  const sharpe = sd > 0 ? (mean(rets) / sd) * Math.sqrt(TRADING_DAYS) : null;
  const mdd = maxDrawdown(sorted);

  // Trailing ~1y total return (last ≤252 daily returns compounded).
  const tail = rets.slice(-TRADING_DAYS);
  const return1y = tail.reduce((acc, r) => acc * (1 + r), 1) - 1;

  // Beta: regress asset returns on benchmark returns over their shared dates.
  let beta: number | null = null;
  if (benchmark && benchmark.length > 1) {
    const benchMap = dailyReturns(benchmark);
    const a: number[] = [], b: number[] = [];
    for (const [date, r] of retMap) {
      const br = benchMap.get(date);
      if (br != null) { a.push(r); b.push(br); }
    }
    if (a.length >= 5) {
      const ma = mean(a), mb = mean(b);
      let cov = 0, varB = 0;
      for (let i = 0; i < a.length; i++) { cov += (a[i] - ma) * (b[i] - mb); varB += (b[i] - mb) * (b[i] - mb); }
      beta = varB > 0 ? cov / varB : null;
    }
  }

  return { volatility, sharpe, maxDrawdown: mdd, beta, return1y, points: rets.length };
}

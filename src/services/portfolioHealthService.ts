/**
 * Portfolio Health & Quality Score — Snowball Analytics-style scoring engine.
 * Computes an overall score (0–100) and letter grade (A+ through F) across
 * 4 pillars: Diversification, Sector Balance, Dividend Safety, and Risk/Volatility.
 */

export interface HealthHolding {
  symbol: string;
  value: number;
  cost?: number;
  dividendYield?: number | null;
  annualIncome?: number | null;
  sector?: string | null;
  assetType?: string | null;
  growthStreak?: number | null;
  safetyScore?: number | null;
}

export interface PillarScore {
  name: string;
  score: number;       // 0 to 25
  maxScore: number;    // 25
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  feedback: string[];
}

export interface PortfolioHealthReport {
  overallScore: number; // 0 to 100
  letterGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
  pillars: {
    diversification: PillarScore;
    sectorBalance: PillarScore;
    dividendSafety: PillarScore;
    riskVolatility: PillarScore;
  };
  keyFindings: Array<{
    type: 'positive' | 'warning' | 'danger';
    title: string;
    detail: string;
  }>;
}

function letterGrade(score: number, max = 100): 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' {
  const pct = (score / max) * 100;
  if (pct >= 95) return 'A+';
  if (pct >= 85) return 'A';
  if (pct >= 72) return 'B';
  if (pct >= 58) return 'C';
  if (pct >= 45) return 'D';
  return 'F';
}

export function computePortfolioHealth(
  holdings: HealthHolding[],
  options: {
    beta?: number | null;
    maxDrawdown?: number | null;
    volatility?: number | null;
    totalValue?: number | null;
    sectors?: Array<{ key: string; pct: number }>;
  } = {}
): PortfolioHealthReport {
  const totalVal = options.totalValue ?? holdings.reduce((sum, h) => sum + (h.value || 0), 0);
  const findings: PortfolioHealthReport['keyFindings'] = [];

  if (holdings.length === 0 || totalVal <= 0) {
    return {
      overallScore: 0,
      letterGrade: 'F',
      summary: 'No active holdings found to assess portfolio health.',
      pillars: {
        diversification: { name: 'Diversification', score: 0, maxScore: 25, grade: 'F', feedback: ['No assets found'] },
        sectorBalance: { name: 'Sector Balance', score: 0, maxScore: 25, grade: 'F', feedback: ['No sectors found'] },
        dividendSafety: { name: 'Dividend Safety', score: 0, maxScore: 25, grade: 'F', feedback: ['No dividends found'] },
        riskVolatility: { name: 'Risk & Volatility', score: 0, maxScore: 25, grade: 'F', feedback: ['No price history'] },
      },
      keyFindings: [],
    };
  }

  // ── 1. Diversification Pillar (0-25 pts) ───────────────────────────────────
  let divScore = 25;
  const divFeedback: string[] = [];

  // Sort by weight
  const sorted = [...holdings].sort((a, b) => b.value - a.value);
  const maxWeight = totalVal > 0 ? (sorted[0].value / totalVal) * 100 : 0;
  const top3Weight = totalVal > 0 ? (sorted.slice(0, 3).reduce((s, h) => s + h.value, 0) / totalVal) * 100 : 0;

  if (holdings.length < 3) {
    divScore -= 12;
    divFeedback.push(`Critically concentrated in only ${holdings.length} holding(s).`);
    findings.push({
      type: 'danger',
      title: 'High Asset Concentration',
      detail: `Your portfolio contains only ${holdings.length} position(s). Broaden holdings to reduce idiosyncratic risk.`,
    });
  } else if (holdings.length < 6) {
    divScore -= 4;
    divFeedback.push(`Holding count (${holdings.length}) is slightly low. Aim for 8-25 positions.`);
  } else {
    divFeedback.push(`Well-diversified count of ${holdings.length} positions.`);
  }

  if (maxWeight > 30) {
    divScore -= 10;
    divFeedback.push(`Largest position (${sorted[0].symbol}) accounts for ${maxWeight.toFixed(1)}% of your portfolio.`);
    findings.push({
      type: 'warning',
      title: `Single-Stock Overweight (${sorted[0].symbol})`,
      detail: `${sorted[0].symbol} makes up ${maxWeight.toFixed(1)}% of total value. Standard guideline is ≤ 15-20%.`,
    });
  } else if (maxWeight > 20) {
    divScore -= 4;
    divFeedback.push(`Largest position (${sorted[0].symbol}) is moderately high at ${maxWeight.toFixed(1)}%.`);
  } else {
    divFeedback.push(`No single stock dominates portfolio (max weight is ${maxWeight.toFixed(1)}%).`);
    findings.push({
      type: 'positive',
      title: 'Healthy Asset Distribution',
      detail: `Top asset (${sorted[0].symbol}) is kept under 20% of your total balance.`,
    });
  }

  if (top3Weight > 65) {
    divScore -= 3;
    divFeedback.push(`Top 3 holdings represent ${top3Weight.toFixed(1)}% of the total.`);
  }
  divScore = Math.max(0, Math.min(25, divScore));

  // ── 2. Sector & Asset Class Balance (0-25 pts) ───────────────────────────
  let secScore = 25;
  const secFeedback: string[] = [];

  const sectors = options.sectors || (() => {
    const map = new Map<string, number>();
    for (const h of holdings) {
      const s = h.sector || 'Unclassified';
      map.set(s, (map.get(s) || 0) + h.value);
    }
    return Array.from(map.entries()).map(([key, val]) => ({ key, pct: totalVal > 0 ? (val / totalVal) * 100 : 0 }));
  })();

  const topSector = sectors.slice().sort((a, b) => b.pct - a.pct)[0];
  if (topSector && topSector.pct > 40 && topSector.key !== 'Funds / ETFs') {
    secScore -= 12;
    secFeedback.push(`Sector concentration in ${topSector.key} (${topSector.pct.toFixed(1)}%).`);
    findings.push({
      type: 'warning',
      title: `Heavy Sector Bias (${topSector.key})`,
      detail: `${topSector.key} represents ${topSector.pct.toFixed(1)}% of your portfolio. Consider rebalancing into underweighted sectors.`,
    });
  } else if (topSector && topSector.pct > 25 && topSector.key !== 'Funds / ETFs') {
    secScore -= 5;
    secFeedback.push(`Noticeable tilt towards ${topSector.key} (${topSector.pct.toFixed(1)}%).`);
  }

  const distinctSectors = sectors.filter(s => s.pct >= 3).length;
  if (distinctSectors >= 5) {
    secFeedback.push(`Strong industry spread across ${distinctSectors} active sectors.`);
    findings.push({
      type: 'positive',
      title: 'Broad Sector Exposure',
      detail: `Capital is deployed across ${distinctSectors} distinct market sectors.`,
    });
  } else if (distinctSectors <= 2) {
    secScore -= 6;
    secFeedback.push(`Narrow sector spread: only ${distinctSectors} sector(s) with ≥ 3% weight.`);
  }
  secScore = Math.max(0, Math.min(25, secScore));

  // ── 3. Dividend Quality & Sustainability (0-25 pts) ───────────────────────
  let divQualScore = 25;
  const divQualFeedback: string[] = [];

  const totalAnnualDiv = holdings.reduce((s, h) => s + (h.annualIncome || 0), 0);
  const overallYield = totalVal > 0 ? (totalAnnualDiv / totalVal) * 100 : 0;

  if (overallYield === 0) {
    // Pure growth portfolio
    divQualScore = 20;
    divQualFeedback.push('Pure growth/non-dividend portfolio. No dividend risk detected.');
  } else if (overallYield > 10) {
    divQualScore -= 12;
    divQualFeedback.push(`Extremely high portfolio yield (${overallYield.toFixed(2)}%), elevated cut risk.`);
    findings.push({
      type: 'warning',
      title: 'Potential Yield Trap Risk',
      detail: `Your forward yield of ${overallYield.toFixed(2)}% is unusually high. Ensure underlying distributions are covered by free cash flow.`,
    });
  } else if (overallYield > 7.5) {
    divQualScore -= 4;
    divQualFeedback.push(`High yield (${overallYield.toFixed(2)}%). Monitor payout ratios carefully.`);
  } else {
    divQualFeedback.push(`Sustainable portfolio dividend yield of ${overallYield.toFixed(2)}%.`);
    findings.push({
      type: 'positive',
      title: 'Sustainable Dividend Yield',
      detail: `Current yield of ${overallYield.toFixed(2)}% sits in the historical sweet spot for durable dividend growth.`,
    });
  }

  // Check growth streaks
  const payers = holdings.filter(h => (h.annualIncome || 0) > 0);
  const aristocratsOrAchievers = payers.filter(h => (h.growthStreak || 0) >= 10);
  if (aristocratsOrAchievers.length > 0) {
    divQualFeedback.push(`Includes ${aristocratsOrAchievers.length} company(ies) with 10+ year dividend growth streaks.`);
  }
  divQualScore = Math.max(0, Math.min(25, divQualScore));

  // ── 4. Risk & Volatility (0-25 pts) ─────────────────────────────────────────
  let riskScore = 25;
  const riskFeedback: string[] = [];

  const beta = options.beta;
  if (beta != null && !isNaN(beta)) {
    if (beta > 1.4) {
      riskScore -= 10;
      riskFeedback.push(`High portfolio Beta (${beta.toFixed(2)}): swings 40%+ more than the market.`);
      findings.push({
        type: 'warning',
        title: 'High Systematic Volatility',
        detail: `Portfolio Beta is ${beta.toFixed(2)}, making returns significantly more volatile than index benchmarks.`,
      });
    } else if (beta > 1.15) {
      riskScore -= 4;
      riskFeedback.push(`Moderately high Beta (${beta.toFixed(2)}).`);
    } else if (beta >= 0.75 && beta <= 1.15) {
      riskFeedback.push(`Optimal market-matching Beta (${beta.toFixed(2)}).`);
      findings.push({
        type: 'positive',
        title: 'Controlled Market Beta',
        detail: `Beta of ${beta.toFixed(2)} provides balanced market participation without excessive drawdowns.`,
      });
    } else {
      riskFeedback.push(`Low volatility / defensive Beta (${beta.toFixed(2)}).`);
    }
  } else {
    riskFeedback.push('Standard risk profile.');
  }

  const dd = options.maxDrawdown;
  if (dd != null && Math.abs(dd) > 30) {
    riskScore -= 6;
    riskFeedback.push(`Historical max drawdown was elevated (${Math.abs(dd).toFixed(1)}%).`);
  }
  riskScore = Math.max(0, Math.min(25, riskScore));

  // ── Overall ───────────────────────────────────────────────────────────────
  const totalScore = Math.round(divScore + secScore + divQualScore + riskScore);
  const grade = letterGrade(totalScore);

  let summary = `Your portfolio health rating is ${totalScore}/100 (Grade: ${grade}). `;
  if (totalScore >= 85) {
    summary += 'Strong diversification, well-managed risk, and solid distribution quality.';
  } else if (totalScore >= 70) {
    summary += 'Good foundation with mild opportunities to balance sector weights and individual position sizing.';
  } else {
    summary += 'Consider addressing single-stock concentration and broadening sector diversification.';
  }

  return {
    overallScore: totalScore,
    letterGrade: grade,
    summary,
    pillars: {
      diversification: {
        name: 'Diversification',
        score: divScore,
        maxScore: 25,
        grade: letterGrade(divScore, 25),
        feedback: divFeedback,
      },
      sectorBalance: {
        name: 'Sector Balance',
        score: secScore,
        maxScore: 25,
        grade: letterGrade(secScore, 25),
        feedback: secFeedback,
      },
      dividendSafety: {
        name: 'Dividend Safety',
        score: divQualScore,
        maxScore: 25,
        grade: letterGrade(divQualScore, 25),
        feedback: divQualFeedback,
      },
      riskVolatility: {
        name: 'Risk & Volatility',
        score: riskScore,
        maxScore: 25,
        grade: letterGrade(riskScore, 25),
        feedback: riskFeedback,
      },
    },
    keyFindings: findings,
  };
}

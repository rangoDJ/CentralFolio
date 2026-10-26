export interface FireSimulationInput {
  currentPortfolioValue: number;
  currentAnnualDividends: number;
  monthlyContribution: number;
  targetMonthlyIncome: number;
  dividendGrowthRatePct?: number; // e.g. 6%
  capitalGrowthRatePct?: number; // e.g. 5%
  reinvestDividends?: boolean;
  startDate?: Date | string;
  maxYears?: number;
}

export interface FireMilestone {
  label: string;
  pct: number;
  monthlyIncomeTarget: number;
  reachedMonth: number | null;
  reachedDate: string | null;
}

export interface FireSimulationResult {
  targetReached: boolean;
  monthsToTarget: number;
  yearsToTarget: number;
  projectedFireDate: string;
  portfolioValueAtFire: number;
  annualPassiveIncomeAtFire: number;
  currentMonthlyIncome: number;
  targetMonthlyIncome: number;
  milestones: FireMilestone[];
  yearlyTrajectory: Array<{
    year: number;
    date: string;
    portfolioValue: number;
    annualDividends: number;
    monthlyIncome: number;
  }>;
}

export function calculateFireRunway(input: FireSimulationInput): FireSimulationResult {
  const currentVal = Math.max(0, input.currentPortfolioValue || 0);
  const currentAnnualDiv = Math.max(0, input.currentAnnualDividends || 0);
  const monthlyDeposit = Math.max(0, input.monthlyContribution || 0);
  const targetMonthly = Math.max(1, input.targetMonthlyIncome || 1);
  const divGrowthRate = (input.dividendGrowthRatePct ?? 6) / 100;
  const capGrowthRate = (input.capitalGrowthRatePct ?? 5) / 100;
  const drip = input.reinvestDividends ?? true;
  const maxMonths = (input.maxYears ?? 40) * 12;

  const baseDate = input.startDate ? new Date(input.startDate) : new Date();
  const currentMonthly = currentAnnualDiv / 12;

  if (currentMonthly >= targetMonthly) {
    const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}`;
    return {
      targetReached: true,
      monthsToTarget: 0,
      yearsToTarget: 0,
      projectedFireDate: dateStr,
      portfolioValueAtFire: Math.round(currentVal),
      annualPassiveIncomeAtFire: Math.round(currentAnnualDiv),
      currentMonthlyIncome: Math.round(currentMonthly),
      targetMonthlyIncome: Math.round(targetMonthly),
      milestones: [
        { label: 'Lean FIRE (50%)', pct: 50, monthlyIncomeTarget: targetMonthly * 0.5, reachedMonth: 0, reachedDate: dateStr },
        { label: 'Chubby FIRE (75%)', pct: 75, monthlyIncomeTarget: targetMonthly * 0.75, reachedMonth: 0, reachedDate: dateStr },
        { label: 'Full FIRE (100%)', pct: 100, monthlyIncomeTarget: targetMonthly, reachedMonth: 0, reachedDate: dateStr },
      ],
      yearlyTrajectory: [{
        year: 0,
        date: dateStr,
        portfolioValue: Math.round(currentVal),
        annualDividends: Math.round(currentAnnualDiv),
        monthlyIncome: Math.round(currentMonthly),
      }],
    };
  }

  // Monthly rates
  const monthlyCapRate = Math.pow(1 + capGrowthRate, 1 / 12) - 1;
  const monthlyDivGrowthRate = Math.pow(1 + divGrowthRate, 1 / 12) - 1;

  let portValue = currentVal;
  let yieldRate = currentVal > 0 ? currentAnnualDiv / currentVal : 0.035;

  let monthsToTarget: number | null = null;
  let valAtFire = portValue;
  let divAtFire = currentAnnualDiv;

  const milestones: FireMilestone[] = [
    { label: 'Quarter FIRE (25%)', pct: 25, monthlyIncomeTarget: targetMonthly * 0.25, reachedMonth: null, reachedDate: null },
    { label: 'Lean FIRE (50%)', pct: 50, monthlyIncomeTarget: targetMonthly * 0.5, reachedMonth: null, reachedDate: null },
    { label: 'Chubby FIRE (75%)', pct: 75, monthlyIncomeTarget: targetMonthly * 0.75, reachedMonth: null, reachedDate: null },
    { label: 'Full FIRE (100%)', pct: 100, monthlyIncomeTarget: targetMonthly, reachedMonth: null, reachedDate: null },
  ];

  const yearlyTrajectory: FireSimulationResult['yearlyTrajectory'] = [];

  for (let m = 0; m <= maxMonths; m++) {
    // Current dividend income
    const monthlyDiv = (portValue * yieldRate) / 12;
    const annualDiv = portValue * yieldRate;

    // Check milestones
    for (const ms of milestones) {
      if (ms.reachedMonth === null && monthlyDiv >= ms.monthlyIncomeTarget) {
        ms.reachedMonth = m;
        const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + m, 1);
        ms.reachedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
    }

    // Check target
    if (monthsToTarget === null && monthlyDiv >= targetMonthly) {
      monthsToTarget = m;
      valAtFire = portValue;
      divAtFire = annualDiv;
      break;
    }

    if (m % 12 === 0) {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + m, 1);
      yearlyTrajectory.push({
        year: m / 12,
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        portfolioValue: Math.round(portValue),
        annualDividends: Math.round(annualDiv),
        monthlyIncome: Math.round(monthlyDiv),
      });
    }

    // Advance month: capital growth + deposit + DRIP
    portValue += portValue * monthlyCapRate;
    portValue += monthlyDeposit;
    if (drip) {
      portValue += monthlyDiv;
    }

    // Dividend yield growth
    yieldRate += yieldRate * monthlyDivGrowthRate;
  }

  const reached = monthsToTarget !== null;
  const finalMonths = monthsToTarget ?? maxMonths;
  const fireDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + finalMonths, 1);
  const projectedFireDate = `${fireDate.getFullYear()}-${String(fireDate.getMonth() + 1).padStart(2, '0')}`;

  return {
    targetReached: reached,
    monthsToTarget: finalMonths,
    yearsToTarget: Math.round((finalMonths / 12) * 10) / 10,
    projectedFireDate,
    portfolioValueAtFire: Math.round(valAtFire),
    annualPassiveIncomeAtFire: Math.round(divAtFire),
    currentMonthlyIncome: Math.round(currentMonthly),
    targetMonthlyIncome: Math.round(targetMonthly),
    milestones,
    yearlyTrajectory,
  };
}

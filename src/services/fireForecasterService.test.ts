import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFireRunway, type FireSimulationInput } from './fireForecasterService.js';

test('fireForecaster: calculates months to FIRE with compounding and deposits', () => {
  const input: FireSimulationInput = {
    currentPortfolioValue: 100000,
    currentAnnualDividends: 4000, // 4% yield
    monthlyContribution: 1000,
    targetMonthlyIncome: 1000, // $12,000 annual passive income target
    dividendGrowthRatePct: 6,
    capitalGrowthRatePct: 5,
    reinvestDividends: true,
    startDate: new Date('2026-01-01T00:00:00Z')
  };

  const sim = calculateFireRunway(input);
  assert.ok(sim.targetReached, 'Expected to reach target');
  assert.ok(sim.monthsToTarget > 0 && sim.monthsToTarget < 120, 'Expected within 10 years');
  assert.ok(sim.projectedFireDate.startsWith('203'), 'Expected 2030s date');
  assert.ok(sim.annualPassiveIncomeAtFire >= 12000);
});

test('fireForecaster: already achieved target returns 0 months', () => {
  const input: FireSimulationInput = {
    currentPortfolioValue: 500000,
    currentAnnualDividends: 20000,
    monthlyContribution: 500,
    targetMonthlyIncome: 1000, // $12k/yr target, already at $20k/yr
    dividendGrowthRatePct: 5,
    capitalGrowthRatePct: 5,
    reinvestDividends: true
  };

  const sim = calculateFireRunway(input);
  assert.equal(sim.monthsToTarget, 0);
  assert.equal(sim.targetReached, true);
});

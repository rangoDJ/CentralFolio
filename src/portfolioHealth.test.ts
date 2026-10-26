import { test } from 'node:test';
import assert from 'node:assert';
import { computePortfolioHealth } from './services/portfolioHealthService.js';

test('portfolioHealth: handles empty holdings gracefully', () => {
  const rep = computePortfolioHealth([]);
  assert.equal(rep.overallScore, 0);
  assert.equal(rep.letterGrade, 'F');
});

test('portfolioHealth: scores high for diversified portfolio with healthy metrics', () => {
  const holdings = [
    { symbol: 'VFV', value: 2000, sector: 'Funds / ETFs', annualIncome: 30 },
    { symbol: 'TD', value: 1500, sector: 'Financial Services', annualIncome: 65, growthStreak: 12 },
    { symbol: 'ENB', value: 1200, sector: 'Energy', annualIncome: 75, growthStreak: 25 },
    { symbol: 'AAPL', value: 1800, sector: 'Technology', annualIncome: 12, growthStreak: 11 },
    { symbol: 'COST', value: 1400, sector: 'Consumer Defensive', annualIncome: 18, growthStreak: 19 },
    { symbol: 'CNR', value: 1100, sector: 'Industrials', annualIncome: 22, growthStreak: 15 },
    { symbol: 'BAM', value: 1000, sector: 'Financial Services', annualIncome: 35 },
  ];
  const rep = computePortfolioHealth(holdings, { beta: 0.95, maxDrawdown: -12 });
  assert.ok(rep.overallScore >= 85, `Expected high score >= 85, got ${rep.overallScore}`);
  assert.ok(['A', 'A+'].includes(rep.letterGrade));
  assert.ok(rep.pillars.diversification.score >= 20);
  assert.ok(rep.pillars.sectorBalance.score >= 20);
});

test('portfolioHealth: detects high concentration and flags warning', () => {
  const concentrated = [
    { symbol: 'TSLA', value: 8000, sector: 'Consumer Cyclical' },
    { symbol: 'AAPL', value: 1000, sector: 'Technology' },
  ];
  const rep = computePortfolioHealth(concentrated, { beta: 1.8 });
  assert.ok(rep.overallScore < 60, `Expected lower score for concentrated portfolio, got ${rep.overallScore}`);
  assert.ok(rep.keyFindings.some(f => f.title.includes('Single-Stock Overweight') || f.title.includes('High Asset Concentration')));
});

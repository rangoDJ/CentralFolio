import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateClosedPositions, type TransactionRecord } from './closedPositionsService.js';

test('closedPositions: empty transactions returns empty result', () => {
  const result = calculateClosedPositions([]);
  assert.equal(result.positions.length, 0);
  assert.equal(result.summary.totalRealizedGain, 0);
  assert.equal(result.summary.totalDividends, 0);
});

test('closedPositions: single buy and complete sell calculates realized gain correctly', () => {
  const txs: TransactionRecord[] = [
    {
      symbol: 'AAPL',
      type: 'BUY',
      units: 10,
      price: 150,
      amount: -1500,
      date: '2023-01-15T10:00:00Z',
      currencyCode: 'USD'
    },
    {
      symbol: 'AAPL',
      type: 'DIVIDEND',
      units: 10,
      price: 0,
      amount: 25,
      date: '2023-05-15T10:00:00Z',
      currencyCode: 'USD'
    },
    {
      symbol: 'AAPL',
      type: 'SELL',
      units: 10,
      price: 180,
      amount: 1800,
      date: '2023-08-20T10:00:00Z',
      currencyCode: 'USD'
    }
  ];

  const result = calculateClosedPositions(txs);
  assert.equal(result.positions.length, 1);
  const p = result.positions[0];
  assert.equal(p.symbol, 'AAPL');
  assert.equal(p.totalSharesSold, 10);
  assert.equal(p.costBasis, 1500);
  assert.equal(p.proceeds, 1800);
  assert.equal(p.realizedGain, 300);
  assert.equal(p.realizedGainPct, 20); // 300 / 1500 = 20%
  assert.equal(p.dividends, 25);
  assert.equal(p.totalProfit, 325); // 300 + 25 = 325
  assert.equal(p.totalRoiPct, 21.67); // 325 / 1500 = 21.67%
  assert.equal(p.openDate, '2023-01-15');
  assert.equal(p.closeDate, '2023-08-20');
  assert.equal(p.isClosed, true);
});

test('closedPositions: partial sells track realized gain per sell', () => {
  const txs: TransactionRecord[] = [
    {
      symbol: 'MSFT',
      type: 'BUY',
      units: 20,
      price: 200,
      amount: -4000,
      date: '2022-01-01T00:00:00Z',
      currencyCode: 'USD'
    },
    {
      symbol: 'MSFT',
      type: 'SELL',
      units: 10,
      price: 250,
      amount: 2500,
      date: '2022-06-01T00:00:00Z',
      currencyCode: 'USD'
    }
  ];

  const result = calculateClosedPositions(txs, { includePartiallyClosed: true });
  assert.equal(result.positions.length, 1);
  const p = result.positions[0];
  assert.equal(p.totalSharesSold, 10);
  assert.equal(p.costBasis, 2000); // 10 * 200
  assert.equal(p.proceeds, 2500); // 10 * 250
  assert.equal(p.realizedGain, 500);
  assert.equal(p.isClosed, false); // 10 shares remaining
});

test('closedPositions: summary aggregates winning and losing trades', () => {
  const txs: TransactionRecord[] = [
    // Win: AAPL +$200
    { symbol: 'AAPL', type: 'BUY', units: 10, price: 100, amount: -1000, date: '2023-01-01', currencyCode: 'USD' },
    { symbol: 'AAPL', type: 'SELL', units: 10, price: 120, amount: 1200, date: '2023-02-01', currencyCode: 'USD' },
    // Loss: TSLA -$100
    { symbol: 'TSLA', type: 'BUY', units: 5, price: 200, amount: -1000, date: '2023-01-01', currencyCode: 'USD' },
    { symbol: 'TSLA', type: 'SELL', units: 5, price: 180, amount: 900, date: '2023-02-01', currencyCode: 'USD' }
  ];

  const result = calculateClosedPositions(txs);
  assert.equal(result.positions.length, 2);
  assert.equal(result.summary.totalRealizedGain, 100); // 200 - 100 = 100
  assert.equal(result.summary.closedCount, 2);
  assert.equal(result.summary.winCount, 1);
  assert.equal(result.summary.lossCount, 1);
  assert.equal(result.summary.winRatePct, 50);
});

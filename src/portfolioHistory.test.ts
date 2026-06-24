import { test } from 'node:test';
import assert from 'node:assert';
import { reconstructPortfolioHistory, type PHTransaction, type PriceCandleLite } from './services/portfolioHistory.js';

const approx = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} expected ${b}, got ${a}`);

const ptOn = (res: ReturnType<typeof reconstructPortfolioHistory>, date: string) =>
  res.points.find(p => p.date === date)!;

test('reconstruct: single buy then hold — value follows price, invested flat', () => {
  const txns: PHTransaction[] = [
    { symbol: 'AAA', type: 'BUY', units: 10, price: 100, amount: 1000, date: '2024-01-02' },
  ];
  const prices = new Map<string, PriceCandleLite[]>([
    ['AAA', [
      { date: '2024-01-02', close: 100 },
      { date: '2024-01-03', close: 110 },
      { date: '2024-01-04', close: 90 },
    ]],
  ]);
  const res = reconstructPortfolioHistory(txns, prices);

  approx(ptOn(res, '2024-01-02').value, 1000, 'buy day value');
  approx(ptOn(res, '2024-01-03').value, 1100, 'up day value');
  approx(ptOn(res, '2024-01-04').value, 900, 'down day value');
  // Net invested stays at cost basis throughout.
  res.points.forEach(p => approx(p.invested, 1000, `invested @${p.date}`));
});

test('reconstruct: forward-fills price across a gap (weekend/holiday)', () => {
  const txns: PHTransaction[] = [
    { symbol: 'AAA', type: 'BUY', units: 1, price: 50, amount: 50, date: '2024-03-01' },
  ];
  // No candle for 03-02 / 03-03 — should reuse the 03-01 close.
  const prices = new Map<string, PriceCandleLite[]>([
    ['AAA', [
      { date: '2024-03-01', close: 50 },
      { date: '2024-03-04', close: 60 },
    ]],
  ]);
  const res = reconstructPortfolioHistory(txns, prices);
  approx(ptOn(res, '2024-03-02').value, 50, 'gap day reuses last close');
  approx(ptOn(res, '2024-03-03').value, 50, 'gap day reuses last close');
  approx(ptOn(res, '2024-03-04').value, 60, 'next traded day updates');
});

test('reconstruct: buy, add, then partial sell adjusts share count', () => {
  const txns: PHTransaction[] = [
    { symbol: 'AAA', type: 'BUY',  units: 10, price: 10, amount: 100, date: '2024-01-01' },
    { symbol: 'AAA', type: 'BUY',  units: 10, price: 20, amount: 200, date: '2024-01-03' },
    { symbol: 'AAA', type: 'SELL', units: 5,  price: 30, amount: 150, date: '2024-01-05' },
  ];
  const prices = new Map<string, PriceCandleLite[]>([
    ['AAA', [
      { date: '2024-01-01', close: 10 },
      { date: '2024-01-03', close: 20 },
      { date: '2024-01-05', close: 30 },
    ]],
  ]);
  const res = reconstructPortfolioHistory(txns, prices);

  approx(ptOn(res, '2024-01-01').value, 100, '10sh@10');
  approx(ptOn(res, '2024-01-03').value, 400, '20sh@20');
  approx(ptOn(res, '2024-01-05').value, 450, '15sh@30 after selling 5');
  // Net invested: +100 +200 -150 = 150
  approx(ptOn(res, '2024-01-05').invested, 150, 'net invested after sell');
});

test('reconstruct: benchmark mirrors contributions at index price', () => {
  const txns: PHTransaction[] = [
    { symbol: 'AAA', type: 'BUY', units: 1, price: 100, amount: 100, date: '2024-01-01' },
  ];
  const prices = new Map<string, PriceCandleLite[]>([
    ['AAA', [{ date: '2024-01-01', close: 100 }, { date: '2024-01-02', close: 100 }]],
  ]);
  // $100 invested when SPY=50 → 2 "units"; SPY doubles to 100 → benchmark=200.
  const bench = { symbol: 'SPY', series: [
    { date: '2024-01-01', close: 50 },
    { date: '2024-01-02', close: 100 },
  ] as PriceCandleLite[] };
  const res = reconstructPortfolioHistory(txns, prices, bench);

  approx(ptOn(res, '2024-01-01').benchmark!, 100, 'benchmark at buy');
  approx(ptOn(res, '2024-01-02').benchmark!, 200, 'benchmark doubles');
  assert.equal(res.summary.benchmarkEndValue, 200);
});

test('reconstruct: cash deposit and withdrawal adjust invested baseline', () => {
  const txns: PHTransaction[] = [
    { symbol: 'AAA', type: 'BUY',        units: 10, price: 10, amount: 100,  date: '2024-01-01' },
    {                type: 'DEPOSIT',    units: 0,  price: 0,  amount: 50,   date: '2024-01-02' },
    {                type: 'WITHDRAWAL', units: 0,  price: 0,  amount: 30,   date: '2024-01-03' },
  ];
  const prices = new Map<string, PriceCandleLite[]>([
    ['AAA', [{ date: '2024-01-01', close: 10 }, { date: '2024-01-03', close: 10 }]],
  ]);
  const res = reconstructPortfolioHistory(txns, prices);
  // After buy: invested = 100
  approx(ptOn(res, '2024-01-01').invested, 100, 'after buy');
  // After deposit: invested = 150
  approx(ptOn(res, '2024-01-02').invested, 150, 'after deposit');
  // After withdrawal: invested = 120
  approx(ptOn(res, '2024-01-03').invested, 120, 'after withdrawal');
  // Share count unchanged — holdings value stays at 100
  approx(ptOn(res, '2024-01-03').value, 100, 'value unaffected by cash flows');
});

test('reconstruct: TRANSFER_IN and TRANSFER_OUT treated as deposit/withdrawal', () => {
  const txns: PHTransaction[] = [
    { type: 'TRANSFER_IN',  amount: 200, date: '2024-02-01' },
    { type: 'TRANSFER_OUT', amount: 80,  date: '2024-02-02' },
  ];
  const res = reconstructPortfolioHistory(txns, new Map());
  approx(ptOn(res, '2024-02-01').invested, 200, 'transfer in');
  approx(ptOn(res, '2024-02-02').invested, 120, 'transfer out');
});

test('reconstruct: summary totals + empty input', () => {
  const empty = reconstructPortfolioHistory([], new Map());
  assert.equal(empty.points.length, 0);
  assert.equal(empty.summary.netInvested, 0);

  const res = reconstructPortfolioHistory(
    [{ symbol: 'AAA', type: 'BUY', units: 1, price: 100, amount: 100, date: '2024-01-01' }],
    new Map([['AAA', [{ date: '2024-01-01', close: 150 }]]]),
  );
  assert.equal(res.summary.netInvested, 100);
  assert.equal(res.summary.endValue, 150);
  assert.equal(res.summary.totalReturn, 50);
  approx(res.summary.totalReturnPct, 50, 'return pct');
});

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Load the actual shipped public/js/divmath.js so the tests cover the real code.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(path.join(root, 'public', 'js', 'divmath.js'), 'utf8');
const sandbox: any = { module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const DivMath = sandbox.module.exports as {
  tagDividendStatus: (events: any[], txData: any[], divTypes?: string[]) => any[];
  collectReceivedDividends: (events: any[], txData: any[], opts?: any) => any[];
  buildStockPositions: (symbol: string, ctx: any) => { rows: any[]; total: any };
  projectIncome: (params: any) => { points: any[]; summary: any };
  dividendSafety: (asset: any) => { score: number; grade: string; factors: string[] } | null;
};

const approx = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} expected ${b}, got ${a}`);
const dayOffset = (n: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };

test('tagDividendStatus: received / overdue / expected + base-symbol fallback', () => {
  const events: any[] = [
    { accountId: 'A', symbol: 'ENB.TO', frequency: 12, date: dayOffset(-35) }, // tx ~5d away -> received
    { accountId: 'A', symbol: 'ENB.TO', frequency: 12, date: dayOffset(-5) },  // past, no tx -> overdue
    { accountId: 'A', symbol: 'XYZ.TO', frequency: 4, date: dayOffset(20) },   // future -> expected
    { accountId: 'A', symbol: 'BAS', frequency: 4, date: dayOffset(-10) },     // base-symbol match -> received
  ];
  const txData = [{
    accountId: 'A', transactions: [
      { type: 'DIVIDEND', symbol: 'ENB.TO', date: dayOffset(-30), amount: -12.34 },
      { type: 'Distribution', symbol: 'BAS.TO', date: dayOffset(-12), amount: 9.5 },
      { type: 'BUY', symbol: 'ENB.TO', date: dayOffset(-5), amount: -100 }, // not a dividend → ignored
    ],
  }];

  DivMath.tagDividendStatus(events, txData);
  assert.deepEqual(events.map(e => e._status), ['received', 'overdue', 'expected', 'received']);
  approx(events[0]._recvAmount, 12.34, 'received amount uses abs(txn.amount)');
});

test('tagDividendStatus: monthly payer does not match an adjacent month', () => {
  // freq 12 → tolerance ~13.7d; a tx 25 days from the event must NOT match.
  const events: any[] = [{ accountId: 'A', symbol: 'HMAX.TO', frequency: 12, date: dayOffset(-40) }];
  const txData = [{ accountId: 'A', transactions: [{ type: 'DIVIDEND', symbol: 'HMAX.TO', date: dayOffset(-15), amount: 5 }] }];
  DivMath.tagDividendStatus(events, txData);
  assert.equal(events[0]._status, 'overdue');
});

test('buildStockPositions: per-account + aggregate math', () => {
  const ctx = {
    holdings: [
      { accountId: 'A', accountName: 'TFSA', holdings: [{ symbol: 'ENB.TO', units: 100, price: 50, marketValue: 5000, average_purchase_price: 40, currency: 'CAD' }] },
      { accountId: 'B', accountName: 'RRSP', holdings: [{ symbol: 'ENB.TO', units: 50, price: 50, marketValue: 2500, average_purchase_price: 60, currency: 'CAD' }] },
      { accountId: 'B', accountName: 'RRSP', holdings: [{ symbol: 'OTHER.TO', units: 10, price: 1, marketValue: 10, average_purchase_price: 1, currency: 'CAD' }] },
    ],
    txData: [
      { accountId: 'A', transactions: [{ type: 'DIVIDEND', symbol: 'ENB.TO', amount: -30 }, { type: 'DIVIDEND', symbol: 'ENB.TO', amount: 20 }] },
      { accountId: 'B', transactions: [{ type: 'DIVIDEND', symbol: 'ENB.TO', amount: 15 }] },
    ],
    groups: [{ accounts: [{ id: 'A', balance: { total: { amount: 10000 } } }, { id: 'B', balance: { total: { amount: 5000 } } }] }],
    inactiveIds: new Set<string>(),
  };

  const { rows, total } = DivMath.buildStockPositions('ENB.TO', ctx);
  assert.equal(rows.length, 2, 'only ENB.TO positions, OTHER.TO excluded');

  const a = rows.find(r => r.accountId === 'A');
  approx(a.cost, 4000); approx(a.capitalGain, 1000); approx(a.capitalGainPct, 25);
  approx(a.dividends, 50, 'abs(-30)+abs(20)'); approx(a.profit, 1050); approx(a.profitPct, 26.25);
  approx(a.pctInPortfolio, 50, '5000 / 10000');

  const b = rows.find(r => r.accountId === 'B');
  approx(b.capitalGain, -500, '2500 - 3000'); approx(b.dividends, 15); approx(b.profit, -485);
  approx(b.pctInPortfolio, 50, '2500 / 5000');

  approx(total.units, 150); approx(total.value, 7500); approx(total.cost, 7000);
  approx(total.capitalGain, 500); approx(total.dividends, 65); approx(total.profit, 565);
  approx(total.avgCost, 7000 / 150);
});

test('collectReceivedDividends: backfills unmatched past payouts within the window', () => {
  const events: any[] = [{ accountId: 'A', symbol: 'ENB.TO', frequency: 12, date: dayOffset(10) }]; // future expected
  const txData = [{
    accountId: 'A', transactions: [
      { type: 'DIVIDEND', symbol: 'ENB.TO', date: dayOffset(8), amount: -21 },    // matches the forecast event → consumed
      { type: 'DIVIDEND', symbol: 'ENB.TO', date: dayOffset(-150), amount: -20 }, // ~5mo ago, no match → backlog
      { type: 'DIVIDEND', symbol: 'ENB.TO', date: dayOffset(-240), amount: -18 }, // ~8mo ago → outside 6mo window
      { type: 'BUY', symbol: 'ENB.TO', date: dayOffset(-100), amount: -500 },     // not a dividend → ignored
    ],
  }];

  const received = DivMath.collectReceivedDividends(events, txData, { monthsBack: 6 });
  assert.equal(events[0]._status, 'received', 'forecast event consumed the near-dated txn');
  assert.equal(received.length, 1, 'only the unmatched in-window payout is backfilled');
  assert.equal(received[0].symbol, 'ENB.TO');
  approx(received[0].amount, 20);
  assert.equal(received[0]._status, 'received');
  assert.equal(received[0]._fromTxn, true);
});

test('buildStockPositions: inactive accounts excluded', () => {
  const ctx = {
    holdings: [{ accountId: 'A', accountName: 'TFSA', holdings: [{ symbol: 'ENB.TO', units: 100, price: 50, marketValue: 5000, average_purchase_price: 40 }] }],
    txData: [],
    groups: [{ accounts: [{ id: 'A', balance: { total: { amount: 10000 } } }] }],
    inactiveIds: new Set(['A']),
  };
  const { rows, total } = DivMath.buildStockPositions('ENB.TO', ctx);
  assert.equal(rows.length, 0);
  assert.equal(total, null);
});

test('projectIncome: no growth/contrib/DRIP keeps income flat', () => {
  const { points, summary } = DivMath.projectIncome({
    currentValue: 100000, currentIncome: 4000, annualContribution: 0,
    dividendGrowthRate: 0, priceGrowthRate: 0, reinvest: false, years: 5,
  });
  assert.equal(points.length, 6); // year 0..5
  points.forEach(p => approx(p.income, 4000, `income @${p.year}`));
  approx(summary.baseYield, 0.04, 'base yield');
  assert.equal(summary.yearsToTarget, null);
});

test('projectIncome: dividend growth compounds income', () => {
  const { points } = DivMath.projectIncome({
    currentValue: 100000, currentIncome: 1000, annualContribution: 0,
    dividendGrowthRate: 10, priceGrowthRate: 0, reinvest: false, years: 3,
  });
  approx(points[1].income, 1100, 'y1 +10%');
  approx(points[2].income, 1210, 'y2 +10%');
  approx(points[3].income, 1331, 'y3 +10%');
});

test('projectIncome: contributions add income at base yield', () => {
  const { points } = DivMath.projectIncome({
    currentValue: 100000, currentIncome: 5000, annualContribution: 10000,
    dividendGrowthRate: 0, priceGrowthRate: 0, reinvest: false, years: 1,
  });
  // base yield = 5%; +$10k → +$500 income; existing $5000 unchanged (0% DGR).
  approx(points[1].income, 5500, 'income after contribution');
  approx(points[1].value, 110000, 'value after contribution');
  approx(points[1].contributions, 10000, 'contributions tracked');
});

test('projectIncome: DRIP reinvests dividends into value', () => {
  const { points } = DivMath.projectIncome({
    currentValue: 100000, currentIncome: 5000, annualContribution: 0,
    dividendGrowthRate: 0, priceGrowthRate: 0, reinvest: true, years: 1,
  });
  // DRIP: value += income (105000); income += income*yield (5000 + 250 = 5250).
  approx(points[1].value, 105000, 'value after DRIP');
  approx(points[1].income, 5250, 'income after DRIP');
});

test('dividendSafety: non-payer returns null', () => {
  assert.equal(DivMath.dividendSafety({ annualPayout: 0, dividendYield: 0 }), null);
  assert.equal(DivMath.dividendSafety(null), null);
});

test('dividendSafety: long streak + healthy growth grades high', () => {
  const r = DivMath.dividendSafety({ annualPayout: 2, dividendYield: 3, growthStreak: 25, growth5Y: 8, frequency: 4 })!;
  // 50 + 25 (streak) + 15 (growth) + 10 (yield) + 5 (freq) = 105 → clamp 100 → A
  assert.equal(r.score, 100);
  assert.equal(r.grade, 'A');
});

test('dividendSafety: a cut tanks the grade', () => {
  const r = DivMath.dividendSafety({ annualPayout: 1, dividendYield: 5, growthStreak: 0, growth5Y: -10, frequency: 4 })!;
  // 50 - 25 (cut) + 10 (yield) + 5 (freq) = 40 → D
  assert.equal(r.score, 40);
  assert.equal(r.grade, 'D');
  assert.ok(r.factors.some(f => /cut/i.test(f)));
});

test('dividendSafety: yield trap penalized', () => {
  const r = DivMath.dividendSafety({ annualPayout: 3, dividendYield: 15, growthStreak: 0, growth5Y: 0, frequency: 4 })!;
  // 50 - 25 (very high yield) + 5 (freq) = 30 → F
  assert.equal(r.grade, 'F');
  assert.ok(r.factors.some(f => /high yield/i.test(f)));
});

test('projectIncome: reports years to reach target income', () => {
  const { summary } = DivMath.projectIncome({
    currentValue: 100000, currentIncome: 1000, annualContribution: 0,
    dividendGrowthRate: 10, priceGrowthRate: 0, reinvest: false, years: 30,
    targetAnnualIncome: 2000,
  });
  // 1000 × 1.1^n ≥ 2000 → n = 8 (1.1^8 ≈ 2.1436).
  assert.equal(summary.yearsToTarget, 8);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  recordCashTransaction,
  getCashTransactions,
  removeCashTransaction,
  computeCashSummary
} from "./cashLedgerService.js";

test("cash ledger deposits, withdrawals, FX conversions and summary", () => {
  const pId = 99999;

  const d1 = recordCashTransaction({
    portfolioId: pId,
    type: 'deposit',
    amount: 5000,
    currency: 'CAD',
    date: '2026-01-01',
    note: 'Initial funding'
  });

  const d2 = recordCashTransaction({
    portfolioId: pId,
    type: 'fx_convert',
    amount: 1000,
    currency: 'CAD',
    targetAmount: 750,
    targetCurrency: 'USD',
    exchangeRate: 1.3333,
    date: '2026-01-15',
    note: 'Convert CAD to USD'
  });

  const d3 = recordCashTransaction({
    portfolioId: pId,
    type: 'interest',
    amount: 15.50,
    currency: 'CAD',
    date: '2026-01-31'
  });

  const txs = getCashTransactions({ portfolioId: pId });
  assert.equal(txs.length, 3);

  const summary = computeCashSummary({ portfolioId: pId, baseCurrency: 'CAD' });
  assert.equal(summary.balancesByCurrency['CAD'], 4015.50);
  assert.equal(summary.balancesByCurrency['USD'], 750);
  assert.equal(summary.totalDeposited, 5000);
  assert.equal(summary.totalInterest, 15.50);

  // Clean up
  removeCashTransaction(d1.id);
  removeCashTransaction(d2.id);
  removeCashTransaction(d3.id);

  const txsAfter = getCashTransactions({ portfolioId: pId });
  assert.equal(txsAfter.length, 0);
});

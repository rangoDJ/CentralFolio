import {
  listCashTransactions,
  createCashTransaction,
  deleteCashTransaction,
  type CashTransactionRecord
} from "../repositories/cashTransactionRepository.js";
import { getLatestRate } from "./fxService.js";

export type { CashTransactionRecord };

export function getCashTransactions(options?: {
  portfolioId?: number;
  accountId?: string;
  currency?: string;
}): CashTransactionRecord[] {
  return listCashTransactions(options);
}

export function recordCashTransaction(data: {
  portfolioId?: number | null;
  accountId?: string | null;
  type: 'deposit' | 'withdrawal' | 'fx_convert' | 'interest' | 'fee' | 'dividend_cash' | 'adjustment';
  amount: number;
  currency: string;
  targetAmount?: number | null;
  targetCurrency?: string | null;
  exchangeRate?: number | null;
  date: string;
  note?: string | null;
  doNotAdjust?: boolean;
}): CashTransactionRecord {
  if (!data.type || data.amount == null || !data.currency || !data.date) {
    throw new Error("Missing required cash transaction fields: type, amount, currency, date.");
  }
  return createCashTransaction(data);
}

export function removeCashTransaction(id: number): boolean {
  return deleteCashTransaction(id);
}

export interface CashSummary {
  balancesByCurrency: Record<string, number>;
  totalCashInBase: number;
  baseCurrency: string;
  totalDeposited: number;
  totalWithdrawn: number;
  netInflow: number;
  totalInterest: number;
  totalFees: number;
}

export function computeCashSummary(options?: {
  portfolioId?: number;
  accountId?: string;
  baseCurrency?: string;
}): CashSummary {
  const baseCurrency = (options?.baseCurrency ?? "CAD").toUpperCase();
  const txs = listCashTransactions(options);

  const balances: Record<string, number> = {};
  let totalDeposited = 0;
  let totalWithdrawn = 0;
  let totalInterest = 0;
  let totalFees = 0;

  for (const tx of txs) {
    if (tx.doNotAdjust === 1) continue;
    const c = tx.currency.toUpperCase();
    if (!balances[c]) balances[c] = 0;

    switch (tx.type) {
      case 'deposit':
        balances[c] += tx.amount;
        totalDeposited += tx.amount;
        break;
      case 'withdrawal':
        balances[c] -= tx.amount;
        totalWithdrawn += tx.amount;
        break;
      case 'interest':
        balances[c] += tx.amount;
        totalInterest += tx.amount;
        break;
      case 'fee':
        balances[c] -= tx.amount;
        totalFees += tx.amount;
        break;
      case 'dividend_cash':
        balances[c] += tx.amount;
        break;
      case 'adjustment':
        balances[c] += tx.amount;
        break;
      case 'fx_convert':
        balances[c] -= tx.amount;
        if (tx.targetCurrency && tx.targetAmount != null) {
          const tc = tx.targetCurrency.toUpperCase();
          if (!balances[tc]) balances[tc] = 0;
          balances[tc] += tx.targetAmount;
        }
        break;
    }
  }

  let totalCashInBase = 0;
  for (const [curr, amt] of Object.entries(balances)) {
    if (curr === baseCurrency) {
      totalCashInBase += amt;
    } else {
      const rate = getLatestRate(curr, baseCurrency);
      totalCashInBase += amt * (rate || 1);
    }
  }

  return {
    balancesByCurrency: balances,
    totalCashInBase: Math.round(totalCashInBase * 100) / 100,
    baseCurrency,
    totalDeposited: Math.round(totalDeposited * 100) / 100,
    totalWithdrawn: Math.round(totalWithdrawn * 100) / 100,
    netInflow: Math.round((totalDeposited - totalWithdrawn) * 100) / 100,
    totalInterest: Math.round(totalInterest * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100
  };
}

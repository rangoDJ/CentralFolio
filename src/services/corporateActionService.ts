import {
  listCorporateActions,
  createCorporateAction,
  deleteCorporateAction,
  getCorporateActionsForSymbols,
  type CorporateActionRecord
} from "../repositories/corporateActionRepository.js";

export type { CorporateActionRecord };

export function getAllCorporateActions(symbol?: string): CorporateActionRecord[] {
  return listCorporateActions(symbol);
}

export function addCorporateAction(data: {
  symbol: string;
  eventType: 'split' | 'reverse_split' | 'spinoff' | 'merger' | 'ticker_change';
  ratio: number;
  date: string;
  spinoffSymbol?: string | null;
  notes?: string | null;
}): CorporateActionRecord {
  if (!data.symbol || !data.date || !data.ratio || data.ratio <= 0) {
    throw new Error("Invalid corporate action parameters: symbol, date, and positive ratio required.");
  }
  return createCorporateAction(data);
}

export function removeCorporateAction(id: number): boolean {
  return deleteCorporateAction(id);
}

/**
 * Adjusts historical transactions for corporate actions (splits, reverse splits).
 * If a transaction date is before the split date, units are multiplied by ratio,
 * and cost per share is divided by ratio.
 */
export function applyCorporateActionsToTransactions<T extends { symbol?: string | null; date?: string | Date | null; units?: number | null; price?: number | null }>(
  transactions: T[]
): T[] {
  if (!transactions || transactions.length === 0) return [];

  const symbols = Array.from(new Set(transactions.map(t => (t.symbol ?? "").toUpperCase()).filter(Boolean)));
  if (symbols.length === 0) return transactions;

  const actions = getCorporateActionsForSymbols(symbols);
  if (actions.length === 0) return transactions;

  return transactions.map(tx => {
    if (!tx.symbol || !tx.date) return tx;
    const sym = tx.symbol.toUpperCase();
    const txDateStr = typeof tx.date === 'string' ? tx.date.slice(0, 10) : (tx.date as Date).toISOString().slice(0, 10);
    
    // Find all splits that happened AFTER this transaction
    const applicableActions = actions.filter(a => 
      a.symbol === sym && 
      (a.eventType === 'split' || a.eventType === 'reverse_split') &&
      a.date > txDateStr
    );

    if (applicableActions.length === 0) return tx;

    let totalRatio = 1;
    for (const a of applicableActions) {
      totalRatio *= a.ratio;
    }

    const units = tx.units != null ? tx.units * totalRatio : tx.units;
    const price = tx.price != null && totalRatio !== 0 ? tx.price / totalRatio : tx.price;

    return {
      ...tx,
      units,
      price,
      splitAdjustedRatio: totalRatio
    };
  });
}

import { logger } from "../utils/logger.js";

export interface RebalanceAsset {
  symbol: string;
  currentVal: number;
  currentPct: number;
  targetPct: number;
  deviation: number;
  targetVal: number;
}

export interface RebalanceTrade {
  symbol: string;
  action: 'BUY' | 'SELL';
  amount: number; // target allocation amount in currency units
}

export interface RebalanceResult {
  assets: RebalanceAsset[];
  trades: RebalanceTrade[];
  totalValue: number;
  cash: number;
}

export interface SmartDepositTrade {
  symbol: string;
  recommendedAmount: number;
  price?: number;
  suggestedShares?: number;
  estimatedCost?: number;
  currentPct: number;
  projectedPct: number;
  targetPct: number;
}

export interface SmartDepositResult {
  depositAmount: number;
  allocatedAmount: number;
  remainingCash: number;
  projectedTotalValue: number;
  trades: SmartDepositTrade[];
}

/**
 * Calculates suggested trades to align actual holdings with target allocations.
 *
 * @param positions - List of current holdings/positions with symbol and marketValue
 * @param cash - Current cash balance in the account
 * @param targets - Target allocations (symbol and targetPct in the range [0, 1])
 * @param mode - Rebalancing mode: 'buy_only' (purchase underweight using cash) or 'full' (sell overweight, buy underweight)
 */
export function computeRebalance(
  positions: { symbol: string; marketValue: number }[],
  cash: number,
  targets: { symbol: string; targetPct: number }[],
  mode: 'buy_only' | 'full' = 'buy_only'
): RebalanceResult {
  logger.info('Rebalance', `Computing rebalance using mode=${mode} (cash=${cash}, positionsCount=${positions.length}, targetsCount=${targets.length})`);

  // Calculate total portfolio value (securities market value + cash)
  const securitiesVal = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
  const totalValue = securitiesVal + cash;

  // Aggregate current market values by symbol (positions might contain duplicates)
  const currentValues: Record<string, number> = {};
  positions.forEach(p => {
    if (p.symbol) {
      currentValues[p.symbol] = (currentValues[p.symbol] || 0) + (p.marketValue || 0);
    }
  });

  const assets: RebalanceAsset[] = [];
  const trades: RebalanceTrade[] = [];

  // Generate union of target symbols and currently held symbols
  const targetSymbols = targets.map(t => t.symbol.toUpperCase());
  const heldSymbols = Object.keys(currentValues);
  const allSymbols = Array.from(new Set([...targetSymbols, ...heldSymbols]));

  const targetMap = new Map(targets.map(t => [t.symbol.toUpperCase(), t.targetPct]));

  allSymbols.forEach(symbol => {
    const targetPct = targetMap.get(symbol) || 0;
    const currentVal = currentValues[symbol] || 0;
    const currentPct = totalValue > 0 ? (currentVal / totalValue) : 0;
    const targetVal = totalValue * targetPct;

    assets.push({
      symbol,
      currentVal,
      currentPct,
      targetPct,
      deviation: currentPct - targetPct,
      targetVal
    });
  });

  if (mode === 'full') {
    // SELL overweight assets and BUY underweight assets to bring them directly to targets
    assets.forEach(a => {
      const diff = a.targetVal - a.currentVal;
      // Filter out tiny dust trades (e.g. less than $5) to prevent transaction fee waste
      if (Math.abs(diff) > 5) {
        if (diff < 0) {
          trades.push({ symbol: a.symbol, action: 'SELL', amount: Math.abs(diff) });
        } else if (diff > 0) {
          trades.push({ symbol: a.symbol, action: 'BUY', amount: diff });
        }
      }
    });
  } else {
    // BUY ONLY: Allocate available cash to underweight assets proportional to their deficit
    const underweight = assets
      .filter(a => a.targetVal > a.currentVal)
      .map(a => ({ symbol: a.symbol, deficit: a.targetVal - a.currentVal }));

    const totalDeficit = underweight.reduce((sum, u) => sum + u.deficit, 0);

    if (totalDeficit > 0 && cash > 0) {
      // Scale purchases down if we have less cash than total deficit
      const cashToSpend = Math.min(cash, totalDeficit);
      underweight.forEach(u => {
        const alloc = (u.deficit / totalDeficit) * cashToSpend;
        if (alloc > 5) {
          trades.push({ symbol: u.symbol, action: 'BUY', amount: alloc });
        }
      });
    }
  }

  logger.info('Rebalance', `Rebalance calculation finished (generated ${trades.length} suggestion(s))`);
  return {
    assets,
    trades,
    totalValue,
    cash
  };
}

/**
 * Snowball Analytics-style Smart Deposit Calculator.
 * Allocates an incoming cash deposit to underweight target positions without selling any holdings.
 */
export function calculateSmartDeposit(
  positions: { symbol: string; marketValue: number; price?: number }[],
  depositAmount: number,
  targets: { symbol: string; targetPct: number }[]
): SmartDepositResult {
  const deposit = Math.max(0, Number(depositAmount) || 0);
  const currentValBySym: Record<string, number> = {};
  const priceBySym: Record<string, number> = {};

  let currentTotal = 0;
  for (const p of positions) {
    if (!p.symbol) continue;
    const s = p.symbol.toUpperCase().trim();
    currentValBySym[s] = (currentValBySym[s] || 0) + (p.marketValue || 0);
    currentTotal += (p.marketValue || 0);
    if (p.price && p.price > 0) priceBySym[s] = p.price;
  }

  const projectedTotal = currentTotal + deposit;
  const targetMap = new Map(targets.map(t => [t.symbol.toUpperCase().trim(), t.targetPct]));

  // Calculate deficit for each target ticker
  const targetHoldings = targets.map(t => {
    const sym = t.symbol.toUpperCase().trim();
    const curVal = currentValBySym[sym] || 0;
    const tgtVal = projectedTotal * t.targetPct;
    const deficit = Math.max(0, tgtVal - curVal);
    return {
      symbol: sym,
      targetPct: t.targetPct,
      currentVal: curVal,
      targetVal: tgtVal,
      deficit,
      price: priceBySym[sym],
    };
  });

  const totalDeficit = targetHoldings.reduce((sum, h) => sum + h.deficit, 0);
  const allocBySym: Record<string, number> = {};

  if (totalDeficit <= 0) {
    // Already balanced: allocate deposit proportionally to target weights
    for (const h of targetHoldings) {
      allocBySym[h.symbol] = deposit * h.targetPct;
    }
  } else if (deposit >= totalDeficit) {
    // We have enough cash to satisfy all deficits, and distribute remaining cash
    const surplus = deposit - totalDeficit;
    for (const h of targetHoldings) {
      allocBySym[h.symbol] = h.deficit + (surplus * h.targetPct);
    }
  } else {
    // Deposit is less than total deficit: allocate proportionally to deficits
    for (const h of targetHoldings) {
      allocBySym[h.symbol] = (h.deficit / totalDeficit) * deposit;
    }
  }

  const trades: SmartDepositTrade[] = [];
  let totalAllocated = 0;

  for (const h of targetHoldings) {
    const recAmount = Math.round((allocBySym[h.symbol] || 0) * 100) / 100;
    if (recAmount <= 0) continue;

    let suggestedShares: number | undefined;
    let estimatedCost: number | undefined;

    if (h.price && h.price > 0) {
      suggestedShares = Math.max(0, Math.floor(recAmount / h.price));
      estimatedCost = Math.round(suggestedShares * h.price * 100) / 100;
    }

    const actualAlloc = estimatedCost !== undefined && estimatedCost > 0 ? estimatedCost : recAmount;
    totalAllocated += actualAlloc;

    const currentPct = currentTotal > 0 ? (h.currentVal / currentTotal) * 100 : 0;
    const projectedVal = h.currentVal + actualAlloc;
    const projectedPct = projectedTotal > 0 ? (projectedVal / projectedTotal) * 100 : 0;

    trades.push({
      symbol: h.symbol,
      recommendedAmount: recAmount,
      price: h.price,
      suggestedShares,
      estimatedCost,
      currentPct: Math.round(currentPct * 10) / 10,
      projectedPct: Math.round(projectedPct * 10) / 10,
      targetPct: Math.round(h.targetPct * 1000) / 10,
    });
  }

  // Sort trades by recommended amount descending
  trades.sort((a, b) => b.recommendedAmount - a.recommendedAmount);

  const remainingCash = Math.max(0, Math.round((deposit - totalAllocated) * 100) / 100);

  return {
    depositAmount: deposit,
    allocatedAmount: Math.round(totalAllocated * 100) / 100,
    remainingCash,
    projectedTotalValue: Math.round(projectedTotal * 100) / 100,
    trades,
  };
}

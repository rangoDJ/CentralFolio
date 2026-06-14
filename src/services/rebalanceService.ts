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

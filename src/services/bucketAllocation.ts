/**
 * How a bucket's cash is divided between its symbols.
 *
 * Kept free of database and network access so the money maths can be tested
 * directly — this is the part where a mistake spends real money on the wrong
 * thing.
 */

import type { BucketItem, SplitMode } from "../repositories/bucketRepository.js";

/**
 * The smallest order most brokers will take. Wealthsimple's fractional
 * minimum is $1; an allocation under it is flagged in the preview rather than
 * dropped, because whether to place it anyway is the user's call.
 */
export const MIN_NOTIONAL = 1;

export interface Allocation {
  symbol: string;
  name: string | null;
  /** Percent of the bucket this symbol takes. */
  weight: number;
  /** Cash for this symbol, in the account's currency. */
  amount: number;
  belowMinimum: boolean;
}

/**
 * Round down to whole cents.
 *
 * Always down, never nearest: the bucket's cash value is a ceiling the user
 * set, and rounding up would quietly spend more than they asked for. The
 * leftover fraction of a cent simply goes unspent.
 */
export function floorCents(value: number): number {
  return Math.floor((value + Number.EPSILON) * 100) / 100;
}

/**
 * Split `cashValue` across `items`, either equally or by each item's weight.
 *
 * The returned amounts always sum to at most `cashValue`.
 */
export function allocateBucket(
  items: BucketItem[],
  cashValue: number,
  splitMode: SplitMode,
): Allocation[] {
  if (items.length === 0 || !(cashValue > 0)) return [];

  const weighted = splitMode === "weighted";
  const totalWeight = weighted
    ? items.reduce((sum, i) => sum + (i.weight ?? 0), 0)
    : 0;

  return items.map(item => {
    // An equal split is just every symbol carrying the same weight. Weights are
    // normalized by their own total rather than assumed to be 100, so a bucket
    // stored with weights that drifted still divides the full cash value.
    const weight = weighted
      ? (totalWeight > 0 ? ((item.weight ?? 0) / totalWeight) * 100 : 0)
      : 100 / items.length;
    const amount = floorCents((cashValue * weight) / 100);
    return {
      symbol: item.symbol,
      name: item.name ?? null,
      weight,
      amount,
      belowMinimum: amount < MIN_NOTIONAL,
    };
  });
}

/** Total actually allocated, which can sit a cent or two under the cash value. */
export function allocatedTotal(allocations: Allocation[]): number {
  return floorCents(allocations.reduce((sum, a) => sum + a.amount, 0));
}

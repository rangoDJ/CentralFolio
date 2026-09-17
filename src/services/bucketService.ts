import { getCachedAccounts, listPortfolios, getActiveAccountIds } from "../models/db.js";
import { getPriceHistory } from "../repositories/priceHistoryRepository.js";
import { getProfile } from "../repositories/assetProfileRepository.js";
import { accountDisplayName } from "../utils/accountName.js";
import { allocateBucket, allocatedTotal, MIN_NOTIONAL, type Allocation } from "./bucketAllocation.js";
import type { Bucket } from "../repositories/bucketRepository.js";

/**
 * Turning a bucket into a concrete list of orders, per account.
 *
 * The cash value is per account, not shared between them: running a $250
 * bucket into two accounts places $250 in each. That is what "run this bucket
 * in my TFSA and my RRSP" means, and the preview states the grand total so the
 * multiplication is never a surprise.
 */

export interface BucketOrderRow extends Allocation {
  /** Last cached close, used only for the share estimate shown in the preview. */
  price: number | null;
  estimatedShares: number | null;
}

export interface BucketAccountPlan {
  portfolioId: string;
  accountId: string;
  accountName: string;
  currency: string;
  cash: number | null;
  cashSyncedAt: string | null;
  orders: BucketOrderRow[];
  total: number;
  /** How far the account's cash falls short of the total, or 0. */
  shortfall: number;
  tradingEnabled: boolean;
}

export interface BucketPlan {
  bucketId: number;
  name: string;
  splitMode: string;
  cashValue: number;
  accounts: BucketAccountPlan[];
  orderCount: number;
  grandTotal: number;
  belowMinimumCount: number;
  minNotional: number;
  /** Blocking problems — the run is refused while any of these stand. */
  errors: string[];
  /** Non-blocking notes shown alongside the preview. */
  warnings: string[];
}

function latestClose(symbol: string): number | null {
  const candles = getPriceHistory(symbol);
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].close != null) return candles[i].close;
  }
  return null;
}

/** accountId → the account row plus which connection it belongs to. */
function indexAccounts() {
  const index = new Map<string, { account: any; portfolioId: string; tradingEnabled: boolean }>();
  for (const portfolio of listPortfolios()) {
    for (const account of getCachedAccounts(portfolio.id!)) {
      index.set(account.id, {
        account,
        portfolioId: String(portfolio.id),
        tradingEnabled: !!portfolio.tradingEnabled,
      });
    }
  }
  return index;
}

/**
 * Work out every order a run would place, without placing anything.
 *
 * This is what the confirmation screen renders and what the execute step
 * re-derives — the page never gets to hand back a list of orders of its own.
 */
export function planBucketRun(
  bucket: Bucket,
  targets: { portfolioId: string; accountId: string }[],
  cashValue: number,
): BucketPlan {
  const allocations = allocateBucket(bucket.items, cashValue, bucket.splitMode);
  const priced: BucketOrderRow[] = allocations.map(a => {
    const price = latestClose(a.symbol);
    return {
      ...a,
      name: a.name ?? getProfile(a.symbol)?.name ?? null,
      price,
      estimatedShares: price && price > 0 ? a.amount / price : null,
    };
  });

  const index = indexAccounts();
  const activeIds = getActiveAccountIds();
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const accounts: BucketAccountPlan[] = [];

  for (const target of targets) {
    if (seen.has(target.accountId)) continue;   // same account picked twice
    seen.add(target.accountId);

    const entry = index.get(target.accountId);
    if (!entry) {
      errors.push(`Account ${target.accountId} was not found.`);
      continue;
    }
    if (entry.portfolioId !== String(target.portfolioId)) {
      errors.push(`Account ${target.accountId} does not belong to the connection it was sent with.`);
      continue;
    }
    if (!activeIds.has(target.accountId)) {
      errors.push(`"${accountDisplayName(entry.account)}" is disabled.`);
      continue;
    }

    const total = allocatedTotal(priced);
    const cash = entry.account.balance?.cash?.amount ?? entry.account.cashBalance ?? null;
    if (!entry.tradingEnabled) {
      errors.push(`Trading is not enabled on the connection for "${accountDisplayName(entry.account)}".`);
    }
    // The user asked for a short account to stop the run rather than warn. The
    // figure is the last synced balance, so the message says as much and the
    // page offers a refresh instead of leaving them stuck on a stale number.
    const shortfall = cash != null && cash < total ? Math.round((total - cash) * 100) / 100 : 0;
    if (shortfall > 0) {
      errors.push(
        `"${accountDisplayName(entry.account)}" has ${cash!.toFixed(2)} ${entry.account.currency || ""}`.trim() +
        ` in cash but the bucket needs ${total.toFixed(2)} — short by ${shortfall.toFixed(2)}.`
      );
    }
    if (cash == null) {
      warnings.push(`No cash balance cached for "${accountDisplayName(entry.account)}" — its balance could not be checked.`);
    }

    accounts.push({
      portfolioId: entry.portfolioId,
      accountId: target.accountId,
      accountName: accountDisplayName(entry.account),
      currency: entry.account.currency || "USD",
      cash,
      cashSyncedAt: entry.account.cachedAt ?? null,
      orders: priced,
      total,
      shortfall,
      tradingEnabled: entry.tradingEnabled,
    });
  }

  const belowMinimumCount = priced.filter(o => o.belowMinimum).length * accounts.length;
  if (belowMinimumCount > 0) {
    warnings.push(
      `${belowMinimumCount} order${belowMinimumCount === 1 ? "" : "s"} fall below the ${MIN_NOTIONAL} minimum most brokers accept and will likely be rejected.`
    );
  }
  const missingPrice = priced.filter(o => o.price == null).length;
  if (missingPrice > 0) {
    warnings.push(`${missingPrice} symbol${missingPrice === 1 ? " has" : "s have"} no cached price, so the share estimate is unavailable.`);
  }

  return {
    bucketId: bucket.id,
    name: bucket.name,
    splitMode: bucket.splitMode,
    cashValue,
    accounts,
    orderCount: priced.length * accounts.length,
    grandTotal: Math.round(accounts.reduce((sum, a) => sum + a.total, 0) * 100) / 100,
    belowMinimumCount,
    minNotional: MIN_NOTIONAL,
    errors,
    warnings,
  };
}

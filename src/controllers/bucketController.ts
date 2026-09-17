import { Request, Response } from "express";
import { randomUUID } from "crypto";
import {
  listBuckets, getBucket, createBucket, updateBucket, deleteBucket,
} from "../repositories/bucketRepository.js";
import { getPortfolio, accountBelongsToPortfolio } from "../models/db.js";
import { placeBrokerageOrder } from "../services/orderPlacement.js";
import { planBucketRun, type BucketPlan } from "../services/bucketService.js";
import { refreshAccountBalances } from "../services/accountBalanceService.js";
import { checkOrderCash } from "../services/cashCheck.js";
import { ensureProfile } from "../services/assetProfileService.js";
import { syncSymbol } from "../services/priceHistoryService.js";
import { logger } from "../utils/logger.js";
import { isPortfolioConnected } from "../utils/snapTradeKeyType.js";
import { snapTradeError } from "../utils/snapTradeError.js";
import type { BucketInput, SplitMode } from "../repositories/bucketRepository.js";

/**
 * The validated body, restated explicitly.
 *
 * `validateBody` has already parsed and normalized it, but this project
 * compiles with `strict: false`, under which zod infers a transform chain's
 * output as optional — so the schema's own inferred type cannot be handed
 * straight to a function expecting required fields.
 */
interface ValidatedBucketBody {
  name: string;
  splitMode: SplitMode;
  items: Array<{ symbol: string; name: string | null; weight: number | null }>;
}

interface ValidatedRunBody {
  accounts: Array<{ portfolioId: string; accountId: string }>;
  cashValue: number;
  allowBelowMinimum?: boolean;
  refreshBalances?: boolean;
}

const toBucketInput = (body: ValidatedBucketBody): BucketInput => ({
  name: body.name,
  splitMode: body.splitMode,
  items: body.items.map(i => ({ symbol: i.symbol, name: i.name ?? null, weight: i.weight ?? null })),
});

/**
 * Buy buckets — several market orders placed together from one cash amount.
 *
 * A run is staged then confirmed, the same two-step the single-order endpoint
 * uses: a batch of live orders must never be the result of one request. The
 * staged plan is recomputed server-side and stored under the token, so the
 * confirming request cannot substitute different symbols or amounts.
 */

const CONFIRM_TTL_MS = 120_000;
const pendingRuns = new Map<string, { plan: BucketPlan; expiresAt: number }>();

function prunePendingRuns(now: number) {
  for (const [token, run] of pendingRuns) {
    if (now > run.expiresAt) pendingRuns.delete(token);
  }
}

export const listBucketsHandler = (_req: Request, res: Response) => {
  res.json(listBuckets());
};

export const createBucketHandler = async (req: Request, res: Response) => {
  const body = req.body as ValidatedBucketBody;
  const bucket = createBucket(toBucketInput(body));
  void warmSymbols(body.items.map(i => i.symbol));
  res.status(201).json(bucket);
};

export const updateBucketHandler = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as ValidatedBucketBody;
  const bucket = updateBucket(id, toBucketInput(body));
  if (!bucket) return res.status(404).json({ error: "Bucket not found" });
  void warmSymbols(body.items.map(i => i.symbol));
  res.json(bucket);
};

export const deleteBucketHandler = (req: Request, res: Response) => {
  const ok = deleteBucket(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: "Bucket not found" });
  res.json({ success: true });
};

/**
 * Fetch the company name and price history for newly added symbols.
 *
 * Fire-and-forget: the bucket is already saved, and a Yahoo hiccup must not
 * fail the save. The price only drives the preview's share estimate.
 */
async function warmSymbols(symbols: string[]): Promise<void> {
  for (const symbol of symbols) {
    try {
      await ensureProfile(symbol);
      await syncSymbol(symbol);
    } catch (err: any) {
      logger.debug("Buckets", `warmSymbols(${symbol}) failed: ${err.message}`);
    }
  }
}

/** What a run would place, with nothing placed. */
export const previewBucketHandler = async (req: Request, res: Response) => {
  const bucket = getBucket(Number(req.params.id));
  if (!bucket) return res.status(404).json({ error: "Bucket not found" });

  const { accounts, cashValue, refreshBalances } = req.body as ValidatedRunBody;

  // The page asks for a refresh when the run screen opens, so the cash figures
  // start out current. It does not ask on every edit — that would be a live
  // brokerage call per keystroke. The staging step refreshes unconditionally.
  let balances;
  if (refreshBalances) {
    balances = await refreshAccountBalances(accounts.map(a => a.portfolioId));
  }

  const plan = planBucketRun(bucket, accounts, cashValue);
  if (balances && balances.failures.length > 0) {
    plan.warnings.push(
      `Balances could not be refreshed for ${balances.failures.length} connection(s): ` +
      balances.failures.map(f => f.error).join("; ")
    );
  }
  res.json({ ...plan, balancesRefreshed: !!refreshBalances && balances!.failures.length === 0 });
};

/**
 * Step 1 of a run — recompute the plan, refuse it if anything blocks, and hand
 * back a single-use token.
 */
export const stageBucketRunHandler = async (req: Request, res: Response) => {
  const bucket = getBucket(Number(req.params.id));
  if (!bucket) return res.status(404).json({ error: "Bucket not found" });

  const { accounts, cashValue, allowBelowMinimum } = req.body as ValidatedRunBody;

  // Always re-read the balances from the broker before staging. A run is
  // refused when an account cannot fund it, and refusing on a cached figure
  // would mean blocking a funded account, or clearing an unfunded one, on
  // stale data. This is the last point before live orders, so it is worth a
  // call per connection.
  const balances = await refreshAccountBalances(accounts.map(a => a.portfolioId));
  if (balances.failures.length > 0) {
    // Unverifiable is not the same as sufficient: without a current balance
    // the funding check cannot be performed, so the run does not proceed.
    logger.warn("Buckets", `Run of "${bucket.name}" stopped — balances could not be verified, no orders placed`);
    return res.status(502).json({
      error: "Could not verify cash balances with the brokerage, so no orders were placed. " +
             balances.failures.map(f => f.error).join("; "),
      balanceCheckFailed: true,
    });
  }

  const plan = planBucketRun(bucket, accounts, cashValue);

  if (plan.errors.length > 0) {
    logger.warn("Buckets", `Run of "${bucket.name}" refused — ${plan.errors.join(" ")}`);
    return res.status(400).json({ error: plan.errors.join(" "), plan });
  }
  if (plan.orderCount === 0) {
    logger.warn("Buckets", `Run of "${bucket.name}" refused — it would place no orders`);
    return res.status(400).json({ error: "This run would place no orders.", plan });
  }
  // Under-minimum orders are the user's call, but they have to have made it:
  // the page sends allowBelowMinimum only after showing them the flagged rows.
  if (plan.belowMinimumCount > 0 && !allowBelowMinimum) {
    logger.info("Buckets", `Run of "${bucket.name}" held — ${plan.belowMinimumCount} order(s) below the ${plan.minNotional} minimum, awaiting the user's go-ahead`);
    return res.status(409).json({
      error: `${plan.belowMinimumCount} order(s) fall below the ${plan.minNotional} broker minimum.`,
      requiresBelowMinimumAck: true,
      plan,
    });
  }

  const now = Date.now();
  prunePendingRuns(now);
  const confirmationToken = randomUUID();
  pendingRuns.set(confirmationToken, { plan, expiresAt: now + CONFIRM_TTL_MS });

  logger.info("Buckets", `Staged run of "${bucket.name}" — ${plan.orderCount} order(s), grand total ${plan.grandTotal}, awaiting confirmation`);
  res.json({ success: true, requiresConfirmation: true, confirmationToken, plan });
};

/** One order, flattened out of a plan so a retry can carry just the failures. */
interface Placement {
  portfolioId: string;
  accountId: string;
  accountName: string;
  currency: string;
  symbol: string;
  amount: number;
}

export interface OrderResult extends Omit<Placement, "portfolioId"> {
  success: boolean;
  error?: string;
}

function toPlacements(plan: BucketPlan): Placement[] {
  return plan.accounts.flatMap(account =>
    account.orders.map(order => ({
      portfolioId: account.portfolioId,
      accountId: account.accountId,
      accountName: account.accountName,
      currency: account.currency,
      symbol: order.symbol,
      amount: order.amount,
    })));
}

/**
 * Place a list of orders, reporting each one.
 *
 * A rejection never aborts the loop: the user asked for the whole bucket to be
 * attempted and to be told exactly which ones failed. Retrying reuses this, so
 * a retried order goes out through the same path as the original.
 */
async function placeOrders(placements: Placement[]): Promise<OrderResult[]> {
  const results: OrderResult[] = [];

  for (const p of placements) {
    const { portfolioId, ...row } = p;
    const fail = (error: string) => results.push({ ...row, success: false, error });

    const portfolio = getPortfolio(portfolioId);
    if (!isPortfolioConnected(portfolio)) { fail("Connection not found or not usable"); continue; }
    if (!portfolio.tradingEnabled) { fail("Trading is not enabled for this connection"); continue; }
    if (!accountBelongsToPortfolio(p.accountId, portfolioId)) {
      fail("Account does not belong to this connection"); continue;
    }

    try {
      // A cash-amount order is what lets the broker fill a fraction of a share,
      // which is the whole point of splitting a fixed sum many ways.
      await placeBrokerageOrder(portfolio, {
        accountId: p.accountId,
        symbol: p.symbol,
        action: "BUY",
        orderType: "Market",
        notionalValue: p.amount,
      });
      logger.info("Buckets", `Placed BUY ${p.amount} ${p.currency} of ${p.symbol} in ${p.accountId}`);
      results.push({ ...row, success: true });
    } catch (err: any) {
      const { log, client: clientMessage } = snapTradeError(err, "Order rejected");
      logger.warn("Buckets", `Order failed — ${p.symbol} in ${p.accountId}: ${log}`);
      fail(clientMessage);
    }
  }

  return results;
}

/**
 * Failed orders from a completed run, held server-side so a retry references
 * them by token.
 *
 * The page never sends back symbols and amounts of its own — same rule as
 * staging. A retry can only re-attempt what actually failed.
 */
const retryableRuns = new Map<string, { bucketName: string; placements: Placement[]; expiresAt: number }>();
const RETRY_TTL_MS = 15 * 60_000;

function pruneRetryableRuns(now: number) {
  for (const [token, run] of retryableRuns) {
    if (now > run.expiresAt) retryableRuns.delete(token);
  }
}

/**
 * Record whatever failed and hand back a token for retrying it.
 *
 * Returns undefined when everything succeeded, so the page only offers a retry
 * when there is something to retry.
 */
function offerRetry(bucketName: string, placements: Placement[], results: OrderResult[]): string | undefined {
  const failedKeys = new Set(results.filter(r => !r.success).map(r => `${r.accountId}::${r.symbol}`));
  if (failedKeys.size === 0) return undefined;

  const failed = placements.filter(p => failedKeys.has(`${p.accountId}::${p.symbol}`));
  const token = randomUUID();
  const now = Date.now();
  pruneRetryableRuns(now);
  retryableRuns.set(token, { bucketName, placements: failed, expiresAt: now + RETRY_TTL_MS });
  return token;
}

/**
 * Step 2 — place every order in the staged plan.
 *
 * A rejected order does not stop the rest: the user asked for the whole bucket
 * to be attempted and to be told exactly which ones failed, so each result is
 * reported individually and a failure never aborts the loop.
 */
export const confirmBucketRunHandler = async (req: Request, res: Response) => {
  const { confirmationToken } = req.body as { confirmationToken: string };
  const now = Date.now();
  prunePendingRuns(now);

  const pending = confirmationToken ? pendingRuns.get(confirmationToken) : undefined;
  if (!pending || now > pending.expiresAt) {
    return res.status(400).json({ error: "Confirmation token missing, expired, or already used" });
  }
  pendingRuns.delete(confirmationToken);   // single-use
  const { plan } = pending;

  const results = await placeOrders(toPlacements(plan));

  const placed = results.filter(r => r.success).length;
  logger.info("Buckets", `Run of "${plan.name}" complete — ${placed}/${results.length} order(s) placed`);
  res.json({
    success: placed > 0,
    placed,
    total: results.length,
    results,
    retryToken: offerRetry(plan.name, toPlacements(plan), results),
  });
};

/**
 * Re-attempt the orders that failed, and only those.
 *
 * The balance check runs again first: an earlier order in the same run may have
 * consumed the cash, and a retry is as live as the original.
 */
export const retryBucketRunHandler = async (req: Request, res: Response) => {
  const { retryToken } = req.body as { retryToken: string };
  const now = Date.now();
  pruneRetryableRuns(now);

  const pending = retryToken ? retryableRuns.get(retryToken) : undefined;
  if (!pending || now > pending.expiresAt) {
    logger.warn("Buckets", "Retry refused — the token is missing, expired, or already used");
    return res.status(400).json({ error: "Nothing left to retry — the token is missing, expired, or already used." });
  }
  retryableRuns.delete(retryToken);   // single-use, like the run token
  const { bucketName, placements } = pending;

  const balances = await refreshAccountBalances(placements.map(p => p.portfolioId));
  if (balances.failures.length > 0) {
    // Put the token back: the orders are still outstanding and the user should
    // be able to try again once the brokerage is reachable.
    retryableRuns.set(retryToken, { bucketName, placements, expiresAt: now + RETRY_TTL_MS });
    return res.status(502).json({
      error: "Could not verify cash balances with the brokerage, so nothing was retried. " +
             balances.failures.map(f => f.error).join("; "),
      balanceCheckFailed: true,
    });
  }

  // Each account's remaining orders must still fit the cash it has now.
  const needByAccount = new Map<string, number>();
  for (const p of placements) {
    needByAccount.set(p.accountId, (needByAccount.get(p.accountId) ?? 0) + p.amount);
  }
  const short: string[] = [];
  for (const [accountId, needed] of needByAccount) {
    const first = placements.find(p => p.accountId === accountId)!;
    const check = checkOrderCash({
      portfolioId: first.portfolioId, accountId, symbol: first.symbol,
      action: "BUY", orderType: "Market", notionalValue: needed,
    });
    if (!check.sufficient && check.message) short.push(check.message);
  }
  if (short.length > 0) {
    logger.warn("Buckets", `Retry of "${bucketName}" refused — ${short.join(" ")}`);
    retryableRuns.set(retryToken, { bucketName, placements, expiresAt: now + RETRY_TTL_MS });
    return res.status(400).json({ error: short.join(" "), insufficientCash: true });
  }

  logger.info("Buckets", `Retrying ${placements.length} failed order(s) from "${bucketName}"`);
  const results = await placeOrders(placements);
  const placed = results.filter(r => r.success).length;
  logger.info("Buckets", `Retry of "${bucketName}" complete — ${placed}/${results.length} order(s) placed`);

  res.json({
    success: placed > 0,
    placed,
    total: results.length,
    results,
    retried: true,
    retryToken: offerRetry(bucketName, placements, results),
  });
};

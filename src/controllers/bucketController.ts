import { Request, Response } from "express";
import { randomUUID } from "crypto";
import {
  listBuckets, getBucket, createBucket, updateBucket, deleteBucket,
} from "../repositories/bucketRepository.js";
import { getPortfolio, accountBelongsToPortfolio } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { planBucketRun, type BucketPlan } from "../services/bucketService.js";
import { ensureProfile } from "../services/assetProfileService.js";
import { syncSymbol } from "../services/priceHistoryService.js";
import { logger } from "../utils/logger.js";
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
  cashValue: number;
  splitMode: SplitMode;
  items: Array<{ symbol: string; name: string | null; weight: number | null }>;
}

interface ValidatedRunBody {
  accounts: Array<{ portfolioId: string; accountId: string }>;
  cashValue?: number;
  allowBelowMinimum?: boolean;
}

const toBucketInput = (body: ValidatedBucketBody): BucketInput => ({
  name: body.name,
  cashValue: body.cashValue,
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
export const previewBucketHandler = (req: Request, res: Response) => {
  const bucket = getBucket(Number(req.params.id));
  if (!bucket) return res.status(404).json({ error: "Bucket not found" });

  const { accounts, cashValue } = req.body as ValidatedRunBody;
  res.json(planBucketRun(bucket, accounts, cashValue));
};

/**
 * Step 1 of a run — recompute the plan, refuse it if anything blocks, and hand
 * back a single-use token.
 */
export const stageBucketRunHandler = (req: Request, res: Response) => {
  const bucket = getBucket(Number(req.params.id));
  if (!bucket) return res.status(404).json({ error: "Bucket not found" });

  const { accounts, cashValue, allowBelowMinimum } = req.body as ValidatedRunBody;
  const plan = planBucketRun(bucket, accounts, cashValue);

  if (plan.errors.length > 0) {
    return res.status(400).json({ error: plan.errors.join(" "), plan });
  }
  if (plan.orderCount === 0) {
    return res.status(400).json({ error: "This run would place no orders.", plan });
  }
  // Under-minimum orders are the user's call, but they have to have made it:
  // the page sends allowBelowMinimum only after showing them the flagged rows.
  if (plan.belowMinimumCount > 0 && !allowBelowMinimum) {
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

  const results: Array<{
    accountId: string; accountName: string; symbol: string;
    amount: number; currency: string; success: boolean; error?: string;
  }> = [];

  for (const account of plan.accounts) {
    const portfolio = getPortfolio(account.portfolioId);
    const baseFailure = (message: string) => {
      for (const order of account.orders) {
        results.push({
          accountId: account.accountId, accountName: account.accountName,
          symbol: order.symbol, amount: order.amount, currency: account.currency,
          success: false, error: message,
        });
      }
    };

    if (!portfolio || !portfolio.userSecret) { baseFailure("Connection not found or not registered"); continue; }
    if (!portfolio.tradingEnabled) { baseFailure("Trading is not enabled for this connection"); continue; }
    if (!accountBelongsToPortfolio(account.accountId, account.portfolioId)) {
      baseFailure("Account does not belong to this connection"); continue;
    }

    const client = getSnapTradeClientForPortfolio(portfolio);
    for (const order of account.orders) {
      try {
        await (client as any).trading.placeForceOrder({
          userId: portfolio.userId,
          userSecret: portfolio.userSecret!,
          account_id: account.accountId,
          action: "BUY",
          order_type: "Market",
          time_in_force: "Day",
          symbol: order.symbol,
          universal_symbol_id: null,
          // A cash-amount order is what lets the broker fill a fraction of a
          // share, which is the whole point of splitting a fixed sum many ways.
          notional_value: { amount: order.amount, currency: account.currency },
        });
        logger.info("Buckets", `Placed BUY ${order.amount} ${account.currency} of ${order.symbol} in ${account.accountId}`);
        results.push({
          accountId: account.accountId, accountName: account.accountName,
          symbol: order.symbol, amount: order.amount, currency: account.currency, success: true,
        });
      } catch (err: any) {
        const { log, client: clientMessage } = snapTradeError(err, "Order rejected");
        logger.warn("Buckets", `Order failed — ${order.symbol} in ${account.accountId}: ${log}`);
        results.push({
          accountId: account.accountId, accountName: account.accountName,
          symbol: order.symbol, amount: order.amount, currency: account.currency,
          success: false, error: clientMessage,
        });
      }
    }
  }

  const placed = results.filter(r => r.success).length;
  logger.info("Buckets", `Run of "${plan.name}" complete — ${placed}/${results.length} order(s) placed`);
  res.json({ success: placed > 0, placed, total: results.length, results });
};

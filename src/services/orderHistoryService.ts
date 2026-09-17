import { getScopedAccounts } from "./accountScope.js";
import { getSnapTradeClientForPortfolio } from "./snaptrade.js";
import { accountDisplayName } from "../utils/accountName.js";
import { listPortfolios } from "../models/db.js";
import { logger } from "../utils/logger.js";
import { snapTradeError } from "../utils/snapTradeError.js";
import type { Portfolio } from "../models/db.js";

/**
 * Orders as the brokerage sees them — what is still working, and what filled.
 *
 * Read live on request rather than cached. Everything else in this app caches,
 * but a stale order status is worse than none: an order shown as open after it
 * filled invites a duplicate, and one shown as filled when it was rejected
 * hides a problem. Freshness is the point of the page.
 */

/** Statuses where the order is still working and can be cancelled. */
const OPEN_STATUSES = new Set([
  "PENDING", "ACCEPTED", "QUEUED", "PARTIAL", "TRIGGERED", "ACTIVATED",
  "REPLACE_PENDING", "PENDING_RISK_REVIEW", "CONTINGENT_ORDER", "SUSPENDED",
]);

/** Statuses that ended without filling, shown apart from a completed fill. */
const FAILED_STATUSES = new Set(["FAILED", "REJECTED", "EXPIRED", "STOPPED"]);

export interface OrderRow {
  brokerageOrderId: string | null;
  portfolioId: string;
  accountId: string;
  accountName: string;
  symbol: string | null;
  description: string | null;
  action: string | null;
  status: string;
  orderType: string | null;
  timeInForce: string | null;
  totalQuantity: number | null;
  filledQuantity: number | null;
  openQuantity: number | null;
  canceledQuantity: number | null;
  executionPrice: number | null;
  limitPrice: number | null;
  currency: string | null;
  timePlaced: string | null;
  timeUpdated: string | null;
  timeExecuted: string | null;
  /** Still working at the brokerage, so cancelling it means something. */
  isOpen: boolean;
  /** Ended without filling. */
  isFailed: boolean;
  /** Whether this app may cancel it — trading must be on for the connection. */
  cancellable: boolean;
}

export interface OrdersResult {
  orders: OrderRow[];
  /** Accounts that could not be read, so an empty list is never mistaken for "no orders". */
  errors: Array<{ accountId: string; accountName: string; error: string }>;
  fetchedAt: string;
}

/** SnapTrade sends quantities and prices as strings. */
function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * One brokerage order record, in the shape this app renders.
 *
 * Exported and pure: everything worth getting wrong lives here — quantities
 * and prices arrive as strings, the symbol is nested, and whether an order can
 * be cancelled is a judgement made here rather than reported by the broker.
 */
export function normalizeOrder(raw: any, account: any, portfolioId: string, tradingEnabled: boolean): OrderRow {
  const status = String(raw?.status ?? "NONE").toUpperCase();
  const universal = raw?.universal_symbol ?? null;
  const isOpen = OPEN_STATUSES.has(status);
  return {
    brokerageOrderId: raw?.brokerage_order_id ?? null,
    portfolioId,
    accountId: account.id,
    accountName: accountDisplayName(account),
    symbol: universal?.symbol ?? universal?.raw_symbol ?? raw?.symbol ?? null,
    description: universal?.description ?? null,
    action: raw?.action ?? null,
    status,
    orderType: raw?.order_type ?? null,
    timeInForce: raw?.time_in_force ?? null,
    totalQuantity: num(raw?.total_quantity),
    filledQuantity: num(raw?.filled_quantity),
    openQuantity: num(raw?.open_quantity),
    canceledQuantity: num(raw?.canceled_quantity),
    executionPrice: num(raw?.execution_price),
    limitPrice: num(raw?.limit_price),
    currency: universal?.currency?.code ?? account.currency ?? null,
    timePlaced: raw?.time_placed ?? null,
    timeUpdated: raw?.time_updated ?? null,
    timeExecuted: raw?.time_executed ?? null,
    isOpen,
    isFailed: FAILED_STATUSES.has(status),
    // Cancelling is a write, so it needs the same permission placing does.
    cancellable: isOpen && tradingEnabled && !!raw?.brokerage_order_id,
  };
}

/** Newest first. An order with no timestamp sorts last rather than first. */
export function sortOrdersNewestFirst(orders: OrderRow[]): OrderRow[] {
  return orders.sort((a, b) => {
    const at = a.timePlaced ? Date.parse(a.timePlaced) : 0;
    const bt = b.timePlaced ? Date.parse(b.timePlaced) : 0;
    return bt - at;
  });
}

/**
 * Orders across every active account.
 *
 * One call per account, so this is deliberately on-demand rather than polled.
 * A failure on one account is reported against that account instead of failing
 * the page — a broken connection should not hide the orders you can see.
 */
export async function getOrders(opts: { state?: "all" | "open" | "executed"; days?: number } = {}): Promise<OrdersResult> {
  const portfolios = new Map(listPortfolios().map(p => [String(p.id), p]));
  const orders: OrderRow[] = [];
  const errors: OrdersResult["errors"] = [];

  for (const account of getScopedAccounts(null)) {
    const portfolio = portfolios.get(String(account.portfolioId));
    if (!portfolio || !portfolio.userSecret) continue;

    try {
      const client = getSnapTradeClientForPortfolio(portfolio as Portfolio);
      const response = await client.accountInformation.getUserAccountOrders({
        userId: portfolio.userId,
        userSecret: portfolio.userSecret,
        accountId: account.id,
        state: opts.state ?? "all",
        // SnapTrade caps this at 90 days.
        days: Math.min(opts.days ?? 30, 90),
      });
      const rows = Array.isArray(response.data) ? response.data : [];
      for (const raw of rows) {
        orders.push(normalizeOrder(raw, account, String(portfolio.id), !!portfolio.tradingEnabled));
      }
    } catch (err: any) {
      const { log, client } = snapTradeError(err, "Could not read orders");
      logger.warn("Orders", `Failed for account ${account.id}: ${log}`);
      errors.push({ accountId: account.id, accountName: accountDisplayName(account), error: client });
    }
  }

  sortOrdersNewestFirst(orders);

  logger.info("Orders", `Read ${orders.length} order(s); ${errors.length} account(s) failed`);
  return { orders, errors, fetchedAt: new Date().toISOString() };
}

/** Cancel one working order at the brokerage. */
export async function cancelOrder(portfolio: Portfolio, accountId: string, brokerageOrderId: string) {
  const client = getSnapTradeClientForPortfolio(portfolio);
  logger.info("Orders", `Cancelling ${brokerageOrderId} in account ${accountId}`);
  const response = await client.trading.cancelOrder({
    userId: portfolio.userId,
    userSecret: portfolio.userSecret!,
    accountId: String(accountId),
    brokerage_order_id: brokerageOrderId,
  });
  return response.data;
}

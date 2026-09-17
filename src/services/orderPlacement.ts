import type { Portfolio } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "./snaptrade.js";
import { logger } from "../utils/logger.js";
import { snapTradeError } from "../utils/snapTradeError.js";

/**
 * The one place that builds a brokerage order.
 *
 * Both the single-order popup and a bucket run place orders, and when each
 * built its own payload they drifted: `notional_value` was sent as
 * `{ amount, currency }` when SnapTrade's `NotionalValue` is a bare number, so
 * every cash-amount order was rejected. The call was made through an `as any`
 * cast, which is exactly why the compiler never said so.
 *
 * Nothing here is cast. The form is typed, so a field of the wrong shape is a
 * build error rather than a rejected order.
 */

export interface OrderRequest {
  accountId: string;
  /** Ticker as the broker knows it. */
  symbol: string;
  action: "BUY" | "SELL";
  orderType: "Market" | "Limit";
  timeInForce?: "Day" | "GTC";
  /** Share count. Mutually exclusive with `notionalValue`. */
  units?: number | null;
  /**
   * Cash amount, in the account's own currency — this is what buys a fraction
   * of a share. SnapTrade takes a plain number, not an amount-and-currency
   * object, and it only works with a Market order held for the Day.
   */
  notionalValue?: number | null;
  /** Required for a Limit order. */
  price?: number | null;
}

export function buildOrderForm(order: OrderRequest) {
  const isNotional = order.notionalValue != null;
  return {
    account_id: String(order.accountId),
    action: order.action,
    order_type: order.orderType,
    // A cash-amount order can only be Market/Day, so it is pinned here rather
    // than trusting whatever the caller happened to pass.
    time_in_force: isNotional ? ("Day" as const) : (order.timeInForce ?? "Day"),
    symbol: order.symbol.trim(),
    // The API rejects a form carrying both; `symbol` is what this app knows.
    universal_symbol_id: null,
    // "Must be null if the other is provided" — stated explicitly rather than
    // left undefined, because the API checks for null, not for absence.
    units: isNotional ? null : (order.units ?? null),
    notional_value: isNotional ? Number(order.notionalValue) : null,
    ...(order.orderType === "Limit" ? { price: Number(order.price) } : {}),
  };
}

/** Place a single order and return the brokerage's record of it. */
export async function placeBrokerageOrder(portfolio: Portfolio, order: OrderRequest) {
  const client = getSnapTradeClientForPortfolio(portfolio);
  const form = buildOrderForm(order);
  const qty = form.notional_value != null ? `notional=${form.notional_value}` : `${form.units} units`;
  logger.info("Trading", `Placing ${form.action} ${qty} ${form.symbol} in ${form.account_id} (${form.order_type}/${form.time_in_force})`);

  try {
    const response = await client.trading.placeForceOrder({
      userId: portfolio.userId,
      userSecret: portfolio.userSecret!,
      ...form,
    });
    // Logged here rather than left to each caller, so an order's outcome is in
    // the log whether it came from the popup, a bucket or a rebalance.
    const id = (response.data as any)?.brokerage_order_id ?? 'no id returned';
    logger.info("Trading", `Placed ${form.action} ${qty} ${form.symbol} in ${form.account_id} — brokerage order ${id}`);
    return response.data;
  } catch (err: any) {
    // The SDK's own error message carries a response-header dump; snapTradeError
    // pulls out the brokerage's actual reason, which is the part worth logging.
    const { log } = snapTradeError(err, "Order rejected");
    logger.warn("Trading", `Rejected ${form.action} ${qty} ${form.symbol} in ${form.account_id}: ${log}`);
    throw err;
  }
}

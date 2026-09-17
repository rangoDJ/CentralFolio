import { getCachedAccounts } from "../models/db.js";
import { getPriceHistory } from "../repositories/priceHistoryRepository.js";
import { accountDisplayName } from "../utils/accountName.js";

/**
 * Does this account hold enough cash for this order?
 *
 * Only ever called on a balance just re-read from the broker — a funding
 * decision made on a cached figure can block a funded account or clear an
 * unfunded one.
 */

export interface CashCheck {
  /** False only when the cost is known and exceeds the cash on hand. */
  sufficient: boolean;
  /** Cash the order needs, or null when it cannot be worked out. */
  required: number | null;
  cash: number | null;
  currency: string;
  accountName: string;
  /** Why the cost is unknown, when it is. */
  note?: string;
  message?: string;
}

function latestClose(symbol: string): number | null {
  const candles = getPriceHistory(symbol);
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].close != null) return candles[i].close;
  }
  return null;
}

export function checkOrderCash(params: {
  portfolioId: string | number;
  accountId: string;
  symbol: string;
  action: "BUY" | "SELL";
  orderType: "Market" | "Limit";
  units?: number | null;
  notionalValue?: number | null;
  price?: number | null;
}): CashCheck {
  const account = getCachedAccounts(params.portfolioId).find(a => a.id === String(params.accountId));
  const accountName = accountDisplayName(account);
  const currency = account?.currency || "";
  const cash = account?.balance?.cash?.amount ?? account?.cashBalance ?? null;

  // Selling raises cash rather than spending it.
  if (params.action === "SELL") {
    return { sufficient: true, required: 0, cash, currency, accountName, note: "A sell does not draw on cash." };
  }

  let required: number | null = null;
  let note: string | undefined;

  if (params.notionalValue != null) {
    // The exact figure — a cash-amount order spends precisely this.
    required = params.notionalValue;
  } else if (params.orderType === "Limit" && params.price != null && params.units != null) {
    required = params.units * params.price;
  } else if (params.units != null) {
    const last = latestClose(params.symbol);
    if (last != null && last > 0) {
      required = params.units * last;
      note = "Estimated from the last close — a market order fills at whatever price it gets.";
    } else {
      // Refusing here would block every market order in a symbol this app has
      // no price history for, which is a worse failure than letting the broker
      // decline it. The balance was still verified; only the cost is unknown.
      note = "No cached price for this symbol, so the cost could not be estimated before placing.";
    }
  }

  if (required == null || cash == null) {
    return { sufficient: true, required, cash, currency, accountName, note };
  }

  const sufficient = cash >= required;
  return {
    sufficient,
    required: Math.round(required * 100) / 100,
    cash,
    currency,
    accountName,
    note,
    message: sufficient
      ? undefined
      : `"${accountName}" has ${cash.toFixed(2)} ${currency}`.trim() +
        ` in cash but this order needs about ${required.toFixed(2)} — short by ${(required - cash).toFixed(2)}.`,
  };
}

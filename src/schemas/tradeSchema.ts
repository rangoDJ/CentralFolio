import { z } from "zod";

/**
 * Validation schema for POST /api/snapTrade/trade (place order).
 *
 * Encodes the order rules declaratively, replacing the ~50 lines of manual
 * checks previously inline in tradingController.placeTrade:
 *   - exactly one of `units` / `notional_value`
 *   - notional orders must be Market
 *   - Limit orders require a positive `price`
 *
 * Output is normalized: `portfolioId`/`accountId` are strings, `ticker` is
 * trimmed, and numeric fields are coerced to finite positive numbers.
 */

const idLike = z.union([z.string(), z.number()]).transform(v => String(v).trim())
  .refine(s => s.length > 0, "is required");

const positiveNumber = z.coerce.number().finite().positive();

export const tradeOrderSchema = z.object({
  portfolioId: idLike,
  accountId: idLike,
  ticker: z.string()
    .transform(s => s.trim())
    .refine(s => /^[A-Za-z0-9.:\-]{1,20}$/.test(s), "contains invalid characters or is too long"),
  action: z.enum(["BUY", "SELL"]),
  orderType: z.enum(["Market", "Limit"]),
  timeInForce: z.enum(["Day", "GTC"]).optional(),
  units: positiveNumber.optional(),
  notional_value: positiveNumber.optional(),
  price: positiveNumber.optional(),
})
  .superRefine((data, ctx) => {
    const hasUnits = data.units != null;
    const hasNotional = data.notional_value != null;

    if (!hasUnits && !hasNotional) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["units"], message: "provide either units or notional_value" });
    }
    if (hasUnits && hasNotional) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["units"], message: "provide units or notional_value, not both" });
    }
    if (hasNotional && data.orderType !== "Market") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["orderType"], message: "notional_value orders must use orderType Market" });
    }
    if (data.orderType === "Limit" && data.price == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["price"], message: "price is required for Limit orders" });
    }
  });

export type TradeOrder = z.infer<typeof tradeOrderSchema>;

/**
 * Body for POST /api/snapTrade/trade/confirm — the one-time, TTL-bound token
 * issued by the staging step of /api/trade.
 */
export const confirmOrderSchema = z.object({
  confirmationToken: z.string().min(8, "is required"),
});

export type ConfirmOrder = z.infer<typeof confirmOrderSchema>;

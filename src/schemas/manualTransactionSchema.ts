import { z } from "zod";

/**
 * Validation for hand-entered transactions.
 *
 * The `type` vocabulary is deliberately restricted to codes the downstream
 * services already recognize — `t5008.sideOf` (BUY/SELL/TRANSFER_*),
 * `carryingCharges.classify` (INTEREST/FEE), and `divmath`'s dividend types.
 * Accepting a free-text type would let a user enter a row that silently does
 * nothing to their cost base, which is the exact failure this feature exists
 * to fix.
 */
export const MANUAL_TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "DIVIDEND",
  "DISTRIBUTION",
  "INTEREST",
  "FEE",
  "DEPOSIT",
  "WITHDRAWAL",
] as const;

export type ManualTransactionType = (typeof MANUAL_TRANSACTION_TYPES)[number];

/** Types that move units of a security and therefore need a symbol + units. */
const UNIT_MOVING_TYPES = new Set<string>(["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT"]);

/** Types that are purely cash and therefore need an amount. */
const CASH_TYPES = new Set<string>([
  "DIVIDEND", "DISTRIBUTION", "INTEREST", "FEE", "DEPOSIT", "WITHDRAWAL",
]);

const ticker = z.string()
  .transform(s => s.toUpperCase().trim())
  .refine(s => /^[A-Z0-9.:\-]{1,20}$/.test(s), "is not a valid ticker symbol");

// 'YYYY-MM-DD'. Rejects impossible calendar dates (2024-02-31) that a plain
// regex would wave through — a bad date silently lands the trade in the wrong
// tax year.
const isoDate = z.string()
  .transform(s => s.trim().slice(0, 10))
  .refine(s => /^\d{4}-\d{2}-\d{2}$/.test(s), "must be a date in YYYY-MM-DD format")
  .refine(s => {
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "is not a real calendar date");

const positiveNumber = z.coerce.number().finite().positive();
const nonNegativeNumber = z.coerce.number().finite().nonnegative();

export const manualTransactionSchema = z.object({
  accountId: z.string().trim().min(1, "is required").max(200),
  type: z.enum(MANUAL_TRANSACTION_TYPES),
  date: isoDate,
  symbol: ticker.nullish(),
  description: z.string().trim().max(200).nullish(),
  units: positiveNumber.nullish(),
  price: nonNegativeNumber.nullish(),
  amount: nonNegativeNumber.nullish(),
  currencyCode: z.string().trim().toUpperCase().length(3, "must be a 3-letter currency code").nullish(),
  notes: z.string().trim().max(500).nullish(),
})
  .superRefine((data, ctx) => {
    if (UNIT_MOVING_TYPES.has(data.type)) {
      if (!data.symbol) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["symbol"], message: `is required for ${data.type}` });
      }
      if (data.units == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["units"], message: `is required for ${data.type}` });
      }
      // Cost base comes from `amount` when present and units x price otherwise
      // (see t5008.buyCostOf), so a unit-moving row with neither is the very
      // zero-cost-base row this feature exists to prevent.
      if (data.price == null && data.amount == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["price"],
          message: "provide a price per unit or a total amount — without one there is no cost base",
        });
      }
    }
    if (CASH_TYPES.has(data.type) && data.amount == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: `is required for ${data.type}` });
    }
  })
  // Units are always entered as a positive quantity; the type carries the
  // direction. TRANSFER_OUT is signed negative because `sideOf` reads the sign
  // of `units` for transfer types, not the type name.
  .transform(data => ({
    ...data,
    units: data.units != null && data.type === "TRANSFER_OUT" ? -data.units : data.units,
    amount: data.amount ?? (data.units != null && data.price != null ? data.units * data.price : null),
  }));

export type ManualTransactionBody = z.infer<typeof manualTransactionSchema>;

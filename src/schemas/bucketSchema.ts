import { z } from "zod";

/**
 * Validation for the buy-bucket endpoints.
 *
 * A bucket places real market orders, so the rules are enforced here rather
 * than trusted from the page: a weighted bucket must carry a weight on every
 * symbol, and no bucket may hold the same symbol twice (two orders for the
 * same thing is never what was meant).
 */

const symbol = z.string()
  .transform(s => s.trim().toUpperCase())
  .refine(s => /^[A-Z0-9.:\-]{1,20}$/.test(s), "contains invalid characters or is too long");

const bucketItem = z.object({
  symbol,
  name: z.string().trim().max(120).nullish().transform(v => v || null),
  weight: z.coerce.number().finite().positive().max(100).nullish().transform(v => v ?? null),
});

export const bucketSchema = z.object({
  name: z.string().transform(s => s.trim()).refine(s => s.length > 0 && s.length <= 60, "must be 1–60 characters"),
  cashValue: z.coerce.number().finite().positive().max(1_000_000),
  splitMode: z.enum(["equal", "weighted"]).default("equal"),
  items: z.array(bucketItem).min(1, "add at least one symbol").max(50, "at most 50 symbols"),
})
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (const item of data.items) {
      if (seen.has(item.symbol)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: `${item.symbol} appears more than once` });
      }
      seen.add(item.symbol);
    }
    if (data.splitMode === "weighted") {
      const missing = data.items.filter(i => i.weight == null);
      if (missing.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items"],
          message: "a weighted bucket needs a weight on every symbol",
        });
        return;
      }
      const total = data.items.reduce((sum, i) => sum + (i.weight ?? 0), 0);
      // A cent of float drift is fine; a percentage point is a typo.
      if (Math.abs(total - 100) > 0.01) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items"],
          message: `weights must add up to 100% (currently ${total.toFixed(2)}%)`,
        });
      }
    }
  });

export type BucketBody = z.infer<typeof bucketSchema>;

/** The accounts a run targets, plus an optional one-off override of the amount. */
export const bucketRunSchema = z.object({
  accounts: z.array(z.object({
    portfolioId: z.union([z.string(), z.number()]).transform(v => String(v).trim()),
    accountId: z.union([z.string(), z.number()]).transform(v => String(v).trim()),
  })).min(1, "select at least one account").max(20),
  cashValue: z.coerce.number().finite().positive().max(1_000_000).optional(),
  /** Set once the preview has shown under-minimum orders and the user accepted them. */
  allowBelowMinimum: z.boolean().optional(),
  /** Ask the preview to re-read balances from the broker first. */
  refreshBalances: z.boolean().optional(),
});

export type BucketRunBody = z.infer<typeof bucketRunSchema>;

export const bucketConfirmSchema = z.object({
  confirmationToken: z.string().min(8, "is required"),
});

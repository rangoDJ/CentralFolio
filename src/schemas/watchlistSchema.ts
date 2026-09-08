import { z } from "zod";

const ticker = z.string()
  .transform(s => s.toUpperCase().trim())
  .refine(s => /^[A-Z0-9.:\-]{1,20}$/.test(s), "is not a valid ticker symbol");

export const addWatchlistSchema = z.object({
  symbol: ticker,
  notes: z.string().max(500).optional(),
});

export const updateNotesSchema = z.object({
  notes: z.string().max(500).nullable().optional(),
});

/**
 * Buy criteria. Every field is optional and nullable: null clears a criterion,
 * and an absent field is treated the same, because setWatchlistTargets replaces
 * the whole set rather than merging.
 */
export const watchlistTargetsSchema = z.object({
  targetPrice: z.coerce.number().finite().positive().nullish(),
  targetYieldPct: z.coerce.number().finite().nonnegative().max(100, "must be 100% or less").nullish(),
  maxRatingScore: z.coerce.number().int().min(1, "must be between 1 and 5").max(5, "must be between 1 and 5").nullish(),
  minGrowthStreak: z.coerce.number().int().nonnegative().max(100).nullish(),
});

export type WatchlistTargetsInput = z.infer<typeof watchlistTargetsSchema>;
export type AddWatchlistInput = z.infer<typeof addWatchlistSchema>;

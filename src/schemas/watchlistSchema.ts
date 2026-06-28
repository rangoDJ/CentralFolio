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

export type AddWatchlistInput = z.infer<typeof addWatchlistSchema>;

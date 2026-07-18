import { z } from "zod";

export const manualAssetSchema = z.object({
  name: z.string().trim().min(1, "is required").max(120),
  category: z.string().trim().min(1).max(60).default("Other"),
  value: z.coerce.number().finite().nonnegative(),
  currency: z.string().trim().toUpperCase().length(3, "must be a 3-letter currency code").default("CAD"),
  notes: z.string().max(500).nullable().optional(),
});

export type ManualAssetInput = z.infer<typeof manualAssetSchema>;

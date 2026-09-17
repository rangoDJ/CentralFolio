import { z } from "zod";

/** Body for POST /api/orders/cancel. */
export const cancelOrderSchema = z.object({
  portfolioId: z.union([z.string(), z.number()]).transform(v => String(v).trim()),
  accountId: z.union([z.string(), z.number()]).transform(v => String(v).trim()),
  brokerageOrderId: z.string().transform(s => s.trim()).refine(s => s.length > 0, "is required"),
});

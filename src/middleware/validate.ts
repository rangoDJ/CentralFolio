import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { logger } from "../utils/logger.js";

/**
 * Express middleware factory that validates `req.body` against a zod schema.
 * On success, replaces `req.body` with the parsed (and normalized) value so
 * downstream handlers can trust the shape. On failure, responds 400 with a
 * compact, human-readable list of field errors.
 *
 * Centralizes the hand-rolled `if (!x) return res.status(400)...` checks that
 * were previously duplicated across controllers.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const detail = result.error.issues
        .map(i => `${i.path.join(".") || "(body)"}: ${i.message}`)
        .join("; ");
      logger.warn("Validation", `${req.method} ${req.path} rejected: ${detail}`);
      return res.status(400).json({ error: detail });
    }
    req.body = result.data;
    next();
  };
}

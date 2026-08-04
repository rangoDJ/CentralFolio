import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";

/**
 * Configurable per-IP sliding-window rate limiter (in-memory).
 *
 * Unlike the login-specific limiter in authController, this is a reusable
 * middleware that can be mounted on whole route prefixes. It is intentionally
 * simple (Map<string, {count, firstAt}>) and single-process — consistent with
 * the rest of the app (see the single-instance note in server.ts).
 */

export interface RateLimitOptions {
  name: string;
  windowMs: number;
  max: number;
}

interface Entry {
  count: number;
  firstAt: number;
}

// Hard cap so a burst of unique IPs cannot grow the map unboundedly.
const MAX_ENTRIES = 5000;

export function createRateLimiter(options: RateLimitOptions) {
  const attempts = new Map<string, Entry>();

  function prune(now: number) {
    for (const [key, record] of attempts) {
      if (now - record.firstAt > options.windowMs) attempts.delete(key);
    }
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    prune(now);

    const record = attempts.get(ip);
    if (!record) {
      if (attempts.size >= MAX_ENTRIES) {
        const oldest = attempts.keys().next().value;
        if (oldest !== undefined) attempts.delete(oldest);
      }
      attempts.set(ip, { count: 1, firstAt: now });
      return next();
    }

    if (record.count >= options.max) {
      logger.warn("RateLimit", `${options.name}: limit exceeded for ${ip}`);
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    record.count++;
    next();
  };
}

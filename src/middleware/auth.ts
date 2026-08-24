import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { getJwtSecret, getPasswordHash } from "../models/db.js";
import { API_TOKEN_PREFIX, verifyApiToken } from "../repositories/apiTokenRepository.js";
import { logger } from "../utils/logger.js";

export const AUTH_COOKIE = "cf_token";

/** Minimal Cookie header parser — avoids pulling in a cookie-parser dependency. */
function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Accept the token from either the Authorization header (legacy/SPA bearer
  // flow) or the httpOnly cookie (preferred — not readable by injected scripts).
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : readCookie(req, AUTH_COOKIE);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  // A long-lived, revocable API token (Settings → API Tokens), for scripts and
  // other non-browser clients — distinguished from the session JWT by prefix
  // so a bad guess doesn't fall through to (and fail) a JWT verify.
  if (token.startsWith(API_TOKEN_PREFIX)) {
    if (verifyApiToken(token)) return next();
    return res.status(401).json({ error: "Invalid or revoked API token" });
  }
  try {
    jwt.verify(token, getJwtSecret() + (getPasswordHash() || ""), { algorithms: ["HS256"] });
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Short-lived single-use tickets for EventSource (which can't send headers).
// Ticket → expiry ms. Cleaned up lazily on each issue call.
const SSE_TICKET_TTL_MS = 30_000;
const sseTickets = new Map<string, number>();

export function issueSSETicket(_req: Request, res: Response) {
  // Prune expired tickets
  const now = Date.now();
  for (const [k, exp] of sseTickets) {
    if (now > exp) sseTickets.delete(k);
  }
  const ticket = randomUUID();
  sseTickets.set(ticket, now + SSE_TICKET_TTL_MS);
  res.json({ ticket });
}

export function consumeSSETicket(req: Request, res: Response, next: NextFunction) {
  const ticket = typeof req.query.ticket === "string" ? req.query.ticket : undefined;
  if (!ticket) return res.status(401).json({ error: "Unauthorized" });
  const exp = sseTickets.get(ticket);
  if (!exp || Date.now() > exp) {
    sseTickets.delete(ticket);
    return res.status(401).json({ error: "Invalid or expired SSE ticket" });
  }
  sseTickets.delete(ticket); // one-time use
  next();
}

/**
 * Lightweight CSRF defense for cookie-based auth.
 *
 * With the session moved to an httpOnly cookie, state-changing requests must
 * be proven to come from the app's own origin. Browsers always send an
 * `Origin` (and historically `Referer`) header on cross-origin form/fetch
 * POSTs but a CSRF attacker's page can't forge that header. Non-browser
 * clients (Android app, curl) send no Origin header and pass through, and the
 * `sameSite=strict` cookie already blocks most cross-site cookie delivery.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  const raw = req.headers.origin || req.headers.referer;
  // No origin info → non-browser caller (API client). Allow; auth token still
  // governs access.
  if (!raw) return next();

  let originHost: string;
  try {
    originHost = new URL(raw).host;
  } catch {
    // Malformed Origin/Referer — treat strictly as cross-origin.
    return res.status(400).json({ error: "Invalid request origin" });
  }

  const expected = req.headers.host;
  if (originHost !== expected) {
    logger.warn("Auth", `CSRF: rejecting cross-origin ${req.method} ${req.path} from ${raw}`);
    return res.status(403).json({ error: "Cross-origin request rejected" });
  }
  next();
}

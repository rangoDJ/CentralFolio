import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { getJwtSecret, getPasswordHash } from "../models/db.js";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    jwt.verify(token, getJwtSecret() + (getPasswordHash() || ""));
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

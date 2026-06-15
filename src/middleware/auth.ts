import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret, getPasswordHash } from "../models/db.js";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  // EventSource (SSE) cannot set the Authorization header, so accept the token
  // as a ?token= query param as a fallback. The Bearer header takes precedence.
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : (typeof req.query.token === "string" ? req.query.token : undefined);
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

import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getPasswordHash, setPasswordHash, getJwtSecret } from "../models/db.js";
import { logger } from "../utils/logger.js";
import { AUTH_COOKIE } from "../middleware/auth.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches the JWT expiry

// Sets the session token as an httpOnly cookie so it is not exposed to JS (XSS).
// `secure` follows the connection (respects `trust proxy`), so it still works on
// plain-http localhost while being secure behind an HTTPS proxy in production.
function setAuthCookie(req: Request, res: Response, token: string) {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.secure,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

// Simple in-memory rate limiter: max 10 attempts per IP per 15 minutes
const loginAttempts = new Map<string, { count: number; firstAt: number }>();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 10;
const MAX_LIMITER_ENTRIES = 1000;

function pruneExpiredAttempts(now: number) {
  for (const [ip, record] of loginAttempts) {
    if (now - record.firstAt > RATE_WINDOW_MS) loginAttempts.delete(ip);
  }
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  pruneExpiredAttempts(now);
  const record = loginAttempts.get(ip);
  if (!record) {
    if (loginAttempts.size >= MAX_LIMITER_ENTRIES) {
      const oldestIp = loginAttempts.keys().next().value;
      if (oldestIp !== undefined) loginAttempts.delete(oldestIp);
    }
    loginAttempts.set(ip, { count: 1, firstAt: now });
    return false;
  }
  if (record.count >= RATE_MAX) return true;
  record.count++;
  return false;
}

function clearRateLimit(ip: string) {
  loginAttempts.delete(ip);
}

export const getAuthStatus = (req: Request, res: Response) => {
  const configured = !!getPasswordHash();
  res.json({ configured });
};

// Session validity check for cookie-based clients. Requires auth (see route);
// used by the SPA on load instead of trusting a JS-readable token.
export const verify = (_req: Request, res: Response) => {
  res.json({ authenticated: true });
};

export const setup = async (req: Request, res: Response) => {
  if (getPasswordHash()) {
    return res.status(400).json({ error: "Password already configured. Use change-password instead." });
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    logger.warn("Auth", `Setup rate limit exceeded for ${ip}`);
    return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  }
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const hash = await bcrypt.hash(password, 12);
  setPasswordHash(hash);
  logger.info("Auth", "Initial password configured.");
  res.json({ success: true });
};

export const login = async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    logger.warn("Auth", `Rate limit exceeded for ${ip}`);
    return res.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });
  }
  const { password } = req.body;
  const hash = getPasswordHash();
  if (!hash) {
    return res.status(400).json({ error: "No password configured. Complete setup first." });
  }
  const valid = await bcrypt.compare(String(password ?? ""), hash);
  if (!valid) {
    logger.warn("Auth", `Failed login attempt from ${ip}`);
    return res.status(401).json({ error: "Invalid password." });
  }
  clearRateLimit(ip);
  const token = jwt.sign({ app: "centralfolio" }, getJwtSecret() + (hash || ""), { expiresIn: "7d", algorithm: "HS256" });
  setAuthCookie(req, res, token);
  logger.info("Auth", `Successful login from ${ip}`);
  // Token is also returned in the body for backwards compatibility with the
  // existing bearer-based frontend; new clients can rely on the cookie instead.
  res.json({ token });
};

export const logout = (_req: Request, res: Response) => {
  res.clearCookie(AUTH_COOKIE, { path: "/" });
  res.json({ success: true });
};

export const changePassword = async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  const hash = getPasswordHash();
  if (!hash) return res.status(400).json({ error: "No password configured." });
  const valid = await bcrypt.compare(String(currentPassword ?? ""), hash);
  if (!valid) return res.status(401).json({ error: "Current password incorrect." });
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  const newHash = await bcrypt.hash(newPassword, 12);
  setPasswordHash(newHash);
  logger.info("Auth", "Password changed successfully.");
  res.json({ success: true });
};

import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getPasswordHash, setPasswordHash, getJwtSecret } from "../models/db.js";
import { logger } from "../utils/logger.js";

// Simple in-memory rate limiter: max 10 attempts per IP per 15 minutes
const loginAttempts = new Map<string, { count: number; firstAt: number }>();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 10;

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
  const token = jwt.sign({ app: "centralfolio" }, getJwtSecret() + (hash || ""), { expiresIn: "7d" });
  logger.info("Auth", `Successful login from ${ip}`);
  res.json({ token });
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

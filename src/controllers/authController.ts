import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getPasswordHash, setPasswordHash, getJwtSecret } from "../models/db.js";
import { logger } from "../utils/logger.js";

export const getAuthStatus = (req: Request, res: Response) => {
  const configured = !!getPasswordHash();
  res.json({ configured });
};

export const setup = async (req: Request, res: Response) => {
  const { password } = req.body;
  if (getPasswordHash()) {
    return res.status(400).json({ error: "Password already configured. Use change-password instead." });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const hash = await bcrypt.hash(password, 12);
  setPasswordHash(hash);
  logger.info("Auth", "Initial password configured.");
  res.json({ success: true });
};

export const login = async (req: Request, res: Response) => {
  const { password } = req.body;
  const hash = getPasswordHash();
  if (!hash) {
    return res.status(400).json({ error: "No password configured. Complete setup first." });
  }
  const valid = await bcrypt.compare(String(password ?? ""), hash);
  if (!valid) {
    logger.warn("Auth", `Failed login attempt from ${req.ip}`);
    return res.status(401).json({ error: "Invalid password." });
  }
  const token = jwt.sign({ app: "centralfolio" }, getJwtSecret(), { expiresIn: "7d" });
  logger.info("Auth", `Successful login from ${req.ip}`);
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

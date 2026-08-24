import { Request, Response } from "express";
import { createApiToken, listApiTokens, revokeApiToken } from "../repositories/apiTokenRepository.js";
import { logger } from "../utils/logger.js";

// GET /api/tokens — metadata only; plaintext tokens are never recoverable after creation.
export const getApiTokens = (_req: Request, res: Response) => {
  try {
    res.json(listApiTokens());
  } catch (err: any) {
    logger.error("ApiTokens", `getApiTokens failed: ${err.message}`);
    res.status(500).json({ error: "Failed to load API tokens" });
  }
};

// POST /api/tokens — { name } → { id, name, token, createdAt }. The `token` field is shown once.
export const postApiToken = (req: Request, res: Response) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: "Token name is required" });
  try {
    res.status(201).json(createApiToken(name));
  } catch (err: any) {
    logger.error("ApiTokens", `postApiToken failed: ${err.message}`);
    res.status(500).json({ error: "Failed to create API token" });
  }
};

// DELETE /api/tokens/:id — revoke immediately; any client still using it gets 401 on its next call.
export const deleteApiToken = (req: Request, res: Response) => {
  const id = String(req.params.id);
  const removed = revokeApiToken(id);
  if (!removed) return res.status(404).json({ error: "Token not found" });
  res.json({ success: true });
};

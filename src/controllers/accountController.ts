import { Request, Response } from "express";
import { getAccountActive, setAccountActive, setAccountCustomName } from "../models/db.js";
import { onAccountDeactivated, onAccountModified } from "../services/cacheService.js";
import { logger } from "../utils/logger.js";

export const toggleAccountActive = (req: Request, res: Response) => {
  const { accountId } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    logger.warn('SnapTrade', `toggleAccountActive — missing or invalid 'isActive' boolean in body for account ${accountId}`);
    return res.status(400).json({ error: "Body must contain { isActive: boolean }" });
  }

  if (getAccountActive(String(accountId)) === null) {
    logger.warn('SnapTrade', `toggleAccountActive — account ${accountId} not found`);
    return res.status(404).json({ error: "Account not found" });
  }

  try {
    setAccountActive(String(accountId), isActive);
    if (!isActive) {
      onAccountDeactivated(String(accountId));
    } else {
      onAccountModified(String(accountId));
    }
    logger.info('SnapTrade', `toggleAccountActive — account ${accountId} set to ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
    res.json({ success: true, accountId, isActive });
  } catch (err: any) {
    logger.error('SnapTrade', `toggleAccountActive failed for ${accountId}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const renameAccount = (req: Request, res: Response) => {
  const { accountId } = req.params;
  const { name } = req.body;

  if (typeof name !== 'string' || !name.trim()) {
    logger.warn('SnapTrade', `renameAccount — missing or invalid 'name' in body for account ${accountId}`);
    return res.status(400).json({ error: "Body must contain { name: string }" });
  }

  if (getAccountActive(String(accountId)) === null) {
    logger.warn('SnapTrade', `renameAccount — account ${accountId} not found`);
    return res.status(404).json({ error: "Account not found" });
  }

  try {
    setAccountCustomName(String(accountId), name.trim());
    onAccountModified(String(accountId));
    logger.info('SnapTrade', `renameAccount — account ${accountId} renamed to "${name.trim()}"`);
    res.json({ success: true, accountId, name: name.trim() });
  } catch (err: any) {
    logger.error('SnapTrade', `renameAccount failed for ${accountId}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

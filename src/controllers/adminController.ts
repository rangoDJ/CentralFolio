import { Request, Response } from "express";
import { listAllUsersAcrossPortfolios, deleteUserFromPortfolios } from "../services/snaptrade.js";
import { listSettings, setSetting } from "../models/db.js";
import { clearAllCaches } from "../services/cacheService.js";
import { logger } from "../utils/logger.js";

export const listUsers = async (req: Request, res: Response) => {
  logger.info('Admin', 'GET /admin/users — listing all SnapTrade users');
  try {
    const users = await listAllUsersAcrossPortfolios();
    logger.info('Admin', `listUsers → returning ${users.length} user(s)`);
    res.json(users);
  } catch (err: any) {
    logger.error('Admin', `listUsers failed: ${err.message}`);
    res.status(500).json({ error: "Failed to list users", detail: err.message });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  const { userId } = req.params;
  logger.info('Admin', `DELETE /admin/users/${userId}`);
  try {
    await deleteUserFromPortfolios(String(userId));
    logger.info('Admin', `deleteUser("${userId}") succeeded`);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Admin', `deleteUser("${userId}") failed: ${err.message}`);
    res.status(500).json({ error: "Failed to delete user", detail: err.message });
  }
};

export const wipeAllUsers = async (req: Request, res: Response) => {
  logger.warn('Admin', 'POST /admin/wipe — wiping ALL SnapTrade users!');
  try {
    const users = await listAllUsersAcrossPortfolios();
    logger.warn('Admin', `Wiping ${users.length} unique user(s)...`);
    
    const results = {
      success: [] as string[],
      failed: [] as { userId: string, error: any }[]
    };

    for (const userId of users) {
      try {
        await deleteUserFromPortfolios(userId);
        results.success.push(userId);
        logger.info('Admin', `  ✓ Wiped user "${userId}"`);
      } catch (e: any) {
        results.failed.push({ userId, error: e.message || e });
        logger.warn('Admin', `  ✗ Failed to wipe user "${userId}": ${e.message}`);
      }
    }

    logger.info('Admin', `Wipe complete — ${results.success.length} succeeded, ${results.failed.length} failed`);
    res.json({ 
      success: true, 
      wipedCount: results.success.length,
      failedCount: results.failed.length,
      details: results
    });
  } catch (err: any) {
    logger.error('Admin', `wipeAllUsers fatal error: ${err.message}`);
    res.status(500).json({ error: "Failed to initiate wipe", detail: err.message });
  }
};

export const getSettings = (req: Request, res: Response) => {
  logger.info('Admin', 'GET /admin/settings');
  try {
    const settings = listSettings();
    const keys = Object.keys(settings);
    logger.debug('Admin', `getSettings → returning ${keys.length} key(s): ${keys.join(', ') || '(none)'}`);
    res.json(settings);
  } catch (err: any) {
    logger.error('Admin', `getSettings error: ${err.message}`);
    res.status(500).json({ error: "Failed to get settings", detail: err.message });
  }
};

export const clearCache = (_req: Request, res: Response) => {
  logger.warn('Admin', 'POST /admin/clear-cache — clearing all caches');
  try {
    clearAllCaches();
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Admin', `clearCache failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const updateSettings = (req: Request, res: Response) => {
  logger.info('Admin', `POST /admin/settings — updating ${Object.keys(req.body).length} key(s)`);
  try {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      // Mask sensitive values in logs
      const displayVal = key.toLowerCase().includes('key') || key.toLowerCase().includes('secret')
        ? '***' 
        : String(value);
      logger.info('Admin', `  Setting: ${key} = ${displayVal}`);
      setSetting(key, value as string);
    }
    logger.info('Admin', 'updateSettings complete');
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Admin', `updateSettings error: ${err.message}`);
    res.status(500).json({ error: "Failed to update settings", detail: err.message });
  }
};

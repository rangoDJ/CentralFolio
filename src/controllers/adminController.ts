import { Request, Response } from "express";
import { listAllUsersAcrossPortfolios, deleteUserFromPortfolios } from "../services/snaptrade.js";
import { listSettings, setSetting, clearAllUserPortfolios } from "../models/db.js";
import { clearAllCaches } from "../services/cacheService.js";
import { logger } from "../utils/logger.js";
import { emitDataChanged } from "../services/eventBus.js";
import { sendWebhookNotification } from "../services/notificationService.js";

// Keys that must never be written via the settings API — only set internally
const PROTECTED_SETTINGS = new Set(['jwt_secret', 'auth_password_hash']);

// Whitelisted settings keys that can be written via the settings API
const ALLOWED_SETTINGS = new Set([
  'dividend_background_fetch_enabled',
  'data_refresh_interval_hours',
  'dividend_providers',
  'eodhd_api_key',
  'polygon_api_key',
  'yahoo_api_key',
  'job_dividend-fetch_interval_hours',
  'job_holdings-refresh_interval_hours',
  'job_transactions-refresh_interval_hours',
  'notification_webhook_url',
  'notification_webhook_enabled'
]);

// Pattern for values that must be masked before sending to the client
const SENSITIVE_KEY_RE = /api_key|_secret|_hash|webhook_url/i;

function maskSettings(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings)
      .filter(([k]) => !PROTECTED_SETTINGS.has(k))
      .map(([k, v]) => [k, SENSITIVE_KEY_RE.test(k) && v ? '***' : v])
  );
}

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
  const { confirm } = req.body;
  if (confirm !== "WIPE_ALL") {
    logger.warn('Admin', 'POST /admin/wipe — reject wipe attempt: missing or invalid confirmation payload');
    return res.status(400).json({ error: "Wipe confirmation phrase is invalid or missing." });
  }

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
    const masked = maskSettings(settings);
    logger.debug('Admin', `getSettings → returning ${Object.keys(masked).length} key(s)`);
    res.json(masked);
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

    // Validate setting keys and value lengths
    for (const [key, value] of Object.entries(settings)) {
      if (!ALLOWED_SETTINGS.has(key)) {
        logger.warn('Admin', `updateSettings — attempt to write unauthorized or protected key: ${key}`);
        return res.status(403).json({ error: `Unauthorized or protected setting: ${key}` });
      }
      if (typeof value !== 'string') {
        return res.status(400).json({ error: `Value for key ${key} must be a string` });
      }
      if (value.length > 4000) {
        return res.status(400).json({ error: `Value for key ${key} exceeds maximum length of 4000 characters` });
      }
    }

    for (const [key, value] of Object.entries(settings)) {
      if (value === '***' && SENSITIVE_KEY_RE.test(key)) {
        logger.info('Admin', `  Setting: ${key} = *** (ignored masked placeholder)`);
        continue;
      }
      const displayVal = SENSITIVE_KEY_RE.test(key) ? '***' : String(value);
      logger.info('Admin', `  Setting: ${key} = ${displayVal}`);
      setSetting(key, String(value));
    }
    logger.info('Admin', 'updateSettings complete');
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Admin', `updateSettings error: ${err.message}`);
    res.status(500).json({ error: "Failed to update settings", detail: err.message });
  }
};

export const testNotification = async (_req: Request, res: Response) => {
  logger.info('Admin', 'POST /admin/test-notification');
  const result = await sendWebhookNotification('CentralFolio test notification', 'Your webhook is configured correctly.');
  if (!result.sent) {
    return res.status(400).json({ error: result.error || 'Failed to send test notification' });
  }
  res.json({ success: true });
};

export const purgeData = async (req: Request, res: Response) => {
  const { confirm } = req.body;
  if (confirm !== "PURGE_DATA") {
    logger.warn('Admin', 'POST /admin/purge-data — reject purge attempt: missing or invalid confirmation payload');
    return res.status(400).json({ error: "Purge confirmation phrase is invalid or missing." });
  }

  logger.warn('Admin', 'POST /admin/purge-data — purging user custom portfolios and cached data!');
  try {
    // Clear custom user portfolios (cascades to accounts links & targets)
    clearAllUserPortfolios();

    // Wipes every cache tier: accounts, positions, transactions, dividend_metadata, and memory cache
    clearAllCaches();

    // Emit change events for all domains to notify active UI clients
    emitDataChanged('accounts');
    emitDataChanged('holdings');
    emitDataChanged('transactions');
    emitDataChanged('dividends');
    emitDataChanged('targets');

    logger.info('Admin', 'Purge complete — user portfolios, cache, and dividend data deleted.');
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Admin', `purgeData fatal error: ${err.message}`);
    res.status(500).json({ error: "Failed to purge data", detail: err.message });
  }
};

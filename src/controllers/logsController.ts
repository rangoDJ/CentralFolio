import { Request, Response } from "express";
import { getRecentLogs, clearLogBuffer, type LogLevel } from "../utils/logger.js";
import { logger } from "../utils/logger.js";

const VALID_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);

// GET /api/admin/logs — initial snapshot for the Settings → Logs page. Live
// updates after that arrive over the existing /api/events SSE stream as `log`
// events, so this is only ever called once per page view (plus manual "clear").
export const getLogs = (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 3000);
  const rawLevel = String(req.query.minLevel ?? '');
  const minLevel = VALID_LEVELS.has(rawLevel as LogLevel) ? (rawLevel as LogLevel) : undefined;
  res.json(getRecentLogs(limit, minLevel));
};

export const clearLogs = (_req: Request, res: Response) => {
  clearLogBuffer();
  logger.info('Logs', 'Log buffer cleared from Settings');
  res.json({ success: true });
};

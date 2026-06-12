/**
 * Centralized logger for CentralFolio backend.
 * Provides timestamped, color-coded output with tagged namespaces.
 */

const COLORS = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  green:   '\x1b[32m',
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  magenta: '\x1b[35m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
};

const TAG_COLORS: Record<string, string> = {
  DB:            COLORS.magenta,
  API:           COLORS.cyan,
  SnapTrade:     COLORS.blue,
  Polygon:       COLORS.green,
  Yahoo:         COLORS.yellow,
  Cache:         COLORS.gray,
  Forecast:      COLORS.cyan,
  DividendSvc:   COLORS.cyan,
  Admin:         COLORS.magenta,
  Portfolio:     COLORS.blue,
  Server:        COLORS.green,
  Migration:     COLORS.yellow,
};

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatTag(tag: string): string {
  const color = TAG_COLORS[tag] ?? COLORS.white;
  return `${color}${COLORS.bold}[${tag}]${COLORS.reset}`;
}

function formatLine(level: 'info' | 'warn' | 'error' | 'debug', tag: string, msg: string): string {
  const ts = `${COLORS.dim}${timestamp()}${COLORS.reset}`;
  const lvlColors = { info: COLORS.white, warn: COLORS.yellow, error: COLORS.red, debug: COLORS.gray };
  const lvlStr = level !== 'info' ? ` ${lvlColors[level]}${level.toUpperCase()}${COLORS.reset}` : '';
  return `${ts}${lvlStr} ${formatTag(tag)} ${msg}`;
}

export const logger = {
  info(tag: string, msg: string, ...args: any[]) {
    console.log(formatLine('info', tag, msg), ...args);
  },
  warn(tag: string, msg: string, ...args: any[]) {
    console.warn(formatLine('warn', tag, msg), ...args);
  },
  error(tag: string, msg: string, ...args: any[]) {
    console.error(formatLine('error', tag, msg), ...args);
  },
  debug(tag: string, msg: string, ...args: any[]) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(formatLine('debug', tag, msg), ...args);
    }
  },
};

/** Express middleware: logs every incoming request and its response status+duration. */
import type { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const ms = Date.now() - start;
    const statusColor =
      res.statusCode >= 500 ? COLORS.red :
      res.statusCode >= 400 ? COLORS.yellow :
      res.statusCode >= 300 ? COLORS.cyan :
      COLORS.green;
    const status = `${statusColor}${res.statusCode}${COLORS.reset}`;
    const duration = `${COLORS.dim}${ms}ms${COLORS.reset}`;
    logger.info('API', `${method} ${originalUrl} → ${status} (${duration})`);
  });

  next();
}

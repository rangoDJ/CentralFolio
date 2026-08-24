/**
 * Centralized logger for CentralFolio backend.
 * Provides timestamped, color-coded console output with tagged namespaces,
 * plus an in-memory ring buffer + live subscription feed so the Settings →
 * Logs page can show what the server is doing without tailing a terminal.
 */

import { emitLog } from "../services/eventBus.js";

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: number;
  ts: string;       // ISO timestamp
  level: LogLevel;
  tag: string;
  msg: string;
}

// Bounded ring buffer — a long-running process can't grow this without limit.
// 3000 entries is generous for a live-tail view without becoming a memory leak.
const RING_BUFFER_SIZE = 3000;
const ringBuffer: LogEntry[] = [];
let nextId = 1;

/**
 * Record every log line — including debug ones the console suppresses — so
 * the live viewer can show more than the terminal's current LOG_LEVEL without
 * needing a restart. Broadcasting is fire-and-forget: a log call must never
 * throw because a listener downstream misbehaved.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function record(level: LogLevel, tag: string, msg: string): void {
  // A few call sites (requestLogger) embed ANSI color codes directly in the
  // message for terminal output — strip them so the web viewer doesn't show
  // raw escape sequences.
  const entry: LogEntry = { id: nextId++, ts: new Date().toISOString(), level, tag, msg: msg.replace(ANSI_RE, '') };
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();
  try {
    emitLog(entry);
  } catch {
    // Never let a broadcast failure break logging itself.
  }
}

/** Most recent entries, oldest first — for the initial snapshot on page load. */
export function getRecentLogs(limit = 500, minLevel?: LogLevel): LogEntry[] {
  const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const filtered = minLevel
    ? ringBuffer.filter(e => order[e.level] >= order[minLevel])
    : ringBuffer;
  return filtered.slice(-Math.min(limit, RING_BUFFER_SIZE));
}

export function clearLogBuffer(): void {
  ringBuffer.length = 0;
}

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

// Extra args (error objects, payloads) only ever went to the console before —
// fold them into the recorded message so the web viewer sees them too.
function withArgs(msg: string, args: any[]): string {
  if (args.length === 0) return msg;
  const parts = args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
  });
  return `${msg} ${parts.join(' ')}`;
}

export const logger = {
  info(tag: string, msg: string, ...args: any[]) {
    console.log(formatLine('info', tag, msg), ...args);
    record('info', tag, withArgs(msg, args));
  },
  warn(tag: string, msg: string, ...args: any[]) {
    console.warn(formatLine('warn', tag, msg), ...args);
    record('warn', tag, withArgs(msg, args));
  },
  error(tag: string, msg: string, ...args: any[]) {
    console.error(formatLine('error', tag, msg), ...args);
    record('error', tag, withArgs(msg, args));
  },
  debug(tag: string, msg: string, ...args: any[]) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(formatLine('debug', tag, msg), ...args);
    }
    // Recorded regardless of LOG_LEVEL — the live viewer can show debug lines
    // the console is currently suppressing, without a restart.
    record('debug', tag, withArgs(msg, args));
  },
};

/** Express middleware: logs every incoming request and its response status+duration. */
import type { Request, Response, NextFunction } from 'express';

// Redact secrets that may appear in query strings (e.g. the SSE ?token= used by
// EventSource, which can't send an Authorization header) so they never hit logs.
function redactUrl(url: string): string {
  return url.replace(/([?&](?:token|userSecret|secret|password)=)[^&]+/gi, '$1[redacted]');
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method } = req;
  const safeUrl = redactUrl(req.originalUrl);

  res.on('finish', () => {
    const ms = Date.now() - start;
    const statusColor =
      res.statusCode >= 500 ? COLORS.red :
      res.statusCode >= 400 ? COLORS.yellow :
      res.statusCode >= 300 ? COLORS.cyan :
      COLORS.green;
    const status = `${statusColor}${res.statusCode}${COLORS.reset}`;
    const duration = `${COLORS.dim}${ms}ms${COLORS.reset}`;
    logger.info('API', `${method} ${safeUrl} → ${status} (${duration})`);
  });

  next();
}

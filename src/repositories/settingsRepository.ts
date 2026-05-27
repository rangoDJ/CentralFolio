import { db } from "../models/database.js";
import { randomBytes } from "crypto";
import { logger } from "../utils/logger.js";

// ── General settings ──────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM global_settings WHERE key = ?").get(key) as any;
  logger.debug('DB', `getSetting("${key}") → ${row ? '"' + row.value + '"' : 'null'}`);
  return row ? row.value : null;
}

export function setSetting(key: string, value: string) {
  logger.info('DB', `setSetting("${key}") = "${value}"`);
  db.prepare("INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)").run(key, value);
}

export function listSettings(): Record<string, string> {
  const rows = db.prepare("SELECT * FROM global_settings").all() as any[];
  logger.debug('DB', `listSettings() → ${rows.length} key(s)`);
  const out: Record<string, string> = {};
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function getPasswordHash(): string | null {
  const row = db.prepare("SELECT value FROM global_settings WHERE key = 'auth_password_hash'").get() as any;
  return row?.value ?? null;
}

export function setPasswordHash(hash: string): void {
  db.prepare("INSERT OR REPLACE INTO global_settings (key, value) VALUES ('auth_password_hash', ?)").run(hash);
}

let _jwtSecret: string | null = null;

export function clearJwtSecretCache(): void {
  _jwtSecret = null;
}

export function getJwtSecret(): string {
  if (_jwtSecret) return _jwtSecret;
  const row = db.prepare("SELECT value FROM global_settings WHERE key = 'jwt_secret'").get() as any;
  if (row?.value) {
    _jwtSecret = row.value;
    return _jwtSecret;
  }
  const secret = randomBytes(64).toString('hex');
  db.prepare("INSERT OR REPLACE INTO global_settings (key, value) VALUES ('jwt_secret', ?)").run(secret);
  _jwtSecret = secret;
  return _jwtSecret;
}

import { db } from "../models/database.js";
import { randomBytes } from "crypto";
import { logger } from "../utils/logger.js";

// ── Prepared statements (compiled once at module load for performance) ─────────

const stmtGetSetting = db.prepare(
  "SELECT value FROM global_settings WHERE key = ?"
);

const stmtSetSetting = db.prepare(
  "INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)"
);

const stmtListSettings = db.prepare(
  "SELECT * FROM global_settings"
);

const stmtGetPasswordHash = db.prepare(
  "SELECT value FROM global_settings WHERE key = 'auth_password_hash'"
);

const stmtSetPasswordHash = db.prepare(
  "INSERT OR REPLACE INTO global_settings (key, value) VALUES ('auth_password_hash', ?)"
);

const stmtGetJwtSecret = db.prepare(
  "SELECT value FROM global_settings WHERE key = 'jwt_secret'"
);

const stmtSetJwtSecret = db.prepare(
  "INSERT OR REPLACE INTO global_settings (key, value) VALUES ('jwt_secret', ?)"
);

// ── General settings ──────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = stmtGetSetting.get(key) as any;
  logger.debug('DB', `getSetting("${key}") → ${row ? '"' + row.value + '"' : 'null'}`);
  return row ? row.value : null;
}

export function setSetting(key: string, value: string) {
  logger.info('DB', `setSetting("${key}") = "${value}"`);
  stmtSetSetting.run(key, value);
}

export function listSettings(): Record<string, string> {
  const rows = stmtListSettings.all() as any[];
  logger.debug('DB', `listSettings() → ${rows.length} key(s)`);
  const out: Record<string, string> = {};
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function getPasswordHash(): string | null {
  const row = stmtGetPasswordHash.get() as any;
  return row?.value ?? null;
}

export function setPasswordHash(hash: string): void {
  stmtSetPasswordHash.run(hash);
}

let _jwtSecret: string | null = null;

export function clearJwtSecretCache(): void {
  _jwtSecret = null;
}

export function getJwtSecret(): string {
  if (_jwtSecret) return _jwtSecret;
  const row = stmtGetJwtSecret.get() as any;
  if (row?.value) {
    _jwtSecret = row.value;
    return _jwtSecret;
  }
  const secret = randomBytes(64).toString('hex');
  stmtSetJwtSecret.run(secret);
  _jwtSecret = secret;
  return _jwtSecret;
}

import { db } from "../models/database.js";
import { randomUUID, randomBytes, createHash } from "crypto";
import { logger } from "../utils/logger.js";

export interface ApiTokenMeta {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

// Prefixed so requireAuth can tell an API token from a JWT at a glance,
// without trying (and failing) a JWT verify first on every request.
export const API_TOKEN_PREFIX = "cf_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const stmtInsert = db.prepare(`INSERT INTO api_tokens (id, name, tokenHash) VALUES (?, ?, ?)`);
const stmtList = db.prepare(`SELECT id, name, createdAt, lastUsedAt FROM api_tokens ORDER BY createdAt DESC`);
const stmtDelete = db.prepare(`DELETE FROM api_tokens WHERE id = ?`);
const stmtFindByHash = db.prepare(`SELECT id FROM api_tokens WHERE tokenHash = ?`);
const stmtTouch = db.prepare(`UPDATE api_tokens SET lastUsedAt = CURRENT_TIMESTAMP WHERE id = ?`);

/**
 * Creates a new token and returns its plaintext value. This is the only time
 * the plaintext is ever available — only its SHA-256 hash is stored, the same
 * "can't recover it, only reset it" guarantee as a password.
 */
export function createApiToken(name: string): { id: string; name: string; token: string; createdAt: string } {
  const id = randomUUID();
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  stmtInsert.run(id, name, hashToken(token));
  logger.info("ApiTokens", `Created token "${name}" (${id})`);
  return { id, name, token, createdAt: new Date().toISOString() };
}

export function listApiTokens(): ApiTokenMeta[] {
  return stmtList.all() as ApiTokenMeta[];
}

export function revokeApiToken(id: string): boolean {
  const res = stmtDelete.run(id);
  if (res.changes > 0) logger.info("ApiTokens", `Revoked token ${id}`);
  return res.changes > 0;
}

/** Verifies a bearer token against the stored hashes; records last-used on success. */
export function verifyApiToken(token: string): boolean {
  const row = stmtFindByHash.get(hashToken(token)) as { id: string } | undefined;
  if (!row) return false;
  stmtTouch.run(row.id);
  return true;
}

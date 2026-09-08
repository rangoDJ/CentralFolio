import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";
import {
  ALERT_RULE_TYPES,
  DEFAULT_RULE_CONFIG,
  type Alert,
  type AlertRule,
  type AlertRuleType,
} from "../services/alertRules.js";

/**
 * Storage for alert rules, the alerts they have fired, and the small amount of
 * memory the evaluator needs between runs (`alert_state`).
 *
 * Rules default to *disabled*: this app can reach an external webhook, and
 * silently starting to push on upgrade would be a surprise. The user turns on
 * what they want in Settings.
 */

export interface AlertEvent {
  id: number;
  ruleType: string;
  dedupeKey: string;
  severity: string;
  title: string;
  body: string;
  symbol: string | null;
  delivered: number;
  firedAt: string;
  acknowledgedAt: string | null;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

const stmtListRules = db.prepare("SELECT type, enabled, config FROM notification_rules");
const stmtUpsertRule = db.prepare(`
  INSERT INTO notification_rules (type, enabled, config)
  VALUES (?, ?, ?)
  ON CONFLICT(type) DO UPDATE SET enabled = excluded.enabled, config = excluded.config
`);

function parseConfig(raw: unknown): Record<string, number> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Only finite numbers survive — a malformed stored config must not make a
    // threshold NaN, which would compare false and silently disable the rule.
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Every known rule type, with stored settings applied over the defaults.
 * Types never configured come back disabled with their default thresholds, so
 * callers always see the full set.
 */
export function listAlertRules(): AlertRule[] {
  const stored = new Map(
    (stmtListRules.all() as any[]).map(r => [r.type, r]),
  );
  return ALERT_RULE_TYPES.map(type => {
    const row = stored.get(type);
    return {
      type,
      enabled: row ? row.enabled === 1 : false,
      config: { ...DEFAULT_RULE_CONFIG[type], ...parseConfig(row?.config) },
    };
  });
}

export function saveAlertRule(type: AlertRuleType, enabled: boolean, config: Record<string, number>): void {
  stmtUpsertRule.run(type, enabled ? 1 : 0, JSON.stringify(config ?? {}));
  logger.info("Alerts", `Rule "${type}" ${enabled ? "enabled" : "disabled"} ${JSON.stringify(config ?? {})}`);
}

// ── Fired alerts ──────────────────────────────────────────────────────────────

const stmtInsertEvent = db.prepare(`
  INSERT OR IGNORE INTO alert_events (ruleType, dedupeKey, severity, title, body, symbol, delivered)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtRecentKeys = db.prepare(
  "SELECT dedupeKey FROM alert_events WHERE firedAt >= datetime('now', ?)"
);

const stmtListEvents = db.prepare(
  "SELECT * FROM alert_events ORDER BY firedAt DESC, id DESC LIMIT ?"
);

const stmtUnacknowledgedCount = db.prepare(
  "SELECT COUNT(*) AS n FROM alert_events WHERE acknowledgedAt IS NULL"
);

const stmtAcknowledge = db.prepare(
  "UPDATE alert_events SET acknowledgedAt = CURRENT_TIMESTAMP WHERE id = ? AND acknowledgedAt IS NULL"
);

const stmtAcknowledgeAll = db.prepare(
  "UPDATE alert_events SET acknowledgedAt = CURRENT_TIMESTAMP WHERE acknowledgedAt IS NULL"
);

const stmtClearEvents = db.prepare("DELETE FROM alert_events");

/**
 * Dedupe keys fired within the retention window.
 *
 * Bounded rather than "all history" so a situation that resolves and genuinely
 * recurs months later can alert again — an ex-date that comes round next
 * quarter carries its own date in the key, but a drift band re-crossed after a
 * year is worth hearing about a second time.
 */
export function getRecentDedupeKeys(retentionDays = 180): Set<string> {
  const rows = stmtRecentKeys.all(`-${Math.max(1, Math.round(retentionDays))} days`) as { dedupeKey: string }[];
  return new Set(rows.map(r => r.dedupeKey));
}

/** Persist fired alerts. Returns the ones actually inserted (not duplicates). */
export function recordAlerts(alerts: Alert[], delivered: boolean): Alert[] {
  if (alerts.length === 0) return [];
  const inserted: Alert[] = [];
  db.transaction(() => {
    for (const a of alerts) {
      const res = stmtInsertEvent.run(
        a.ruleType, a.dedupeKey, a.severity, a.title, a.body, a.symbol ?? null, delivered ? 1 : 0,
      );
      if (res.changes > 0) inserted.push(a);
    }
  })();
  return inserted;
}

export function listAlertEvents(limit = 100): AlertEvent[] {
  return stmtListEvents.all(Math.max(1, Math.min(500, limit))) as AlertEvent[];
}

export function countUnacknowledged(): number {
  return (stmtUnacknowledgedCount.get() as { n: number }).n;
}

export function acknowledgeAlert(id: number): boolean {
  return stmtAcknowledge.run(id).changes > 0;
}

export function acknowledgeAllAlerts(): number {
  return stmtAcknowledgeAll.run().changes;
}

export function clearAlertEvents(): void {
  logger.warn("Alerts", "clearAlertEvents() — wiping alert history");
  stmtClearEvents.run();
}

// ── Evaluator memory ──────────────────────────────────────────────────────────

const stmtGetState = db.prepare("SELECT value FROM alert_state WHERE key = ?");
const stmtSetState = db.prepare(`
  INSERT INTO alert_state (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP
`);
const stmtAllStateWithPrefix = db.prepare("SELECT key, value FROM alert_state WHERE key LIKE ?");

export function getAlertState(key: string): string | null {
  return (stmtGetState.get(key) as { value: string } | undefined)?.value ?? null;
}

export function setAlertState(key: string, value: string): void {
  stmtSetState.run(key, value);
}

/** All state rows under a prefix, keyed by the remainder — e.g. "rating:" → symbol. */
export function getAlertStateByPrefix(prefix: string): Map<string, string> {
  const rows = stmtAllStateWithPrefix.all(`${prefix}%`) as { key: string; value: string }[];
  return new Map(rows.map(r => [r.key.slice(prefix.length), r.value]));
}

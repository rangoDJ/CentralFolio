import { Request, Response } from "express";
import {
  listAlertRules,
  saveAlertRule,
  listAlertEvents,
  countUnacknowledged,
  acknowledgeAlert,
  acknowledgeAllAlerts,
  clearAlertEvents,
} from "../repositories/alertRepository.js";
import { runAlertEvaluation } from "../services/alertService.js";
import { ALERT_RULE_TYPES, DEFAULT_RULE_CONFIG, type AlertRuleType } from "../services/alertRules.js";
import { logger } from "../utils/logger.js";

// GET /api/alerts/rules
export const listRulesHandler = (_req: Request, res: Response) => {
  res.json({ rules: listAlertRules(), defaults: DEFAULT_RULE_CONFIG });
};

// PUT /api/alerts/rules/:type
export const saveRuleHandler = (req: Request, res: Response) => {
  const type = String(req.params.type) as AlertRuleType;
  if (!ALERT_RULE_TYPES.includes(type)) {
    return res.status(400).json({ error: `Unknown rule type: ${type}` });
  }

  const { enabled, config } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean" });
  }

  // Only numeric settings this rule actually understands are stored, so a typo
  // can't silently persist as a threshold nobody reads.
  const allowed = Object.keys(DEFAULT_RULE_CONFIG[type]);
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(config ?? {})) {
    if (!allowed.includes(key)) {
      return res.status(400).json({ error: `Unknown setting "${key}" for ${type}. Expected: ${allowed.join(", ")}` });
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ error: `"${key}" must be a non-negative number` });
    }
    clean[key] = n;
  }

  saveAlertRule(type, enabled, clean);
  res.json({ success: true, rules: listAlertRules() });
};

// GET /api/alerts?limit=100
export const listAlertsHandler = (req: Request, res: Response) => {
  const limit = Number(req.query.limit);
  res.json({
    alerts: listAlertEvents(Number.isFinite(limit) ? limit : 100),
    unacknowledged: countUnacknowledged(),
  });
};

// POST /api/alerts/evaluate  — run the rules now.
// ?preview=true evaluates every rule (even disabled ones) without persisting or
// notifying, so the user can see what a rule would say before switching it on.
export const evaluateHandler = async (req: Request, res: Response) => {
  const preview = req.query.preview === "true";
  try {
    const result = await runAlertEvaluation(preview);
    logger.info("Alerts", `Manual ${preview ? "preview" : "evaluation"} — ${result.fired} alert(s)`);
    res.json(result);
  } catch (err: any) {
    logger.error("Alerts", `Evaluation failed: ${err.message}`);
    res.status(500).json({ error: "Failed to evaluate alerts" });
  }
};

// POST /api/alerts/:id/acknowledge
export const acknowledgeHandler = (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  if (!acknowledgeAlert(id)) return res.status(404).json({ error: "Alert not found or already acknowledged" });
  res.json({ success: true, unacknowledged: countUnacknowledged() });
};

// POST /api/alerts/acknowledge-all
export const acknowledgeAllHandler = (_req: Request, res: Response) => {
  const count = acknowledgeAllAlerts();
  res.json({ success: true, acknowledged: count });
};

// DELETE /api/alerts
export const clearAlertsHandler = (_req: Request, res: Response) => {
  clearAlertEvents();
  res.json({ success: true });
};

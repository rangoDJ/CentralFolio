import { getSetting } from "../models/db.js";
import { logger } from "../utils/logger.js";

export interface WebhookPayload {
  content: string;   // Discord-compatible field, so a Discord channel webhook works unmodified.
  title: string;
  message: string;
  timestamp: string;
}

/** Pure payload builder (exported for tests) — no I/O. */
export function buildWebhookPayload(title: string, message: string, now = new Date()): WebhookPayload {
  return {
    content: `**${title}**\n${message}`,
    title,
    message,
    timestamp: now.toISOString(),
  };
}

export interface NotificationResult {
  sent: boolean;
  error?: string;
}

/**
 * Fires a generic JSON webhook (Discord-compatible `content` field included)
 * if one is configured and enabled. Never throws — a broken notification must
 * not break the caller (a background job, etc); check the returned result if
 * the caller needs to know whether delivery actually succeeded.
 */
export async function sendWebhookNotification(title: string, message: string): Promise<NotificationResult> {
  const enabled = getSetting("notification_webhook_enabled") === "true";
  const url = getSetting("notification_webhook_url");
  if (!enabled || !url) {
    return { sent: false, error: "No webhook configured" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWebhookPayload(title, message)),
    });
    if (!res.ok) {
      logger.warn("Notify", `Webhook returned ${res.status} ${res.statusText}`);
      return { sent: false, error: `Webhook returned ${res.status} ${res.statusText}` };
    }
    return { sent: true };
  } catch (err: any) {
    logger.warn("Notify", `Webhook delivery failed: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

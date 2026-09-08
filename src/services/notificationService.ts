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

// Without an explicit signal, fetch only gives up at undici's ~300s header
// timeout — long enough for a black-holed webhook URL to stall the admin
// "test notification" request (which awaits this) for five minutes.
const WEBHOOK_TIMEOUT_MS = 10_000;

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
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn("Notify", `Webhook returned ${res.status} ${res.statusText}`);
      return { sent: false, error: `Webhook returned ${res.status} ${res.statusText}` };
    }
    return { sent: true };
  } catch (err: any) {
    // AbortSignal.timeout rejects with a TimeoutError whose message ("The
    // operation was aborted due to timeout") doesn't say what timed out.
    const reason = err?.name === "TimeoutError"
      ? `Webhook did not respond within ${WEBHOOK_TIMEOUT_MS / 1000}s`
      : err.message;
    logger.warn("Notify", `Webhook delivery failed: ${reason}`);
    return { sent: false, error: reason };
  }
}

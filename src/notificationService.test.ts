import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWebhookPayload } from "./services/notificationService.js";

test("buildWebhookPayload: includes a Discord-compatible content field", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const payload = buildWebhookPayload("Job failed", "boom", now);
  assert.equal(payload.title, "Job failed");
  assert.equal(payload.message, "boom");
  assert.equal(payload.content, "**Job failed**\nboom");
  assert.equal(payload.timestamp, "2026-01-01T00:00:00.000Z");
});

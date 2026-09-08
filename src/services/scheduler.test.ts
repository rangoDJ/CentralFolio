import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// schedulerService imports models/db.js, which opens the real (singleton)
// SQLite DB at DATA_DIR on first import — point it at a throwaway directory
// before importing so this test never touches the real snaptrade.db.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-scheduler-test-"));

const { hoursToCron, MAX_INTERVAL_DAYS } = await import("./schedulerService.js");

test("hoursToCron: 0 or negative means manual-only", () => {
  assert.equal(hoursToCron(0), null);
  assert.equal(hoursToCron(-5), null);
});

test("hoursToCron: sub-hour intervals become minute steps", () => {
  assert.equal(hoursToCron(0.5), "*/30 * * * *");
  assert.equal(hoursToCron(0.1), "*/6 * * * *");
});

test("hoursToCron: intervals under a day become hour steps", () => {
  assert.equal(hoursToCron(1), "0 */1 * * *");
  assert.equal(hoursToCron(6), "0 */6 * * *");
  assert.equal(hoursToCron(23), "0 */23 * * *");
});

test("hoursToCron: a day or more becomes a day-of-month step", () => {
  assert.equal(hoursToCron(24), "0 0 */1 * *");
  assert.equal(hoursToCron(168), "0 0 */7 * *");
});

test("hoursToCron: day steps never exceed cron's 1-31 day field", () => {
  // Regression guard: a step above 31 enumerates 1, 34, 67... against a 1-31
  // range, so it yields only the 1st — the job silently became monthly instead
  // of running at the configured interval.
  for (const hours of [720, 800, 2400, 100000]) {
    const expr = hoursToCron(hours)!;
    const dayStep = Number(expr.split(" ")[2].replace("*/", ""));
    assert.ok(
      dayStep >= 1 && dayStep <= MAX_INTERVAL_DAYS,
      `${hours}h produced day step ${dayStep}, outside 1..${MAX_INTERVAL_DAYS}`,
    );
  }
});

test("hoursToCron: clamps to the maximum expressible interval rather than dropping to monthly", () => {
  assert.equal(hoursToCron(800), `0 0 */${MAX_INTERVAL_DAYS} * *`);
  assert.equal(hoursToCron(2400), `0 0 */${MAX_INTERVAL_DAYS} * *`);
});

test("hoursToCron: every generated expression is a valid cron string", async () => {
  const cron = (await import("node-cron")).default;
  for (const hours of [0.1, 0.5, 1, 6, 23, 24, 168, 672, 800, 5000]) {
    const expr = hoursToCron(hours);
    if (expr === null) continue;
    assert.equal(cron.validate(expr), true, `${hours}h produced invalid cron "${expr}"`);
  }
});

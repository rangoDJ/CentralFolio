import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "./utils/concurrency.js";

test("preserves input order regardless of completion order", async () => {
  const out = await mapWithConcurrency([10, 1, 5], 3, async (ms, i) => {
    await new Promise(r => setTimeout(r, ms));
    return i * 100;
  });
  assert.deepEqual(out, [0, 100, 200]);
});

test("never exceeds the concurrency limit", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  await mapWithConcurrency(items, 4, async (x) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return x;
  });
  assert.ok(maxInFlight <= 4, `maxInFlight was ${maxInFlight}, expected <= 4`);
  assert.ok(maxInFlight > 1, "expected some real parallelism");
});

test("handles empty input and limit larger than item count", async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async x => x), []);
  assert.deepEqual(await mapWithConcurrency([1, 2], 10, async x => x * 2), [2, 4]);
});

test("rejects an invalid limit", async () => {
  await assert.rejects(() => mapWithConcurrency([1], 0, async x => x));
});

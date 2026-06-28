/**
 * Run `fn` over `items` with at most `limit` invocations in flight at once.
 *
 * Replaces unbounded `Promise.all(items.map(fn))` fan-outs that can flood
 * external APIs (SnapTrade, Yahoo) and trip rate limits. Results are returned
 * in input order. If `fn` rejects, the rejection propagates (like Promise.all),
 * so callers that want to tolerate per-item failures should catch inside `fn`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (limit < 1) throw new Error(`mapWithConcurrency: limit must be >= 1 (got ${limit})`);
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

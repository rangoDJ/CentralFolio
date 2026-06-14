/**
 * Shared SnapTrade error extractor used across all SnapTrade-related controllers.
 *
 * Pulls a clean, human-readable message from the SDK's deeply-nested error shapes
 * while returning a safe, generic message to the client.
 *
 * @param err          - Any error thrown by the SnapTrade SDK or downstream code.
 * @param clientFallback - Generic message sent to the client when no specific detail is available.
 * @returns `{ log }` — full detail for server-side logging.
 *          `{ client }` — safe, generic message returned in the API response.
 */
export function snapTradeError(err: any, clientFallback: string): { log: string; client: string } {
  const body = err?.responseBody ?? err?.response?.data;
  const log = body?.detail || body?.message || err?.message || 'unknown error';
  const client = body?.detail || clientFallback;
  return { log, client };
}

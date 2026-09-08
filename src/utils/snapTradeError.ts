/**
 * Shared SnapTrade error extractor used across all SnapTrade-related controllers.
 *
 * Pulls a clean, human-readable message from the SDK's deeply-nested error shapes
 * while returning a safe, generic message to the client.
 *
 * Also maps the failure onto the right HTTP status. Every caller used to answer
 * 500 regardless, which told the client "this server is broken" when the real
 * cause was upstream — an expired brokerage connection, a symbol SnapTrade
 * doesn't know, or a rate limit. That matters in three ways: the UI cannot say
 * anything useful, a client cannot back off on 429, and 5xx monitoring is
 * dominated by failures that are not this app's.
 *
 * @param err            - Any error thrown by the SnapTrade SDK or downstream code.
 * @param clientFallback - Generic message sent to the client when no specific detail is available.
 * @returns `{ log }`      full detail for server-side logging.
 *          `{ client }`   safe, generic message returned in the API response.
 *          `{ status }`   HTTP status this handler should answer with.
 *          `{ upstreamStatus }` what SnapTrade returned, or null if the call never landed.
 */
export function snapTradeError(err: any, clientFallback: string): {
  log: string;
  client: string;
  status: number;
  upstreamStatus: number | null;
} {
  const body = err?.responseBody ?? err?.response?.data;
  const log = body?.detail || body?.message || err?.message || 'unknown error';

  const upstreamStatus: number | null =
    typeof err?.status === 'number' ? err.status
    : typeof err?.response?.status === 'number' ? err.response.status
    : null;

  return { log, client: clientFallback, status: statusFor(upstreamStatus), upstreamStatus };
}

/**
 * Never propagate an upstream 401 as our own 401: the browser client treats a
 * 401 as "your session expired" and bounces to the login page, so a brokerage
 * credential problem would silently log the user out of CentralFolio itself.
 * Upstream auth failures are a bad gateway from this API's point of view.
 */
function statusFor(upstreamStatus: number | null): number {
  if (upstreamStatus === 429) return 429;                       // let clients back off
  if (upstreamStatus != null && upstreamStatus >= 400) return 502;
  return 500;                                                   // genuinely our own failure
}

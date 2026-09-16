import type { Request } from "express";

/**
 * Validates a post-connection redirect URL supplied by the frontend before it is
 * handed to SnapTrade as `customRedirect`. Only http(s) URLs pointing back at
 * this server's own hostname are accepted, so the endpoint can't be used as an
 * open redirect. Returns undefined when the URL is missing or rejected.
 *
 * `req.hostname` honours X-Forwarded-Host because `trust proxy` is enabled.
 */
export function safeRedirect(req: Pick<Request, "hostname">, raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.hostname !== req.hostname) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

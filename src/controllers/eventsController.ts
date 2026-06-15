import { Request, Response } from "express";
import { subscribe, unsubscribe, BusEvent, BusListener } from "../services/eventBus.js";
import { logger } from "../utils/logger.js";

const HEARTBEAT_MS = 25_000;

/**
 * GET /api/events — Server-Sent Events stream.
 *
 * Pushes `data-changed` and `job-status` events from the in-process event bus
 * so the web UI can refresh affected views live, without polling. Auth is
 * handled by requireAuth (which accepts a ?token= query param for EventSource).
 */
export function streamEvents(req: Request, res: Response) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy buffering (e.g. nginx) so events flush immediately.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Open the stream with a comment + a retry hint for the browser's auto-reconnect.
  res.write("retry: 5000\n\n");
  logger.debug("SSE", "client connected");

  const send = (event: BusEvent) => {
    const name = event.type;
    res.write(`event: ${name}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const listener: BusListener = (event) => {
    try {
      send(event);
    } catch (err: any) {
      logger.debug("SSE", `write failed, dropping client: ${err.message}`);
      cleanup();
    }
  };
  subscribe(listener);

  // Heartbeat comment keeps idle connections (and proxies) alive and lets us
  // notice dead sockets.
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      cleanup();
    }
  }, HEARTBEAT_MS);

  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe(listener);
    logger.debug("SSE", "client disconnected");
  }

  req.on("close", cleanup);
}

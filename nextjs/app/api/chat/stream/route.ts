/**
 * Chat Stream Endpoint (SSE Proxy)
 *
 * GET /api/chat/stream - Proxies SSE stream from daemon GET /session/chat/stream
 *
 * Byte-transparent: the daemon's SSE bytes flow through unchanged.
 * On daemon connection failure, returns an SSE error event so the
 * client handles it uniformly.
 */

import * as sessionClient from "@/lib/session-client";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("api/chat/stream");

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function errorSSEResponse(code: string, message: string): Response {
  const event = JSON.stringify({ type: "error", code, message });
  const body = `data: ${event}\n\n`;
  return new Response(body, { headers: SSE_HEADERS });
}

export async function GET() {
  try {
    const daemonResponse = await sessionClient.getChatStream();
    if (!daemonResponse.ok || !daemonResponse.body) {
      log.error(`Daemon stream returned ${daemonResponse.status}`);
      return errorSSEResponse(
        "DAEMON_ERROR",
        "Could not connect to daemon stream",
      );
    }
    return new Response(daemonResponse.body, { headers: SSE_HEADERS });
  } catch (err) {
    log.error("Daemon stream connection failed", err);
    return errorSSEResponse(
      "DAEMON_UNAVAILABLE",
      err instanceof Error ? err.message : "Daemon is not available",
    );
  }
}

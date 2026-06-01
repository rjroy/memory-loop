/**
 * Chat Stream Endpoint (SSE Proxy)
 *
 * GET /api/chat/[sessionId]/stream - Proxies SSE from daemon GET /session/:sessionId/chat
 *
 * Byte-transparent: the daemon's SSE bytes flow through unchanged.
 * The sessionId is in the path (no query string). On daemon connection
 * failure, returns an SSE error event so the client handles it uniformly.
 *
 * The daemon replays raw turn events (session_ready, response_start,
 * response_chunk..., tool events, response_end | error | aborted).
 * There is no snapshot wrapper event — the proxy passes bytes through as-is.
 */

import { NextRequest } from "next/server";
import * as sessionClient from "@/lib/daemon/sessions";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("api/chat/[sessionId]/stream");

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

interface RouteParams {
  params: Promise<{
    sessionId: string;
  }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  try {
    const daemonResponse = await sessionClient.getChatStream(sessionId);
    if (!daemonResponse.ok || !daemonResponse.body) {
      log.error(`Daemon stream returned ${daemonResponse.status} for session ${sessionId}`);
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

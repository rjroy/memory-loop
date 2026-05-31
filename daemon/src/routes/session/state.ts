/**
 * Session State Endpoint (keyed)
 *
 * GET /session/:sessionId/state - Get the live state for a session. An unknown
 * id returns an idle state (sessionId: null, isStreaming: false).
 */

import type { Context } from "hono";
import { getState } from "../../streaming/live-session-controller";

export function sessionStateHandler(c: Context): Response {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "sessionId is required" } },
      400
    );
  }

  return c.json(getState(sessionId));
}

/**
 * Session Clear Endpoint (keyed)
 *
 * POST /session/:sessionId/clear - Clear a session (abort its turn, discard its
 * pending prompts, remove it from the live registry, emit session_cleared to its
 * subscribers). Per-id: clearing one session never touches another.
 */

import type { Context } from "hono";
import { clearSession } from "../../streaming/live-session-controller";

export function sessionClearHandler(c: Context): Response {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "sessionId is required" } },
      400
    );
  }

  clearSession(sessionId);
  return c.json({ success: true });
}

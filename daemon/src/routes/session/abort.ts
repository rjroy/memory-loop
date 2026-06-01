/**
 * Abort Chat Endpoint (keyed)
 *
 * POST /session/:sessionId/abort - Abort the current turn for a session.
 *
 * The session id comes from the PATH. abortProcessing is idempotent: a session
 * that is not processing (already finished, or never started) is a safe no-op.
 * The old "session mismatch" 409 guard is gone — a keyed lookup makes it
 * meaningless.
 */

import type { Context } from "hono";
import { abortProcessing, isProcessing } from "../../streaming/live-session-controller";

export function chatAbortHandler(c: Context): Response {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "sessionId is required" } },
      400
    );
  }

  // Idempotent: if not processing, still return success (processing may have
  // just finished, or this session has no live turn).
  if (!isProcessing(sessionId)) {
    return c.json({ success: true, alreadyComplete: true });
  }

  abortProcessing(sessionId);
  return c.json({ success: true });
}

/**
 * Abort Chat Endpoint
 *
 * POST /session/chat/abort - Abort the current streaming response
 *
 * Request body:
 * - sessionId: string (required, must match current session)
 */

import type { Context } from "hono";
import { z } from "zod";
import { getController } from "../../session-controller";

const AbortRequestSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
});

export async function chatAbortHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      400
    );
  }

  const result = AbortRequestSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: result.error.issues[0]?.message ?? "Invalid request" } },
      400
    );
  }

  const { sessionId } = result.data;
  const controller = getController();
  const state = controller.getState();

  // Validate session matches
  if (state.sessionId !== sessionId) {
    return c.json({ error: "Session mismatch" }, 409);
  }

  // Idempotent: if not streaming, still return success (processing may have just finished)
  if (!controller.isStreaming()) {
    return c.json({ success: true, alreadyComplete: true });
  }

  controller.abortProcessing();
  return c.json({ success: true });
}

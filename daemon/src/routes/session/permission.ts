/**
 * Tool Permission Response Endpoint
 *
 * POST /session/chat/permission - Resolve a pending tool permission request
 *
 * Request body:
 * - sessionId: string (required)
 * - toolUseId: string (required)
 * - allowed: boolean (required)
 */

import type { Context } from "hono";
import { z } from "zod";
import { getController } from "../../session-controller";

const PermissionRequestSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  toolUseId: z.string().min(1, "toolUseId is required"),
  allowed: z.boolean(),
});

export async function chatPermissionHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      400
    );
  }

  const result = PermissionRequestSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: result.error.issues[0]?.message ?? "Invalid request" } },
      400
    );
  }

  const { sessionId, toolUseId, allowed } = result.data;
  const controller = getController();
  const state = controller.getState();

  if (state.sessionId !== sessionId) {
    return c.json(
      { error: { code: "SESSION_MISMATCH", message: "Session mismatch. This permission request may have expired." } },
      409
    );
  }

  controller.respondToPrompt(toolUseId, {
    type: "tool_permission",
    allowed,
  });

  return c.json({ success: true });
}

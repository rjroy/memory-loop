/**
 * Tool Permission Response Endpoint (keyed)
 *
 * POST /session/:sessionId/permission - Resolve a pending tool permission request.
 *
 * The session id comes from the PATH. The old "session mismatch" 409 guard is
 * gone — respondToPrompt resolves against that session's pending prompts, or is
 * a safe no-op (emitting prompt_response_rejected) if the prompt is not found.
 *
 * Request body:
 * - toolUseId: string (required)
 * - allowed: boolean (required)
 */

import type { Context } from "hono";
import { z } from "zod";
import { respondToPrompt } from "../../streaming/live-session-controller";

const PermissionRequestSchema = z.object({
  toolUseId: z.string().min(1, "toolUseId is required"),
  allowed: z.boolean(),
});

export async function chatPermissionHandler(c: Context): Promise<Response> {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "sessionId is required" } },
      400
    );
  }

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

  const { toolUseId, allowed } = result.data;

  respondToPrompt(sessionId, toolUseId, {
    type: "tool_permission",
    allowed,
  });

  return c.json({ success: true });
}

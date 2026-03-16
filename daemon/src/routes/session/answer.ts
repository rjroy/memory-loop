/**
 * AskUserQuestion Response Endpoint
 *
 * POST /session/chat/answer - Resolve a pending AskUserQuestion request
 *
 * Request body:
 * - sessionId: string (required)
 * - toolUseId: string (required)
 * - answers: Record<string, string> (required)
 */

import type { Context } from "hono";
import { z } from "zod";
import { getController } from "../../session-controller";

const AnswerRequestSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  toolUseId: z.string().min(1, "toolUseId is required"),
  answers: z.record(z.string(), z.string()),
});

export async function chatAnswerHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      400
    );
  }

  const result = AnswerRequestSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: result.error.issues[0]?.message ?? "Invalid request" } },
      400
    );
  }

  const { sessionId, toolUseId, answers } = result.data;
  const controller = getController();
  const state = controller.getState();

  if (state.sessionId !== sessionId) {
    return c.json(
      { error: { code: "SESSION_MISMATCH", message: "Session mismatch. This question may have expired." } },
      409
    );
  }

  controller.respondToPrompt(toolUseId, {
    type: "ask_user_question",
    answers,
  });

  return c.json({ success: true });
}

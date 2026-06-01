/**
 * AskUserQuestion Response Endpoint (keyed)
 *
 * POST /session/:sessionId/answer - Resolve a pending AskUserQuestion request.
 *
 * The session id comes from the PATH. The old "session mismatch" 409 guard is
 * gone — respondToPrompt resolves against that session's pending prompts, or is
 * a safe no-op (emitting prompt_response_rejected) if the prompt is not found.
 *
 * Request body:
 * - toolUseId: string (required)
 * - answers: Record<string, string> (required)
 */

import type { Context } from "hono";
import { z } from "zod";
import { respondToPrompt } from "../../streaming/live-session-controller";

const AnswerRequestSchema = z.object({
  toolUseId: z.string().min(1, "toolUseId is required"),
  answers: z.record(z.string(), z.string()),
});

export async function chatAnswerHandler(c: Context): Promise<Response> {
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

  const result = AnswerRequestSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: result.error.issues[0]?.message ?? "Invalid request" } },
      400
    );
  }

  const { toolUseId, answers } = result.data;

  respondToPrompt(sessionId, toolUseId, {
    type: "ask_user_question",
    answers,
  });

  return c.json({ success: true });
}

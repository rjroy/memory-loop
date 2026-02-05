/**
 * AskUserQuestion Response Endpoint
 *
 * POST /api/chat/[sessionId]/answer/[toolUseId]
 *
 * Resolves a pending AskUserQuestion request.
 *
 * Request body:
 * - answers: Record<string, string>
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { getController } from "@/lib/controller";

const AnswerResponseSchema = z.object({
  answers: z.record(z.string(), z.string()),
});

interface RouteParams {
  params: Promise<{
    sessionId: string;
    toolUseId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId, toolUseId } = await params;

  // Validate session matches current session
  const controller = getController();
  const state = controller.getState();

  if (state.sessionId !== sessionId) {
    return Response.json(
      { error: "Session mismatch. This question may have expired." },
      { status: 409 }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = AnswerResponseSchema.safeParse(body);
  if (!result.success) {
    return Response.json(
      { error: result.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { answers } = result.data;

  // Resolve the pending question
  controller.respondToPrompt(toolUseId, {
    type: "ask_user_question",
    answers,
  });

  return Response.json({ success: true });
}

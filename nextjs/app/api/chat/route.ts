/**
 * Chat Send Endpoint
 *
 * POST /api/chat - Submit a message to the controller (fire-and-forget)
 *
 * Request body:
 * - vaultId: string (required)
 * - vaultPath: string (required)
 * - sessionId: string (optional, resume if provided)
 * - prompt: string (required)
 *
 * Response: JSON with { sessionId } on success.
 * Clients connect to GET /api/chat/stream to receive SSE events.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { getController } from "@/lib/controller";
import { AlreadyProcessingError } from "@/lib/streaming";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/chat");

const ChatRequestSchema = z.object({
  vaultId: z.string().min(1, "vaultId is required"),
  vaultPath: z.string().min(1, "vaultPath is required"),
  sessionId: z.string().optional(),
  prompt: z.string().min(1, "Prompt is required"),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      { status: 400 }
    );
  }

  const result = ChatRequestSchema.safeParse(body);
  if (!result.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: result.error.issues[0]?.message ?? "Invalid request",
        },
      },
      { status: 400 }
    );
  }

  const { vaultId, vaultPath, sessionId, prompt } = result.data;
  const controller = getController();

  try {
    await controller.sendMessage({
      vaultId,
      vaultPath,
      sessionId: sessionId ?? null,
      prompt,
    });

    // sendMessage returns immediately (fire-and-forget). Get state for response.
    const state = controller.getState();
    return Response.json({ sessionId: state.sessionId });
  } catch (err) {
    if (err instanceof AlreadyProcessingError) {
      return Response.json(
        { error: { code: err.code, message: err.message } },
        { status: 409 }
      );
    }

    log.error("Chat request failed", err);
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message:
            err instanceof Error ? err.message : "Internal error",
        },
      },
      { status: 500 }
    );
  }
}

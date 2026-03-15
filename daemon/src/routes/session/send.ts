/**
 * Chat Send Endpoint
 *
 * POST /session/chat/send - Submit a message to the controller (fire-and-forget)
 *
 * Request body:
 * - vaultId: string (required)
 * - vaultPath: string (required)
 * - sessionId: string (optional, resume if provided)
 * - prompt: string (required)
 *
 * Response: JSON with { sessionId } on success.
 */

import type { Context } from "hono";
import { z } from "zod";
import { getController } from "../../session-controller";
import { AlreadyProcessingError } from "@memory-loop/shared";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("session/chat/send");

const ChatRequestSchema = z.object({
  vaultId: z.string().min(1, "vaultId is required"),
  vaultPath: z.string().min(1, "vaultPath is required"),
  sessionId: z.string().optional(),
  prompt: z.string().min(1, "Prompt is required"),
});

export async function chatSendHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      400
    );
  }

  const result = ChatRequestSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: result.error.issues[0]?.message ?? "Invalid request",
        },
      },
      400
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
    return c.json({ sessionId: state.sessionId });
  } catch (err) {
    if (err instanceof AlreadyProcessingError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        409
      );
    }

    log.error("Chat request failed", err);
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : "Internal error",
        },
      },
      500
    );
  }
}

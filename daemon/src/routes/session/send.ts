/**
 * Chat Send Endpoint (keyed)
 *
 * POST /session/:sessionId/chat - Start a turn for a session (fire-and-forget).
 *
 * The session id comes from the PATH (client-minted), not the body.
 *
 * Request body:
 * - vaultId: string (required)
 * - vaultPath: string (required)
 * - prompt: string (required)
 *
 * Response: JSON with { sessionId } on success. AlreadyProcessingError → 409
 * (preserving its code/message); any other error → 500. The error event is
 * already emitted to the session's subscribers by the controller; the POST still
 * returns an HTTP error so the proxy/frontend surface it.
 */

import type { Context } from "hono";
import { z } from "zod";
import { sendMessage } from "../../streaming/live-session-controller";
import { AlreadyProcessingError, createLogger } from "@memory-loop/shared";

const log = createLogger("session/chat/send");

const ChatRequestSchema = z.object({
  vaultId: z.string().min(1, "vaultId is required"),
  vaultPath: z.string().min(1, "vaultPath is required"),
  prompt: z.string().min(1, "Prompt is required"),
});

export async function chatSendHandler(c: Context): Promise<Response> {
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

  const { vaultId, vaultPath, prompt } = result.data;

  try {
    // Fire-and-forget: sendMessage starts the turn and returns immediately. The
    // turn runs to completion regardless of client connectivity.
    await sendMessage({ vaultId, vaultPath, sessionId, prompt });
    return c.json({ sessionId });
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

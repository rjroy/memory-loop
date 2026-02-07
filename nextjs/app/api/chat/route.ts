/**
 * SSE Chat Endpoint
 *
 * POST /api/chat - Start or continue a chat session
 *
 * Request body:
 * - vaultId: string (required)
 * - vaultPath: string (required)
 * - sessionId: string (optional, resume if provided)
 * - prompt: string (required)
 *
 * Response: Server-Sent Events stream
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { getController, type SessionEvent } from "@/lib/controller";
import { encodeSSE, SSE_HEADERS } from "@/lib/sse";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/chat");

// Request schema
const ChatRequestSchema = z.object({
  vaultId: z.string().min(1, "vaultId is required"),
  vaultPath: z.string().min(1, "vaultPath is required"),
  sessionId: z.string().optional(),
  prompt: z.string().min(1, "Prompt is required"),
});

export async function POST(request: NextRequest) {
  // Parse and validate request
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = ChatRequestSchema.safeParse(body);
  if (!result.success) {
    return Response.json(
      { error: result.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { vaultId, vaultPath, sessionId, prompt } = result.data;

  const controller = getController();

  // Shared cleanup function - called on terminal events or client disconnect
  let unsubscribe: (() => void) | null = null;
  let isClosing = false;

  function cleanup() {
    if (isClosing) return;
    isClosing = true;
    unsubscribe?.();
  }

  // Create SSE stream
  const stream = new ReadableStream({
    start(streamController) {
      // Subscribe to controller events
      unsubscribe = controller.subscribe((event: SessionEvent) => {
        if (isClosing) return;

        try {
          streamController.enqueue(encodeSSE(event));

          // Close stream on terminal events
          if (
            event.type === "response_end" ||
            event.type === "error" ||
            event.type === "session_cleared"
          ) {
            cleanup();
            try {
              streamController.close();
            } catch {
              // Already closed
            }
          }
        } catch {
          // Stream closed by client (tab switch, navigation, etc.)
          cleanup();
        }
      });

      // Send message (creates new session or resumes existing)
      void (async () => {
        try {
          await controller.sendMessage({
            vaultId,
            vaultPath,
            sessionId: sessionId ?? null,
            prompt,
          });
        } catch (err) {
          if (isClosing) return;
          log.error("Session error", err);
          try {
            streamController.enqueue(
              encodeSSE({
                type: "error",
                code: "SDK_ERROR",
                message: err instanceof Error ? err.message : "Session failed",
              })
            );
            streamController.close();
          } catch {
            // Stream already closed
          }
          cleanup();
        }
      })();
    },

    // Called when the client disconnects (tab switch, navigation, abort)
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: SSE_HEADERS,
  });
}

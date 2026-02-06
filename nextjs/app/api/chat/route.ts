/**
 * SSE Chat Endpoint
 *
 * POST /api/chat - Start or continue a chat session
 *
 * Request body:
 * - vaultId: string (required for new session)
 * - vaultPath: string (required for resume)
 * - sessionId: string (optional, resume if provided)
 * - prompt: string (required)
 *
 * Response: Server-Sent Events stream
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { getController, type SessionEvent } from "@/lib/controller";
import { encodeSSE, SSE_HEADERS } from "@/lib/sse";

// Request schema
const ChatRequestSchema = z.object({
  vaultId: z.string().optional(),
  vaultPath: z.string().optional(),
  vaultName: z.string().optional(),
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

  const { vaultId, vaultPath, vaultName, sessionId, prompt } = result.data;

  // Validate we have enough info to start/resume
  if (!sessionId && !vaultId) {
    return Response.json(
      { error: "Either vaultId (for new session) or sessionId (for resume) is required" },
      { status: 400 }
    );
  }

  if (!vaultPath) {
    return Response.json(
      { error: "vaultPath is required" },
      { status: 400 }
    );
  }

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

      // Start or resume session
      void (async () => {
        try {
          if (sessionId) {
            // Resume existing session
            await controller.resumeSession(vaultPath, sessionId, prompt);
          } else if (vaultId) {
            // Create new session with minimal vault info from request
            // Cast to VaultInfo - controller only uses id, path, name for session
            const vault = {
              id: vaultId,
              path: vaultPath,
              name: vaultName ?? vaultId,
            } as import("@memory-loop/shared").VaultInfo;
            await controller.startSession(vault, prompt);
          }
        } catch (err) {
          if (isClosing) return;
          console.error("Session error:", err);
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

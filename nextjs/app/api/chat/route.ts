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

  // Create SSE stream
  const stream = new ReadableStream({
    start(streamController) {
      let isClosing = false;

      // Subscribe to controller events
      const unsubscribe = controller.subscribe((event: SessionEvent) => {
        // Skip events if we're already closing
        if (isClosing) return;

        try {
          streamController.enqueue(encodeSSE(event));

          // Close stream on terminal events
          if (
            event.type === "response_end" ||
            event.type === "error" ||
            event.type === "session_cleared"
          ) {
            // Delay closing to allow any remaining events to flush
            // SDK may still have events in flight when response_end is emitted
            setTimeout(() => {
              isClosing = true;
              unsubscribe();
              try {
                streamController.close();
              } catch {
                // Already closed
              }
            }, 500);
          }
        } catch (err) {
          // Stream may already be closed
          console.error("Failed to write to stream:", err);
        }
      });

      // Start or resume session
      (async () => {
        try {
          if (sessionId) {
            // Resume existing session
            await controller.resumeSession(vaultPath!, sessionId, prompt);
          } else if (vaultId) {
            // Create new session with minimal vault info from request
            // Cast to VaultInfo - controller only uses id, path, name for session
            const vault = {
              id: vaultId,
              path: vaultPath!,
              name: vaultName ?? vaultId,
            } as import("@memory-loop/shared").VaultInfo;
            await controller.startSession(vault, prompt);
          }
        } catch (err) {
          console.error("Session error:", err);
          streamController.enqueue(
            encodeSSE({
              type: "error",
              code: "SDK_ERROR",
              message: err instanceof Error ? err.message : "Session failed",
            })
          );
          unsubscribe();
          streamController.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: SSE_HEADERS,
  });
}

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

  // Validate we have enough info to start/resume
  if (!sessionId && !vaultId) {
    return Response.json(
      { error: "Either vaultId (for new session) or sessionId (for resume) is required" },
      { status: 400 }
    );
  }

  if (sessionId && !vaultPath) {
    return Response.json(
      { error: "vaultPath is required when resuming a session" },
      { status: 400 }
    );
  }

  const controller = getController();

  // Create SSE stream
  const stream = new ReadableStream({
    start(streamController) {
      // Subscribe to controller events
      const unsubscribe = controller.subscribe((event: SessionEvent) => {
        try {
          streamController.enqueue(encodeSSE(event));

          // Close stream on terminal events
          if (
            event.type === "response_end" ||
            event.type === "error" ||
            event.type === "session_cleared"
          ) {
            // Small delay to ensure client receives the event before close
            setTimeout(() => {
              unsubscribe();
              streamController.close();
            }, 100);
          }
        } catch (err) {
          // Stream may already be closed
          console.error("Failed to write to stream:", err);
        }
      });

      // Start or resume session
      (async () => {
        try {
          if (sessionId && vaultPath) {
            // Resume existing session
            await controller.resumeSession(vaultPath, sessionId, prompt);
          } else if (vaultId) {
            // Create new session
            // For new session, we need vault info - fetch from backend
            const vaultResponse = await fetch(
              `http://localhost:3000/api/vaults/${vaultId}`
            );
            if (!vaultResponse.ok) {
              streamController.enqueue(
                encodeSSE({
                  type: "error",
                  code: "VAULT_NOT_FOUND",
                  message: `Vault "${vaultId}" not found`,
                })
              );
              unsubscribe();
              streamController.close();
              return;
            }

            const vault = await vaultResponse.json();
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

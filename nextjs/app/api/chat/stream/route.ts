/**
 * Chat Stream Endpoint (SSE viewport)
 *
 * GET /api/chat/stream - Connect to receive session events
 *
 * Sends a snapshot event first with current controller state, then
 * subscribes to live events if processing is in progress.
 *
 * Stream closes on terminal events (response_end, error, session_cleared)
 * or when the client disconnects. Client disconnect does NOT abort
 * processing; the controller continues independently.
 *
 * Multiple concurrent connections are supported (each subscribes independently).
 */

import { getController, type SessionEvent } from "@/lib/controller";
import { encodeSSE, SSE_HEADERS } from "@/lib/sse";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/chat/stream");

export function GET() {
  const controller = getController();

  let unsubscribe: (() => void) | null = null;
  let isClosing = false;

  function cleanup() {
    if (isClosing) return;
    isClosing = true;
    unsubscribe?.();
  }

  const stream = new ReadableStream({
    start(streamController) {
      // Send snapshot as first event
      try {
        const snapshot = controller.getSnapshot();
        streamController.enqueue(encodeSSE({ type: "snapshot", ...snapshot }));

        // If not processing, snapshot has the final state (REQ-SDC-9). Close immediately.
        if (!snapshot.isProcessing) {
          cleanup();
          try {
            streamController.close();
          } catch {
            /* already closed */
          }
          return;
        }
      } catch (err) {
        log.error("Failed to get snapshot", err);
        streamController.enqueue(
          encodeSSE({
            type: "error",
            code: "SNAPSHOT_ERROR",
            message: "Failed to get session snapshot",
          })
        );
        try {
          streamController.close();
        } catch {
          /* already closed */
        }
        cleanup();
        return;
      }

      // Subscribe to live events while processing continues
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
              /* already closed */
            }
          }
        } catch {
          // Stream closed by client
          cleanup();
        }
      });
    },

    cancel() {
      // Client disconnected. Clean up subscription but do NOT abort processing.
      cleanup();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

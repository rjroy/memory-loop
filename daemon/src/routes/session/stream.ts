/**
 * Chat Stream Endpoint (SSE viewport)
 *
 * GET /session/chat/stream - Connect to receive session events via SSE
 *
 * Uses Hono's streamSSE helper for proper SSE delivery.
 * Sends a snapshot event first with current controller state, then
 * subscribes to live events if processing is in progress.
 *
 * Stream closes on terminal events (response_end, error, aborted, session_cleared)
 * or when the client disconnects. Client disconnect does NOT abort
 * processing; the controller continues independently (REQ-SDC-4).
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { getController } from "../../session-controller";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("session/chat/stream");

/** Keep-alive interval in milliseconds */
const KEEPALIVE_INTERVAL_MS = 15_000;

export function chatStreamHandler(c: Context): Response {
  return streamSSE(c, async (stream) => {
    const controller = getController();

    // Send snapshot as first event
    const snapshot = controller.getSnapshot();
    await stream.writeSSE({
      data: JSON.stringify({ type: "snapshot", ...snapshot }),
    });

    // If not processing, snapshot has the final state. Close immediately.
    if (!snapshot.isProcessing) {
      return;
    }

    // Promise resolve function, called by subscriber on terminal events or by onAbort
    let resolveWait: (() => void) | null = null;
    let cleaned = false;

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      clearInterval(keepAlive);
      unsubscribe();
      resolveWait?.();
    }

    // Subscribe to live events while processing continues
    const unsubscribe = controller.subscribe((event) => {
      if (cleaned) return;

      stream.writeSSE({
        data: JSON.stringify(event),
      }).catch(() => {
        // Stream closed by client
        cleanup();
      });

      // Close stream on terminal events
      if (
        event.type === "response_end" ||
        event.type === "error" ||
        event.type === "aborted" ||
        event.type === "session_cleared"
      ) {
        cleanup();
      }
    });

    // Keep-alive every 15 seconds
    const keepAlive = setInterval(() => {
      if (cleaned) {
        clearInterval(keepAlive);
        return;
      }
      stream.writeSSE({ data: "", event: "keep-alive" }).catch(() => {
        cleanup();
      });
    }, KEEPALIVE_INTERVAL_MS);

    // Single onAbort handler for client disconnect (REQ-SDC-4)
    stream.onAbort(() => {
      log.debug("Client disconnected from stream");
      cleanup();
      // Do NOT abort processing (REQ-SDC-4)
    });

    // Wait until a terminal event or client disconnect triggers cleanup
    await new Promise<void>((resolve) => {
      resolveWait = resolve;
      // If cleanup already happened (race), resolve immediately
      if (cleaned) resolve();
    });
  }) as Response;
}

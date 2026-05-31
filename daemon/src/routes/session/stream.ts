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
  // Optional session scoping. The daemon holds a single active session, so a
  // caller can pass ?sessionId=X to assert "I want the stream for X". If X is
  // not the session the controller currently holds, X is by definition not the
  // active/processing session, so we must not leak the active session's state
  // into a different conversation (e.g. after resuming an older session from
  // the Ground tab).
  const requestedSessionId = c.req.query("sessionId");

  return streamSSE(c, async (stream) => {
    const controller = getController();

    // Send snapshot as first event
    const snapshot = controller.getSnapshot();

    if (
      requestedSessionId &&
      snapshot.sessionId &&
      requestedSessionId !== snapshot.sessionId
    ) {
      // Requested session is not the active one. Return an idle snapshot for
      // the requested session and close, rather than the active session's.
      await stream.writeSSE({
        data: JSON.stringify({
          type: "snapshot",
          sessionId: requestedSessionId,
          isProcessing: false,
          content: "",
          toolInvocations: [],
          pendingPrompts: [],
        }),
      });
      return;
    }

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

      const isTerminal =
        event.type === "response_end" ||
        event.type === "error" ||
        event.type === "aborted" ||
        event.type === "session_cleared";

      const writePromise = stream.writeSSE({
        data: JSON.stringify(event),
      });

      if (isTerminal) {
        // Wait for the write to flush before closing so the client receives the terminal event
        writePromise.then(() => cleanup()).catch(() => cleanup());
      } else {
        writePromise.catch(() => cleanup());
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
  });
}

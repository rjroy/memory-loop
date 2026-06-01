/**
 * Chat Stream Endpoint (SSE viewport, keyed)
 *
 * GET /session/:sessionId/chat - Connect to receive a session's events via SSE.
 *
 * This is the single code path for both the initial view of a turn and a
 * reconnect; there is no separate "snapshot" event wrapper anymore. The handler
 * mirrors oracle-keep's buffer-replay order:
 *
 *   1. Register the subscriber FIRST (so no event fired between replay and live
 *      dispatch is lost — JS is single-threaded, so this is airtight).
 *   2. Replay the session's event buffer, writing each buffered event as its own
 *      SSE data line.
 *   3. If the session is not processing, the terminal event is already in the
 *      replay, so unsubscribe and close.
 *   4. Otherwise stay live: write events as they arrive, closing on terminal
 *      events (response_end / error / aborted / session_cleared) after the write
 *      flushes.
 *
 * Replay/live ordering: the subscriber is registered before replay, but the
 * replay loop awaits each write, which yields to the event loop. A live event
 * arriving mid-replay would otherwise be written BETWEEN two replayed events,
 * scrambling order (e1, eLive, e2 instead of e1, e2, eLive). To guarantee
 * strict, non-interleaved order, the subscriber ENQUEUES live events into a
 * local buffer while `replaying` is true. After the replay loop finishes, the
 * queue is drained in arrival order, then `replaying` clears so subsequent live
 * events write directly. This is correct regardless of Hono's write-ordering
 * semantics for awaited vs non-awaited writes.
 *
 * A 15s keep-alive runs while live. On client disconnect (onAbort) the handler
 * unsubscribes but does NOT abort the turn — the controller keeps running and
 * buffering (REQ-SDC-4).
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  subscribe,
  unsubscribe,
  getReplayBuffer,
  isProcessing,
} from "../../streaming/live-session-controller";
import { createLogger } from "@memory-loop/shared";
import type { SessionEvent } from "@memory-loop/shared";

const log = createLogger("session/chat/stream");

/** Keep-alive interval in milliseconds */
const KEEPALIVE_INTERVAL_MS = 15_000;

/** Unique subscriber id for this stream connection. */
function makeSubscriberId(): string {
  return `sse_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isTerminalEvent(event: SessionEvent): boolean {
  return (
    event.type === "response_end" ||
    event.type === "error" ||
    event.type === "aborted" ||
    event.type === "session_cleared"
  );
}

export function chatStreamHandler(c: Context): Response {
  const sessionId = c.req.param("sessionId");

  return streamSSE(c, async (stream) => {
    if (!sessionId) {
      // No id in the path: nothing to view. Close immediately.
      return;
    }

    const subscriberId = makeSubscriberId();

    let resolveWait: (() => void) | null = null;
    let cleaned = false;
    let keepAlive: ReturnType<typeof setInterval> | null = null;

    // While replaying the buffer, live events are queued here instead of written
    // directly, so they cannot interleave with replayed events. Drained in order
    // after replay finishes, then cleared so later live events write directly.
    let replaying = true;
    const liveQueue: SessionEvent[] = [];

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (keepAlive) clearInterval(keepAlive);
      unsubscribe(sessionId!, subscriberId);
      resolveWait?.();
    }

    /**
     * Writes a single event as an SSE data line. Terminal events trigger
     * cleanup after the write flushes so the client receives them before close.
     */
    function writeEvent(event: SessionEvent): void {
      if (cleaned) return;

      const writePromise = stream.writeSSE({ data: JSON.stringify(event) });

      if (isTerminalEvent(event)) {
        // Wait for the write to flush before closing so the client receives the
        // terminal event.
        writePromise.then(() => cleanup()).catch(() => cleanup());
      } else {
        writePromise.catch(() => cleanup());
      }
    }

    // 1. Register the subscriber BEFORE replaying the buffer so no live event is
    // lost in the gap between replay and live dispatch. While replaying, live
    // events are queued (not written) to preserve strict buffer-then-live order.
    subscribe(sessionId, subscriberId, (event) => {
      if (cleaned) return;
      if (replaying) {
        liveQueue.push(event);
        return;
      }
      writeEvent(event);
    });

    // 2. Replay the buffer (events that fired before this stream connected).
    for (const event of getReplayBuffer(sessionId)) {
      await stream.writeSSE({ data: JSON.stringify(event) });
    }

    // 2b. Drain any live events that arrived during replay, in arrival order,
    // then leave replay mode so subsequent live events write directly.
    for (const event of liveQueue) {
      writeEvent(event);
    }
    liveQueue.length = 0;
    replaying = false;

    // 3. If the turn already finished, the terminal event is already in the
    // replay, so unsubscribe and close now.
    if (!isProcessing(sessionId)) {
      cleanup();
      return;
    }

    // 4. Stay live. Keep-alive every 15 seconds.
    keepAlive = setInterval(() => {
      if (cleaned) {
        if (keepAlive) clearInterval(keepAlive);
        return;
      }
      stream.writeSSE({ data: "", event: "keep-alive" }).catch(() => {
        cleanup();
      });
    }, KEEPALIVE_INTERVAL_MS);

    // Client disconnect: unsubscribe but do NOT abort the turn (REQ-SDC-4).
    stream.onAbort(() => {
      log.debug("Client disconnected from stream");
      cleanup();
    });

    // Wait until a terminal event or client disconnect triggers cleanup.
    await new Promise<void>((resolve) => {
      resolveWait = resolve;
      if (cleaned) resolve();
    });
  });
}

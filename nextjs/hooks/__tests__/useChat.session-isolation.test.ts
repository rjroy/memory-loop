/**
 * Tests for useChat session isolation.
 *
 * The daemon's SSE stream is backed by a single global session controller.
 * Probing it (e.g. the mount reconnect that runs after loading an older
 * session) can surface a snapshot for a DIFFERENT, still-active session than
 * the one the UI is showing. useChat must reject such a stream so the stale
 * session's last message does not leak into the current conversation.
 *
 * Regression test for the "Think" tab bug: open a new chat, exchange a few
 * messages, switch to Ground, load an older session, return to Think — the
 * previous chat's last assistant message would remain visible.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { useChat } from "../useChat";
import type { ServerMessage, VaultInfo } from "@memory-loop/shared";

const mockVault: VaultInfo = {
  id: "test-vault",
  name: "Test Vault",
  path: "/test/vault",
  contentRoot: "/test/vault",
};

/**
 * Creates a mock SSE Response that emits the given events then closes.
 */
function createSSEResponse(events: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useChat session isolation", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /**
   * Installs a fetch mock whose /chat/stream response emits a single snapshot
   * for `snapshotSessionId`. Returns the list of events forwarded to onEvent.
   */
  function setupSnapshotStream(snapshotSessionId: string): {
    events: ServerMessage[];
    streamRequested: () => boolean;
  } {
    let requested = false;
    global.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/chat/stream")) {
        requested = true;
        return createSSEResponse([
          {
            type: "snapshot",
            sessionId: snapshotSessionId,
            content: "stale assistant message",
            isProcessing: false,
          },
        ]);
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    return { events: [], streamRequested: () => requested };
  }

  test("ignores a mount-reconnect snapshot belonging to a different session", async () => {
    const { events, streamRequested } = setupSnapshotStream("other-session");

    renderHook(() =>
      useChat(mockVault, "current-session", {
        onEvent: (event) => events.push(event),
      })
    );

    // The mount reconnect probes the stream because a session id is set.
    await waitFor(() => expect(streamRequested()).toBe(true));
    // Give the async stream reader a chance to deliver the snapshot.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The mismatched snapshot must NOT be forwarded — otherwise the other
    // session's last message would be injected into this conversation.
    const snapshot = events.find((e) => (e as { type: string }).type === "snapshot");
    expect(snapshot).toBeUndefined();
  });

  test("forwards a mount-reconnect snapshot for the matching session", async () => {
    const { events, streamRequested } = setupSnapshotStream("current-session");

    renderHook(() =>
      useChat(mockVault, "current-session", {
        onEvent: (event) => events.push(event),
      })
    );

    await waitFor(() => expect(streamRequested()).toBe(true));

    // A snapshot for the session the UI is showing is the legitimate
    // reconnect-recovery case and must be delivered.
    await waitFor(() =>
      expect(
        events.some((e) => (e as { type: string }).type === "snapshot")
      ).toBe(true)
    );
  });
});

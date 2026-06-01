/**
 * useChat session scoping tests.
 *
 * Verifies that the SSE stream connection is scoped to the correct session ID
 * via the URL path (`/api/chat/:sessionId/stream`), preventing the bug where
 * reconnecting after resuming a different session would pull the
 * previously-active session's events.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useChat } from "../useChat";
import type { VaultInfo } from "@memory-loop/shared";

const mockVault: VaultInfo = {
  id: "test-vault",
  name: "Test Vault",
  path: "/test/vault",
  contentRoot: "/test/vault",
};

function createSSEStream(events: Array<Record<string, unknown>>): ReadableStream {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

/** Extracts the session id segment from a `/api/chat/:id/stream` URL. */
function streamSessionId(url: string): string | null {
  const match = url.match(/\/chat\/([^/]+)\/stream/);
  return match ? decodeURIComponent(match[1]) : null;
}

describe("useChat session scoping", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: string[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("connects to stream keyed by sessionId in the path when session exists", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      fetchCalls.push(urlStr);
      return new Response(createSSEStream([{ type: "session_ready", sessionId: "session-abc" }]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof globalThis.fetch;

    const { unmount } = renderHook(() => useChat(mockVault, "session-abc"));

    await waitFor(() => {
      expect(fetchCalls.some((u) => u.includes("/chat/session-abc/stream"))).toBe(true);
    });
    // The id lives in the path, never a query string.
    expect(fetchCalls.every((u) => !u.includes("sessionId="))).toBe(true);

    unmount();
  });

  test("uses the minted sessionId in the path for new sessions (send path)", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      fetchCalls.push(urlStr);
      return new Response(createSSEStream([{ type: "session_ready", sessionId: "minted" }]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(mockVault, null));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    // The POST mints an id and targets /api/chat/:id; the stream then targets
    // /api/chat/:id/stream with the SAME id. Neither uses a query string.
    const postCall = fetchCalls.find((u) => /\/chat\/[^/]+$/.test(u));
    const streamCall = fetchCalls.find((u) => u.includes("/chat/") && u.includes("/stream"));
    expect(postCall).toBeDefined();
    expect(streamCall).toBeDefined();

    const postId = postCall!.match(/\/chat\/([^/]+)$/)?.[1];
    const streamId = streamSessionId(streamCall!);
    expect(postId).toBeTruthy();
    expect(streamId).toBe(postId);
    expect(fetchCalls.every((u) => !u.includes("sessionId="))).toBe(true);
  });

  test("a fresh mount for a resumed session probes that session's stream", async () => {
    // Resuming an older session in the real app remounts Discussion (it was not
    // mounted in Ground mode), so useChat mounts fresh with the resumed id. The
    // mount probe must be keyed to that id, never a previously-active session's.
    const streamConnections: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      fetchCalls.push(urlStr);
      if (urlStr.includes("/stream")) {
        streamConnections.push(urlStr);
      }
      return new Response(createSSEStream([{ type: "session_ready", sessionId: "session-two" }]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof globalThis.fetch;

    const { unmount } = renderHook(() => useChat(mockVault, "session-two"));

    await waitFor(() => {
      expect(streamConnections.some((u) => streamSessionId(u) === "session-two")).toBe(true);
    });
    expect(streamConnections.every((u) => streamSessionId(u) !== "session-one")).toBe(true);

    unmount();
  });
});

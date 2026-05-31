/**
 * Tests for useChat session-scoped stream reconnect.
 *
 * The daemon holds a single active session and its SSE stream reflects that
 * one session. To avoid pulling a different (previously-active) session's
 * snapshot, useChat scopes the stream to the session it is showing by passing
 * ?sessionId= on the reconnect probe. The send path intentionally omits it so
 * it attaches to the session it just started.
 *
 * Regression coverage for the "Think" tab bug where resuming an older session
 * surfaced the prior chat's last assistant message.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChat } from "../useChat";
import type { VaultInfo } from "@memory-loop/shared";

const testVault: VaultInfo = {
  id: "test-vault",
  name: "Test Vault",
  path: "/path/to/vault",
  contentRoot: "/path/to/vault",
};

function createSSEResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useChat session-scoped stream", () => {
  let originalFetch: typeof fetch;
  let streamUrls: string[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    streamUrls = [];
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/chat/stream")) {
        streamUrls.push(url);
        return Promise.resolve(
          createSSEResponse([
            { type: "snapshot", sessionId: "sess_current", isProcessing: false, content: "" },
          ])
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ sessionId: "sess_current" })));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("mount reconnect scopes the stream to the current session id", async () => {
    renderHook(() => useChat(testVault, "sess_current", { onEvent: () => {} }));

    await waitFor(() => expect(streamUrls.length).toBeGreaterThan(0));
    expect(streamUrls[0]).toContain("sessionId=sess_current");
  });

  test("send path attaches without a session scope", async () => {
    const { result } = renderHook(() => useChat(testVault, null, { onEvent: () => {} }));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    await waitFor(() => expect(streamUrls.length).toBeGreaterThan(0));
    // The send path omits ?sessionId= so it attaches to the session it started.
    expect(streamUrls.every((u) => !u.includes("sessionId="))).toBe(true);
  });
});

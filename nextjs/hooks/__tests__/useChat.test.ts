/**
 * Tests for useChat hook
 *
 * Tests two-phase SSE streaming, session management, and permission resolution.
 *
 * Two-phase flow (keyed by session id in the URL path):
 * 1. POST /api/chat/:sessionId returns JSON { sessionId }
 * 2. GET /api/chat/:sessionId/stream replays the turn's raw events, then streams
 *    live ones (session_ready, response_start, response_chunk..., terminal). There
 *    is no separate snapshot wrapper.
 *
 * For a new conversation the id is minted client-side in sendMessage, so it is in
 * the path on the very first message. For a resumed session the caller supplies it.
 * useChat reads the id via ref so callbacks always use the latest value.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChat } from "../useChat";
import type { VaultInfo } from "@memory-loop/shared";

// Mock fetch responses
const mockFetch = mock(() => Promise.resolve(new Response()));

// Store original fetch
const originalFetch = globalThis.fetch;

// Test vault
const testVault: VaultInfo = {
  id: "test-vault",
  name: "Test Vault",
  path: "/path/to/vault",
  hasClaudeMd: true,
  contentRoot: "/path/to/vault",
  inboxPath: "00_Inbox",
  metadataPath: "06_Metadata/memory-loop",
  attachmentPath: "05_Attachments",
  setupComplete: true,
  promptsPerGeneration: 5,
  maxPoolSize: 50,
  quotesPerWeek: 1,
  badges: [],
  order: 1,
  cardsEnabled: false,
  viMode: false,
};

/**
 * Creates a mock SSE response with the given events.
 */
function createSSEResponse(events: Array<{ type: string; [key: string]: unknown }>): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * Creates the standard JSON response for POST /api/chat/:sessionId.
 */
function createPostResponse(sessionId: string): Response {
  return new Response(JSON.stringify({ sessionId }), {
    headers: { "Content-Type": "application/json" },
  });
}

/** Extracts the session id from a `/api/chat/:id` POST URL. */
function postSessionId(url: string): string | undefined {
  return url.match(/\/chat\/([^/]+)$/)?.[1];
}

/** Extracts the session id from a `/api/chat/:id/stream` URL. */
function streamSessionId(url: string): string | undefined {
  return url.match(/\/chat\/([^/]+)\/stream/)?.[1];
}

/**
 * Sets up mockFetch to handle the keyed two-phase flow by URL shape:
 * - `/chat/:id/stream` returns the replayed SSE events
 * - `/chat/:id/abort` returns a success ack
 * - anything else (the POST to `/chat/:id`) returns JSON { sessionId }
 *
 * The id is in the path, so we route on the URL rather than call order.
 */
function setupKeyedResponse(
  sessionId: string,
  sseEvents: Array<{ type: string; [key: string]: unknown }>
): void {
  mockFetch.mockImplementation((...args: unknown[]) => {
    const url = args[0] as string;
    if (url.includes("/stream")) {
      return Promise.resolve(createSSEResponse(sseEvents));
    }
    if (url.includes("/abort")) {
      return Promise.resolve(new Response(JSON.stringify({ success: true })));
    }
    // POST /api/chat/:id
    return Promise.resolve(createPostResponse(sessionId));
  });
}

/** Finds the POST /api/chat/:id call in the recorded fetch calls. */
function findPostCall(): [string, RequestInit] | undefined {
  return mockFetch.mock.calls.find((c) => {
    const args = c as unknown as [string, RequestInit?];
    return args[1]?.method === "POST" && /\/chat\/[^/]+$/.test(args[0]);
  }) as unknown as [string, RequestInit] | undefined;
}

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("useChat", () => {
  describe("initial state", () => {
    it("starts with idle streaming state", () => {
      const { result } = renderHook(() => useChat(testVault, null));

      expect(result.current.streamingState).toBe("idle");
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.lastError).toBeNull();
    });

    it("returns required functions", () => {
      const { result } = renderHook(() => useChat(testVault, null));

      expect(typeof result.current.sendMessage).toBe("function");
      expect(typeof result.current.abort).toBe("function");
      expect(typeof result.current.resolvePermission).toBe("function");
      expect(typeof result.current.resolveQuestion).toBe("function");
    });
  });

  describe("sendMessage", () => {
    it("requires vault to be set", async () => {
      const onError = mock(() => {});
      const { result } = renderHook(() => useChat(null, null, { onError }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.lastError).toBe("No vault selected");
      expect(onError).toHaveBeenCalledWith("No vault selected");
    });

    it("mints a session id in the path for POST then connects the keyed stream", async () => {
      setupKeyedResponse("sess_123", [
        { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
        { type: "response_start", messageId: "msg_1" },
        { type: "response_chunk", messageId: "msg_1", content: "Hello" },
        { type: "response_end", messageId: "msg_1", durationMs: 100 },
      ]);

      const { result } = renderHook(() => useChat(testVault, null));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      // Wait for the stream to finish (connectToStream is fire-and-forget)
      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      // POST: id is minted into the path, never the body.
      const postCall = findPostCall();
      expect(postCall).toBeDefined();
      expect(postCall![0]).toMatch(/^\/api\/chat\/[^/]+$/);
      expect(postCall![1].method).toBe("POST");

      const body = JSON.parse(postCall![1].body as string) as Record<string, unknown>;
      expect(body.vaultId).toBe("test-vault");
      expect(body.prompt).toBe("Hello");
      expect(body.sessionId).toBeUndefined();

      // Stream: same id as the POST, also in the path (no query string).
      const streamCall = mockFetch.mock.calls.find(
        (c) => (c as unknown as [string])[0].includes("/stream")
      ) as unknown as [string, RequestInit?];
      expect(streamCall[0]).toMatch(/^\/api\/chat\/[^/]+\/stream$/);
      expect(streamSessionId(streamCall[0])).toBe(postSessionId(postCall![0]));
    });

    it("uses the provided sessionId in the path, not the body", async () => {
      setupKeyedResponse("sess_123", [
        { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
        { type: "response_end", messageId: "msg_1", durationMs: 100 },
      ]);

      const { result } = renderHook(() => useChat(testVault, "sess_123"));

      await act(async () => {
        await result.current.sendMessage("Continue our conversation");
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      const postCall = findPostCall();
      expect(postCall).toBeDefined();
      expect(postCall![0]).toBe("/api/chat/sess_123");

      const body = JSON.parse(postCall![1].body as string) as Record<string, unknown>;
      expect(body.sessionId).toBeUndefined();
      expect(body.vaultId).toBe("test-vault");
      expect(body.vaultPath).toBe("/path/to/vault");
      expect(body.prompt).toBe("Continue our conversation");
    });

    it("uses latest sessionId via ref when it changes between renders", async () => {
      setupKeyedResponse("sess_new", [
        { type: "session_ready", sessionId: "sess_new", vaultId: "test-vault" },
        { type: "response_end", messageId: "msg_1", durationMs: 100 },
      ]);

      const { result, rerender } = renderHook(
        ({ sessionId }: { sessionId: string | null }) => useChat(testVault, sessionId),
        { initialProps: { sessionId: null } }
      );

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      // Simulate context updating the session ID (e.g. from session_ready via onEvent).
      rerender({ sessionId: "sess_new" });

      setupKeyedResponse("sess_new", [
        { type: "session_ready", sessionId: "sess_new", vaultId: "test-vault" },
        { type: "response_end", messageId: "msg_2", durationMs: 100 },
      ]);

      await act(async () => {
        await result.current.sendMessage("Follow up");
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      // The second POST targets the updated session id in the path.
      const postCalls = (mockFetch.mock.calls as unknown as [string, RequestInit?][]).filter(
        (call) => call[1]?.method === "POST" && /\/chat\/[^/]+$/.test(call[0])
      );
      expect(postCalls.length).toBe(2);
      expect(postCalls[1][0]).toBe("/api/chat/sess_new");
    });

    it("transitions streaming state correctly", async () => {
      let sawStarting = false;
      const onStreamStart = () => {
        sawStarting = true;
      };

      setupKeyedResponse("sess_123", [
        { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
        { type: "response_end", messageId: "msg_1", durationMs: 100 },
      ]);

      const { result } = renderHook(() => useChat(testVault, null, { onStreamStart }));

      expect(result.current.streamingState).toBe("idle");

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      expect(sawStarting).toBe(true);
    });

    it("calls onEvent for each received SSE event", async () => {
      const events: unknown[] = [];
      const onEvent = mock((event: unknown) => {
        events.push(event);
      });

      setupKeyedResponse("sess_123", [
        { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
        { type: "response_start", messageId: "msg_1" },
        { type: "response_chunk", messageId: "msg_1", content: "Hello" },
        { type: "response_end", messageId: "msg_1", durationMs: 100 },
      ]);

      const { result } = renderHook(() => useChat(testVault, null, { onEvent }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      // session_ready + response_start + response_chunk + response_end
      expect(onEvent).toHaveBeenCalledTimes(4);
      expect(events[0]).toMatchObject({ type: "session_ready" });
      expect(events[1]).toMatchObject({ type: "response_start" });
      expect(events[2]).toMatchObject({ type: "response_chunk" });
      expect(events[3]).toMatchObject({ type: "response_end" });
    });

    it("calls onStreamStart and onStreamEnd", async () => {
      const onStreamStart = mock(() => {});
      const onStreamEnd = mock(() => {});

      setupKeyedResponse("sess_123", [
        { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
        { type: "response_end", messageId: "msg_1", durationMs: 100 },
      ]);

      const { result } = renderHook(() =>
        useChat(testVault, null, { onStreamStart, onStreamEnd })
      );

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      expect(onStreamStart).toHaveBeenCalledTimes(1);
      expect(onStreamEnd).toHaveBeenCalledTimes(1);
    });

    it("handles HTTP errors from POST", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "NOT_FOUND", message: "Vault not found" } }),
            { status: 404 }
          )
        )
      );

      const onError = mock(() => {});
      const { result } = renderHook(() => useChat(testVault, null, { onError }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.lastError).toBe("Vault not found");
      expect(result.current.streamingState).toBe("error");
      expect(onError).toHaveBeenCalledWith("Vault not found");
    });

    it("handles 409 conflict (already processing)", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "ALREADY_PROCESSING", message: "Processing in progress" },
            }),
            { status: 409 }
          )
        )
      );

      const onError = mock(() => {});
      const { result } = renderHook(() => useChat(testVault, null, { onError }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.lastError).toBe("Processing in progress");
      expect(result.current.streamingState).toBe("error");
      expect(onError).toHaveBeenCalledWith("Processing in progress");
      // Should NOT have attempted to connect to stream
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("handles SSE error events from stream", async () => {
      const onError = mock(() => {});

      setupKeyedResponse("sess_123", [
        { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
        { type: "error", code: "SDK_ERROR", message: "Something went wrong" },
      ]);

      const { result } = renderHook(() => useChat(testVault, null, { onError }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      await waitFor(() => {
        expect(result.current.lastError).toBe("Something went wrong");
      });

      expect(onError).toHaveBeenCalledWith("Something went wrong");
    });

    it("forwards replayed events via onEvent", async () => {
      const events: unknown[] = [];
      const onEvent = mock((event: unknown) => {
        events.push(event);
      });

      setupKeyedResponse("sess_123", [
        { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
        { type: "response_chunk", messageId: "msg_1", content: "replayed" },
        { type: "response_end", messageId: "msg_1", durationMs: 100 },
      ]);

      const { result } = renderHook(() => useChat(testVault, null, { onEvent }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      expect(events[0]).toMatchObject({
        type: "session_ready",
        sessionId: "sess_123",
      });
    });
  });

  describe("abort", () => {
    it("sends abort to server first, then closes stream", async () => {
      // Set up a long-running stream
      mockFetch.mockImplementation((...args: unknown[]) => {
        const url = args[0] as string;
        if (url.includes("/stream")) {
          return new Promise<Response>((resolve) => {
            setTimeout(
              () =>
                resolve(
                  createSSEResponse([
                    { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
                    { type: "response_end", messageId: "msg_1", durationMs: 100 },
                  ])
                ),
              1000
            );
          });
        }
        if (url.includes("/abort")) {
          return Promise.resolve(new Response(JSON.stringify({ success: true })));
        }
        // POST /api/chat/:id
        return Promise.resolve(createPostResponse("sess_123"));
      });

      const { result } = renderHook(() => useChat(testVault, "sess_123"));

      act(() => {
        void result.current.sendMessage("Hello");
      });

      // Wait for streaming to start (POST completes, connectToStream fires)
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });

      await act(async () => {
        await result.current.abort();
      });

      expect(result.current.isStreaming).toBe(false);
      expect(result.current.streamingState).toBe("idle");
    });

    it("sends abort request to server when session exists", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ success: true })))
      );

      const { result } = renderHook(() => useChat(testVault, "sess_123"));

      await act(async () => {
        await result.current.abort();
      });

      // The abort should call the server endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chat/sess_123/abort",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("resolvePermission", () => {
    it("sends permission response to server", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ success: true })))
      );

      const { result } = renderHook(() => useChat(testVault, "sess_123"));

      await act(async () => {
        await result.current.resolvePermission("tool_123", true);
      });

      // Find the permission call (mount-reconnect may also call fetch for the stream)
      const call = mockFetch.mock.calls.find(
        (c) => (c as unknown as [string])[0].includes("/permission/")
      ) as unknown as [string, RequestInit];
      expect(call[0]).toBe("/api/chat/sess_123/permission/tool_123");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body as string) as Record<string, unknown>).toEqual({ allowed: true });
    });

    it("does nothing without session", async () => {
      const { result } = renderHook(() => useChat(testVault, null));

      await act(async () => {
        await result.current.resolvePermission("tool_123", true);
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("resolveQuestion", () => {
    it("sends answer response to server", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ success: true })))
      );

      const { result } = renderHook(() => useChat(testVault, "sess_123"));

      const answers = { "Question 1?": "Answer A" };
      await act(async () => {
        await result.current.resolveQuestion("tool_456", answers);
      });

      // Find the answer call (mount-reconnect may also call fetch for the stream)
      const call = mockFetch.mock.calls.find(
        (c) => (c as unknown as [string])[0].includes("/answer/")
      ) as unknown as [string, RequestInit];
      expect(call[0]).toBe("/api/chat/sess_123/answer/tool_456");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body as string) as Record<string, unknown>).toEqual({ answers });
    });
  });

  describe("vault change", () => {
    it("resets state when vault changes", async () => {
      // Set up the POST to fail so we get an error state
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "FAIL", message: "fail" } }),
            { status: 500 }
          )
        )
      );

      const { result, rerender } = renderHook(
        ({ vault }: { vault: VaultInfo | null }) => useChat(vault, null),
        { initialProps: { vault: testVault } }
      );

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.lastError).toBe("fail");

      // Change vault
      const newVault = { ...testVault, id: "other-vault" };
      rerender({ vault: newVault });

      expect(result.current.lastError).toBeNull();
      expect(result.current.streamingState).toBe("idle");
    });
  });

  describe("auto-reconnect", () => {
    it("reconnects on mount when sessionId is present", async () => {
      // The mount probe replays the just-completed turn's raw events.
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "existing_session", vaultId: "test-vault" },
            { type: "response_start", messageId: "msg_1" },
            { type: "response_chunk", messageId: "msg_1", content: "Previous response" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const onEvent = mock(() => {});
      const { result } = renderHook(() =>
        useChat(testVault, "existing_session", { onEvent })
      );

      // Mount-reconnect should fire and deliver the replayed events.
      await waitFor(() => {
        expect(onEvent).toHaveBeenCalled();
      });

      const chunkCall = onEvent.mock.calls.find(
        (c) => (c[0] as { type: string }).type === "response_chunk"
      );
      expect(chunkCall).toBeDefined();
      expect((chunkCall![0] as { content: string }).content).toBe("Previous response");

      // The probe is keyed to the resumed session, never a different one.
      const streamCall = mockFetch.mock.calls.find(
        (c) => (c as unknown as [string])[0].includes("/stream")
      ) as unknown as [string];
      expect(streamSessionId(streamCall[0])).toBe("existing_session");

      // Should settle to idle after the terminal event.
      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });
    });

    it("does not reconnect on mount without sessionId", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({})))
      );

      renderHook(() => useChat(testVault, null));

      // No fetch should have been made (no session to reconnect to)
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("schedules reconnect on unexpected stream drop", async () => {
      // Track which stream calls have happened
      let streamCallCount = 0;
      mockFetch.mockImplementation((...args: unknown[]) => {
        const url = args[0] as string;

        if (url.includes("/stream")) {
          streamCallCount++;
          if (streamCallCount <= 1) {
            // First stream: drops after replaying session_ready.
            return Promise.resolve(
              new Response(
                new ReadableStream({
                  start(controller) {
                    const event = `data: ${JSON.stringify({
                      type: "session_ready",
                      sessionId: "sess_reconnect",
                      vaultId: "test-vault",
                    })}\n\n`;
                    controller.enqueue(new TextEncoder().encode(event));
                    // Simulate connection drop
                    controller.error(new Error("Connection reset"));
                  },
                }),
                { headers: { "Content-Type": "text/event-stream" } }
              )
            );
          }
          // Reconnect stream: replays the completed turn.
          return Promise.resolve(
            createSSEResponse([
              { type: "session_ready", sessionId: "sess_reconnect", vaultId: "test-vault" },
              { type: "response_chunk", messageId: "msg_1", content: "complete response" },
              { type: "response_end", messageId: "msg_1", durationMs: 100 },
            ])
          );
        }

        // POST /api/chat/:id
        return Promise.resolve(createPostResponse("sess_reconnect"));
      });

      const onEvent = mock(() => {});
      const { result } = renderHook(() =>
        useChat(testVault, null, { onEvent })
      );

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      // Wait for the first stream to error and schedule reconnect
      await waitFor(() => {
        expect(streamCallCount).toBeGreaterThanOrEqual(1);
      });

      // Advance past the 1s reconnect backoff
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1200));
      });

      // Wait for reconnect stream to complete
      await waitFor(
        () => {
          expect(result.current.streamingState).toBe("idle");
        },
        { timeout: 3000 }
      );

      // The reconnect should have triggered a second stream call
      expect(streamCallCount).toBeGreaterThanOrEqual(2);
    });

    it("does not reconnect after user abort", async () => {
      mockFetch.mockImplementation((...args: unknown[]) => {
        const url = args[0] as string;

        if (url.includes("/abort")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true })));
        }

        if (url.includes("/stream")) {
          // Stream replays a still-processing turn (no terminal event yet).
          return Promise.resolve(
            createSSEResponse([
              { type: "session_ready", sessionId: "sess_abort", vaultId: "test-vault" },
            ])
          );
        }

        // POST /api/chat/:id
        return Promise.resolve(createPostResponse("sess_abort"));
      });

      const { result } = renderHook(() => useChat(testVault, null));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      // Abort before stream completes
      await act(async () => {
        await result.current.abort();
      });

      expect(result.current.streamingState).toBe("idle");

      // Wait a bit to verify no reconnect attempt
      await new Promise((r) => setTimeout(r, 100));
      const streamCalls = mockFetch.mock.calls.filter(
        (c) => (c as unknown as [string])[0].includes("/stream")
      );
      // Should only have 1 stream call (no reconnect after abort)
      expect(streamCalls.length).toBe(1);
    });
  });
});

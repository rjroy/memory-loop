/**
 * Tests for useChat hook
 *
 * Tests two-phase SSE streaming, session management, and permission resolution.
 *
 * Two-phase flow:
 * 1. POST /api/chat returns JSON { sessionId }
 * 2. GET /api/chat/stream returns SSE (snapshot + live events)
 *
 * Session ID is caller-owned (passed as parameter). useChat reads it
 * via ref so callbacks always use the latest value without recreating.
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
 * Creates the standard JSON response for POST /api/chat.
 */
function createPostResponse(sessionId: string): Response {
  return new Response(JSON.stringify({ sessionId }), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Sets up mockFetch to handle the two-phase flow:
 * 1. First call (POST /api/chat) returns JSON { sessionId }
 * 2. Second call (GET /api/chat/stream) returns SSE events
 */
function setupTwoPhaseResponse(
  sessionId: string,
  sseEvents: Array<{ type: string; [key: string]: unknown }>
): void {
  let callCount = 0;
  mockFetch.mockImplementation((...args: unknown[]) => {
    callCount++;
    const url = args[0] as string;
    if (url.endsWith("/chat/stream")) {
      return Promise.resolve(createSSEResponse(sseEvents));
    }
    // POST /api/chat
    if (callCount === 1 || url.endsWith("/chat")) {
      return Promise.resolve(createPostResponse(sessionId));
    }
    return Promise.resolve(new Response(JSON.stringify({})));
  });
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

    it("makes POST to /api/chat then GET to /api/chat/stream", async () => {
      setupTwoPhaseResponse("sess_123", [
        { type: "snapshot", sessionId: "sess_123", isProcessing: true },
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

      // Should have called POST then GET
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);

      // First call: POST /api/chat
      const postCall = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(postCall[0]).toBe("/api/chat");
      expect(postCall[1].method).toBe("POST");

      const body = JSON.parse(postCall[1].body as string) as Record<string, unknown>;
      expect(body.vaultId).toBe("test-vault");
      expect(body.prompt).toBe("Hello");
      expect(body.sessionId).toBeUndefined();

      // Second call: GET /api/chat/stream
      const getCall = mockFetch.mock.calls[1] as unknown as [string, RequestInit?];
      expect(getCall[0]).toBe("/api/chat/stream");
    });

    it("includes sessionId in POST request when provided", async () => {
      setupTwoPhaseResponse("sess_123", [
        { type: "snapshot", sessionId: "sess_123", isProcessing: true },
        { type: "response_end", messageId: "msg_1", durationMs: 100 },
      ]);

      const { result } = renderHook(() => useChat(testVault, "sess_123"));

      await act(async () => {
        await result.current.sendMessage("Continue our conversation");
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      // Find the POST /api/chat call (mount-reconnect may also call fetch for the stream)
      const postCall = mockFetch.mock.calls.find(
        (c) => {
          const args = c as unknown as [string, RequestInit?];
          return args[0] === "/api/chat" && args[1]?.method === "POST";
        }
      ) as unknown as [string, RequestInit];
      const body = JSON.parse(postCall[1].body as string) as Record<string, unknown>;
      expect(body.sessionId).toBe("sess_123");
      expect(body.vaultId).toBe("test-vault");
      expect(body.vaultPath).toBe("/path/to/vault");
      expect(body.prompt).toBe("Continue our conversation");
    });

    it("uses latest sessionId via ref when it changes between renders", async () => {
      // First call: new session
      setupTwoPhaseResponse("sess_new", [
        { type: "snapshot", sessionId: "sess_new", isProcessing: true },
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

      // Simulate context updating session ID (e.g. from session_ready via onEvent)
      rerender({ sessionId: "sess_new" });

      // Second message should use the updated session ID
      setupTwoPhaseResponse("sess_new", [
        { type: "snapshot", sessionId: "sess_new", isProcessing: true },
        { type: "response_end", messageId: "msg_2", durationMs: 100 },
      ]);

      await act(async () => {
        await result.current.sendMessage("Follow up");
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      // Find the second POST call
      const postCalls = (mockFetch.mock.calls as unknown as [string, RequestInit?][]).filter(
        (call) => {
          const opts = call[1];
          return opts?.method === "POST" && call[0] === "/api/chat";
        }
      );
      expect(postCalls.length).toBe(2);

      const secondPostBody = JSON.parse(postCalls[1][1]!.body as string) as Record<string, unknown>;
      expect(secondPostBody.sessionId).toBe("sess_new");
    });

    it("transitions streaming state correctly", async () => {
      let sawStarting = false;
      const onStreamStart = () => {
        sawStarting = true;
      };

      setupTwoPhaseResponse("sess_123", [
        { type: "snapshot", sessionId: "sess_123", isProcessing: true },
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

      setupTwoPhaseResponse("sess_123", [
        { type: "snapshot", sessionId: "sess_123", isProcessing: true },
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

      // snapshot + session_ready + response_start + response_chunk + response_end
      expect(onEvent).toHaveBeenCalledTimes(5);
      expect(events[0]).toMatchObject({ type: "snapshot" });
      expect(events[1]).toMatchObject({ type: "session_ready" });
      expect(events[2]).toMatchObject({ type: "response_start" });
      expect(events[3]).toMatchObject({ type: "response_chunk" });
      expect(events[4]).toMatchObject({ type: "response_end" });
    });

    it("calls onStreamStart and onStreamEnd", async () => {
      const onStreamStart = mock(() => {});
      const onStreamEnd = mock(() => {});

      setupTwoPhaseResponse("sess_123", [
        { type: "snapshot", sessionId: "sess_123", isProcessing: true },
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

      setupTwoPhaseResponse("sess_123", [
        { type: "snapshot", sessionId: "sess_123", isProcessing: true },
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

    it("forwards snapshot event via onEvent", async () => {
      const events: unknown[] = [];
      const onEvent = mock((event: unknown) => {
        events.push(event);
      });

      setupTwoPhaseResponse("sess_123", [
        { type: "snapshot", sessionId: "sess_123", isProcessing: true, conversationHistory: [] },
      ]);

      const { result } = renderHook(() => useChat(testVault, null, { onEvent }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe("idle");
      });

      expect(events[0]).toMatchObject({
        type: "snapshot",
        sessionId: "sess_123",
        isProcessing: true,
      });
    });
  });

  describe("abort", () => {
    it("sends abort to server first, then closes stream", async () => {
      // Set up a long-running stream
      mockFetch.mockImplementation((...args: unknown[]) => {
        const url = args[0] as string;
        if (url.endsWith("/chat/stream")) {
          return new Promise<Response>((resolve) => {
            setTimeout(
              () =>
                resolve(
                  createSSEResponse([
                    { type: "snapshot", sessionId: "sess_123", isProcessing: true },
                    { type: "response_end", messageId: "msg_1", durationMs: 100 },
                  ])
                ),
              1000
            );
          });
        }
        if (url.endsWith("/abort")) {
          return Promise.resolve(new Response(JSON.stringify({ success: true })));
        }
        // POST /api/chat
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
      // Respond to the stream probe with a completed snapshot
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createSSEResponse([
            {
              type: "snapshot",
              sessionId: "existing_session",
              isProcessing: false,
              content: "Previous response",
              toolInvocations: [],
              pendingPrompts: [],
            },
          ])
        )
      );

      const onEvent = mock(() => {});
      const { result } = renderHook(() =>
        useChat(testVault, "existing_session", { onEvent })
      );

      // Mount-reconnect should fire and deliver the snapshot
      await waitFor(() => {
        expect(onEvent).toHaveBeenCalled();
      });

      const snapshotCall = onEvent.mock.calls.find(
        (c) => (c[0] as { type: string }).type === "snapshot"
      );
      expect(snapshotCall).toBeDefined();
      expect((snapshotCall![0] as { content: string }).content).toBe("Previous response");

      // Should settle to idle after non-processing snapshot
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

        if (url.endsWith("/chat")) {
          return Promise.resolve(createPostResponse("sess_reconnect"));
        }

        if (url.endsWith("/chat/stream")) {
          streamCallCount++;
          if (streamCallCount <= 1) {
            // First stream: error after snapshot
            return Promise.resolve(
              new Response(
                new ReadableStream({
                  start(controller) {
                    const snapshot = `data: ${JSON.stringify({
                      type: "snapshot",
                      sessionId: "sess_reconnect",
                      isProcessing: true,
                      content: "partial",
                      toolInvocations: [],
                      pendingPrompts: [],
                    })}\n\n`;
                    controller.enqueue(new TextEncoder().encode(snapshot));
                    // Simulate connection drop
                    controller.error(new Error("Connection reset"));
                  },
                }),
                { headers: { "Content-Type": "text/event-stream" } }
              )
            );
          }
          // Reconnect stream: delivers completed response
          return Promise.resolve(
            createSSEResponse([
              {
                type: "snapshot",
                sessionId: "sess_reconnect",
                isProcessing: false,
                content: "complete response",
                toolInvocations: [],
                pendingPrompts: [],
              },
            ])
          );
        }

        return Promise.resolve(new Response(JSON.stringify({})));
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

        if (url.endsWith("/chat")) {
          return Promise.resolve(createPostResponse("sess_abort"));
        }

        if (url.includes("/abort")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true })));
        }

        if (url.endsWith("/chat/stream")) {
          // Slow stream that gives us time to abort
          return Promise.resolve(
            createSSEResponse([
              {
                type: "snapshot",
                sessionId: "sess_abort",
                isProcessing: true,
                content: "",
                toolInvocations: [],
                pendingPrompts: [],
              },
            ])
          );
        }

        return Promise.resolve(new Response(JSON.stringify({})));
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
        (c) => (c as unknown as [string])[0].endsWith("/chat/stream")
      );
      // Should only have 1 stream call (no reconnect after abort)
      expect(streamCalls.length).toBe(1);
    });
  });
});

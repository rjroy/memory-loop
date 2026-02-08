/**
 * Tests for useChat hook
 *
 * Tests SSE streaming, session management, and permission resolution.
 *
 * Session ID is caller-owned (passed as parameter). useChat reads it
 * via ref so callbacks always use the latest value without recreating.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChat } from "../useChat";
import type { VaultInfo } from "@/lib/schemas";

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

    it("makes POST request to /api/chat for new session", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
            { type: "response_start", messageId: "msg_1" },
            { type: "response_chunk", messageId: "msg_1", content: "Hello" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() => useChat(testVault, null));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toBe("/api/chat");
      expect(call[1].method).toBe("POST");

      const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
      expect(body.vaultId).toBe("test-vault");
      expect(body.prompt).toBe("Hello");
      expect(body.sessionId).toBeUndefined();
    });

    it("includes sessionId in request when provided", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() => useChat(testVault, "sess_123"));

      await act(async () => {
        await result.current.sendMessage("Continue our conversation");
      });

      const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
      expect(body.sessionId).toBe("sess_123");
      expect(body.vaultId).toBe("test-vault");
      expect(body.vaultPath).toBe("/path/to/vault");
      expect(body.prompt).toBe("Continue our conversation");
    });

    it("uses latest sessionId via ref when it changes between renders", async () => {
      // Start with null (new session)
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_new", vaultId: "test-vault" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result, rerender } = renderHook(
        ({ sessionId }: { sessionId: string | null }) => useChat(testVault, sessionId),
        { initialProps: { sessionId: null } }
      );

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      // Simulate context updating session ID (e.g. from session_ready via onEvent)
      rerender({ sessionId: "sess_new" });

      // Second message should use the updated session ID
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "response_end", messageId: "msg_2", durationMs: 100 },
          ])
        )
      );

      await act(async () => {
        await result.current.sendMessage("Follow up");
      });

      const call = mockFetch.mock.calls[1] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
      expect(body.sessionId).toBe("sess_new");
    });

    it("transitions streaming state correctly", async () => {
      let sawStarting = false;
      const onStreamStart = () => {
        sawStarting = true;
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() => useChat(testVault, null, { onStreamStart }));

      expect(result.current.streamingState).toBe("idle");

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(sawStarting).toBe(true);
      expect(result.current.streamingState).toBe("idle");
    });

    it("calls onEvent for each received event", async () => {
      const events: unknown[] = [];
      const onEvent = mock((event: unknown) => {
        events.push(event);
      });

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
            { type: "response_start", messageId: "msg_1" },
            { type: "response_chunk", messageId: "msg_1", content: "Hello" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() => useChat(testVault, null, { onEvent }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(onEvent).toHaveBeenCalledTimes(4);
      expect(events[0]).toMatchObject({ type: "session_ready" });
      expect(events[1]).toMatchObject({ type: "response_start" });
      expect(events[2]).toMatchObject({ type: "response_chunk" });
      expect(events[3]).toMatchObject({ type: "response_end" });
    });

    it("calls onStreamStart and onStreamEnd", async () => {
      const onStreamStart = mock(() => {});
      const onStreamEnd = mock(() => {});

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() =>
        useChat(testVault, null, { onStreamStart, onStreamEnd })
      );

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(onStreamStart).toHaveBeenCalledTimes(1);
      expect(onStreamEnd).toHaveBeenCalledTimes(1);
    });

    it("handles HTTP errors", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Vault not found" }), {
            status: 404,
          })
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

    it("handles SSE error events", async () => {
      const onError = mock(() => {});

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "error", code: "SDK_ERROR", message: "Something went wrong" },
          ])
        )
      );

      const { result } = renderHook(() => useChat(testVault, null, { onError }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.lastError).toBe("Something went wrong");
      expect(onError).toHaveBeenCalledWith("Something went wrong");
    });
  });

  describe("abort", () => {
    it("aborts in-flight requests", async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve(
                  createSSEResponse([
                    { type: "response_end", messageId: "msg_1", durationMs: 100 },
                  ])
                ),
              1000
            );
          })
      );

      const { result } = renderHook(() => useChat(testVault, null));

      act(() => {
        void result.current.sendMessage("Hello");
      });

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
      // Session ID is passed as parameter, no need to establish via message
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ success: true })))
      );

      const { result } = renderHook(() => useChat(testVault, "sess_123"));

      await act(async () => {
        await result.current.abort();
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
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

      const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
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

      const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toBe("/api/chat/sess_123/answer/tool_456");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body as string) as Record<string, unknown>).toEqual({ answers });
    });
  });

  describe("vault change", () => {
    it("resets state when vault changes", async () => {
      const { result, rerender } = renderHook(
        ({ vault }: { vault: VaultInfo | null }) => useChat(vault, null),
        { initialProps: { vault: testVault } }
      );

      // Set an error state first
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "fail" }), { status: 500 })
        )
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
});

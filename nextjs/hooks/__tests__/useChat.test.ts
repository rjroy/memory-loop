/**
 * Tests for useChat hook
 *
 * Tests SSE streaming, session management, and permission resolution.
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
      const { result } = renderHook(() => useChat(testVault));

      expect(result.current.streamingState).toBe("idle");
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.sessionId).toBeNull();
      expect(result.current.lastError).toBeNull();
    });

    it("returns required functions", () => {
      const { result } = renderHook(() => useChat(testVault));

      expect(typeof result.current.sendMessage).toBe("function");
      expect(typeof result.current.abort).toBe("function");
      expect(typeof result.current.resolvePermission).toBe("function");
      expect(typeof result.current.resolveQuestion).toBe("function");
    });
  });

  describe("sendMessage", () => {
    it("requires vault to be set", async () => {
      const onError = mock(() => {});
      const { result } = renderHook(() => useChat(null, { onError }));

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

      const { result } = renderHook(() => useChat(testVault));

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
    });

    it("captures session ID from session_ready event", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() => useChat(testVault));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.sessionId).toBe("sess_123");
    });

    it("uses sessionId for subsequent messages", async () => {
      // First message creates session
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() => useChat(testVault));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.sessionId).toBe("sess_123");

      // Reset mock for second call
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
      expect(body.sessionId).toBe("sess_123");
      expect(body.vaultPath).toBe("/path/to/vault");
    });

    it("transitions streaming state correctly", async () => {
      // Use onStreamStart callback to verify starting state is reached
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

      const { result } = renderHook(() => useChat(testVault, { onStreamStart }));

      // Capture initial state
      expect(result.current.streamingState).toBe("idle");

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      // Verify we reached starting state (via callback)
      expect(sawStarting).toBe(true);
      // Final state should be idle
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

      const { result } = renderHook(() => useChat(testVault, { onEvent }));

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
        useChat(testVault, { onStreamStart, onStreamEnd })
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
      const { result } = renderHook(() => useChat(testVault, { onError }));

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

      const { result } = renderHook(() => useChat(testVault, { onError }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.lastError).toBe("Something went wrong");
      expect(onError).toHaveBeenCalledWith("Something went wrong");
    });
  });

  describe("abort", () => {
    it("aborts in-flight requests", async () => {
      // Create a delayed response
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

      const { result } = renderHook(() => useChat(testVault));

      // Start message without awaiting
      act(() => {
        void result.current.sendMessage("Hello");
      });

      // Wait for streaming to start
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });

      // Abort
      await act(async () => {
        await result.current.abort();
      });

      expect(result.current.isStreaming).toBe(false);
      expect(result.current.streamingState).toBe("idle");
    });

    it("sends abort request to server", async () => {
      // Set up session first
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() => useChat(testVault));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.sessionId).toBe("sess_123");

      // Reset mock and abort
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ success: true })))
      );

      await act(async () => {
        await result.current.abort();
      });

      // Check that abort was called
      expect(mockFetch).toHaveBeenLastCalledWith(
        "/api/chat/sess_123/abort",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("resolvePermission", () => {
    it("sends permission response to server", async () => {
      // Set up session first
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() => useChat(testVault));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      // Reset mock for permission call
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ success: true })))
      );

      await act(async () => {
        await result.current.resolvePermission("tool_123", true);
      });

      const call = mockFetch.mock.calls[1] as unknown as [string, RequestInit];
      expect(call[0]).toBe("/api/chat/sess_123/permission/tool_123");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body as string) as Record<string, unknown>).toEqual({ allowed: true });
    });

    it("does nothing without session", async () => {
      const { result } = renderHook(() => useChat(testVault));

      await act(async () => {
        await result.current.resolvePermission("tool_123", true);
      });

      // Only the initial render, no fetch calls
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("resolveQuestion", () => {
    it("sends answer response to server", async () => {
      // Set up session first
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() => useChat(testVault));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      // Reset mock for answer call
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ success: true })))
      );

      const answers = { "Question 1?": "Answer A" };
      await act(async () => {
        await result.current.resolveQuestion("tool_456", answers);
      });

      const call = mockFetch.mock.calls[1] as unknown as [string, RequestInit];
      expect(call[0]).toBe("/api/chat/sess_123/answer/tool_456");
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body as string) as Record<string, unknown>).toEqual({ answers });
    });
  });

  describe("initialSessionId", () => {
    it("initializes with provided session ID for resume", () => {
      const { result } = renderHook(() =>
        useChat(testVault, { initialSessionId: "sess_resume_123" })
      );

      expect(result.current.sessionId).toBe("sess_resume_123");
    });

    it("sends sessionId in first message when initialSessionId is set", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_resume_123", vaultId: "test-vault", messages: [] },
            { type: "response_start", messageId: "msg_1" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result } = renderHook(() =>
        useChat(testVault, { initialSessionId: "sess_resume_123" })
      );

      await act(async () => {
        await result.current.sendMessage("Continue our conversation");
      });

      const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
      expect(body.sessionId).toBe("sess_resume_123");
      expect(body.vaultPath).toBe("/path/to/vault");
      expect(body.prompt).toBe("Continue our conversation");
      // Should NOT have vaultId (resume path, not new session path)
      expect(body.vaultId).toBeUndefined();
    });

    it("ignores null initialSessionId", () => {
      const { result } = renderHook(() =>
        useChat(testVault, { initialSessionId: null })
      );

      expect(result.current.sessionId).toBeNull();
    });
  });

  describe("vault change", () => {
    it("resets session when vault changes", async () => {
      // Set up session first
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createSSEResponse([
            { type: "session_ready", sessionId: "sess_123", vaultId: "test-vault" },
            { type: "response_end", messageId: "msg_1", durationMs: 100 },
          ])
        )
      );

      const { result, rerender } = renderHook(
        ({ vault }: { vault: VaultInfo | null }) => useChat(vault),
        { initialProps: { vault: testVault } }
      );

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.sessionId).toBe("sess_123");

      // Change vault
      const newVault = { ...testVault, id: "other-vault" };
      rerender({ vault: newVault });

      expect(result.current.sessionId).toBeNull();
      expect(result.current.lastError).toBeNull();
      expect(result.current.streamingState).toBe("idle");
    });
  });
});

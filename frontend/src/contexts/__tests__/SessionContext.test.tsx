/**
 * Tests for SessionContext
 *
 * Tests state management, persistence, and actions.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from "bun:test";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  SessionProvider,
  useSession,
  useServerMessageHandler,
} from "../SessionContext";
import type { VaultInfo } from "@memory-loop/shared";

// Clear localStorage before each test (happy-dom provides this)
beforeEach(() => {
  localStorage.clear();
});

// Test wrapper component
function createWrapper(initialVaults?: VaultInfo[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider initialVaults={initialVaults}>{children}</SessionProvider>
    );
  };
}

// Test data
const testVault: VaultInfo = {
  id: "test-vault",
  name: "Test Vault",
  path: "/path/to/vault",
  hasClaudeMd: true,
  inboxPath: "/path/to/vault/inbox",
};

const testVault2: VaultInfo = {
  id: "test-vault-2",
  name: "Another Vault",
  path: "/path/to/vault2",
  hasClaudeMd: false,
  inboxPath: "/path/to/vault2/inbox",
};

describe("SessionContext", () => {
  describe("initial state", () => {
    it("provides initial state with no vault selected", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.vault).toBeNull();
      expect(result.current.sessionId).toBeNull();
      expect(result.current.mode).toBe("note");
      expect(result.current.messages).toEqual([]);
    });

    it("throws error when used outside provider", () => {
      expect(() => {
        renderHook(() => useSession());
      }).toThrow("useSession must be used within a SessionProvider");
    });
  });

  describe("selectVault", () => {
    it("sets the current vault", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
      });

      expect(result.current.vault).toEqual(testVault);
    });

    it("clears session and messages when switching vaults", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up initial state
      act(() => {
        result.current.selectVault(testVault);
        result.current.setSessionId("session-123");
        result.current.addMessage({ role: "user", content: "Hello" });
      });

      expect(result.current.sessionId).toBe("session-123");
      expect(result.current.messages.length).toBe(1);

      // Switch vault
      act(() => {
        result.current.selectVault(testVault2);
      });

      expect(result.current.vault).toEqual(testVault2);
      expect(result.current.sessionId).toBeNull();
      expect(result.current.messages).toEqual([]);
    });

    it("persists vault ID to localStorage", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
      });

      expect(localStorage.getItem("memory-loop:vaultId")).toBe("test-vault");
    });
  });

  describe("setSessionId", () => {
    it("sets the session ID", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSessionId("session-abc");
      });

      expect(result.current.sessionId).toBe("session-abc");
    });

    it("persists session ID to localStorage", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSessionId("session-xyz");
      });

      expect(localStorage.getItem("memory-loop:sessionId")).toBe("session-xyz");
    });
  });

  describe("setMode", () => {
    it("switches between note and discussion modes", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.mode).toBe("note");

      act(() => {
        result.current.setMode("discussion");
      });

      expect(result.current.mode).toBe("discussion");

      act(() => {
        result.current.setMode("note");
      });

      expect(result.current.mode).toBe("note");
    });
  });

  describe("message management", () => {
    it("addMessage adds a message with ID and timestamp", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const beforeAdd = new Date();

      act(() => {
        result.current.addMessage({
          role: "user",
          content: "Hello, world!",
        });
      });

      const afterAdd = new Date();

      expect(result.current.messages.length).toBe(1);
      const message = result.current.messages[0];
      expect(message.role).toBe("user");
      expect(message.content).toBe("Hello, world!");
      expect(message.id).toMatch(/^msg_/);
      expect(message.timestamp.getTime()).toBeGreaterThanOrEqual(
        beforeAdd.getTime()
      );
      expect(message.timestamp.getTime()).toBeLessThanOrEqual(
        afterAdd.getTime()
      );
    });

    it("updateLastMessage appends to the last message", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "Hello",
          isStreaming: true,
        });
      });

      act(() => {
        result.current.updateLastMessage(", world!");
      });

      expect(result.current.messages[0].content).toBe("Hello, world!");
      expect(result.current.messages[0].isStreaming).toBe(true);
    });

    it("updateLastMessage can mark streaming as complete", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "Streaming...",
          isStreaming: true,
        });
      });

      act(() => {
        result.current.updateLastMessage("", false);
      });

      expect(result.current.messages[0].isStreaming).toBe(false);
    });

    it("updateLastMessage does nothing with no messages", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.updateLastMessage("test");
      });

      expect(result.current.messages).toEqual([]);
    });

    it("clearMessages removes all messages", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.addMessage({ role: "user", content: "One" });
        result.current.addMessage({ role: "assistant", content: "Two" });
        result.current.addMessage({ role: "user", content: "Three" });
      });

      expect(result.current.messages.length).toBe(3);

      act(() => {
        result.current.clearMessages();
      });

      expect(result.current.messages).toEqual([]);
    });
  });

  describe("startNewSession", () => {
    it("clears session ID and messages", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.setSessionId("session-123");
        result.current.addMessage({ role: "user", content: "Hello" });
      });

      expect(result.current.sessionId).toBe("session-123");
      expect(result.current.messages.length).toBe(1);

      act(() => {
        result.current.startNewSession();
      });

      expect(result.current.sessionId).toBeNull();
      expect(result.current.messages).toEqual([]);
      expect(result.current.vault).toEqual(testVault); // Vault preserved
    });

  });

  describe("persistence (writing)", () => {
    // Note: Loading tests skipped due to happy-dom timing issues with React effects.
    // Loading functionality is tested via E2E tests.

    it("persists session ID when set", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSessionId("session-to-persist");
      });

      expect(localStorage.getItem("memory-loop:sessionId")).toBe("session-to-persist");
    });

    it("persists vault ID when selected", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
      });

      expect(localStorage.getItem("memory-loop:vaultId")).toBe("test-vault");
    });

    it("removes session ID from storage on startNewSession", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSessionId("session-123");
      });

      expect(localStorage.getItem("memory-loop:sessionId")).toBe("session-123");

      act(() => {
        result.current.startNewSession();
      });

      expect(localStorage.getItem("memory-loop:sessionId")).toBeNull();
    });
  });

  describe("useServerMessageHandler", () => {
    it("handles session_ready message", () => {
      const { result } = renderHook(
        () => ({
          session: useSession(),
          handler: useServerMessageHandler(),
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.handler({
          type: "session_ready",
          sessionId: "new-session",
          vaultId: "vault-1",
        });
      });

      expect(result.current.session.sessionId).toBe("new-session");
    });

    it("handles response_start message", () => {
      const { result } = renderHook(
        () => ({
          session: useSession(),
          handler: useServerMessageHandler(),
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.handler({
          type: "response_start",
          messageId: "msg-1",
        });
      });

      expect(result.current.session.messages.length).toBe(1);
      expect(result.current.session.messages[0].role).toBe("assistant");
      expect(result.current.session.messages[0].content).toBe("");
      expect(result.current.session.messages[0].isStreaming).toBe(true);
    });

    it("handles response_chunk message", () => {
      const { result } = renderHook(
        () => ({
          session: useSession(),
          handler: useServerMessageHandler(),
        }),
        { wrapper: createWrapper() }
      );

      // Start a response first
      act(() => {
        result.current.handler({
          type: "response_start",
          messageId: "msg-1",
        });
      });

      // Add chunks
      act(() => {
        result.current.handler({
          type: "response_chunk",
          messageId: "msg-1",
          content: "Hello",
        });
      });

      act(() => {
        result.current.handler({
          type: "response_chunk",
          messageId: "msg-1",
          content: ", world!",
        });
      });

      expect(result.current.session.messages[0].content).toBe("Hello, world!");
    });

    it("handles response_end message", () => {
      const { result } = renderHook(
        () => ({
          session: useSession(),
          handler: useServerMessageHandler(),
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.handler({
          type: "response_start",
          messageId: "msg-1",
        });
      });

      act(() => {
        result.current.handler({
          type: "response_chunk",
          messageId: "msg-1",
          content: "Done!",
        });
      });

      act(() => {
        result.current.handler({
          type: "response_end",
          messageId: "msg-1",
        });
      });

      expect(result.current.session.messages[0].isStreaming).toBe(false);
    });
  });
});

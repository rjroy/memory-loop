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

    it("persists session ID to localStorage (with vault)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper([testVault]),
      });

      // First select a vault
      act(() => {
        result.current.selectVault(testVault);
      });

      // Then set session ID
      act(() => {
        result.current.setSessionId("session-xyz");
      });

      // Session is now stored per-vault
      const stored = localStorage.getItem("memory-loop:sessions");
      expect(stored).toBeTruthy();
      const sessions = JSON.parse(stored!) as Record<string, { sessionId: string }>;
      expect(sessions[testVault.id]?.sessionId).toBe("session-xyz");
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

    it("persists session ID when set (with vault)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper([testVault]),
      });

      // First select a vault
      act(() => {
        result.current.selectVault(testVault);
      });

      // Then set session ID
      act(() => {
        result.current.setSessionId("session-to-persist");
      });

      // Session is stored per-vault
      const stored = localStorage.getItem("memory-loop:sessions");
      expect(stored).toBeTruthy();
      const sessions = JSON.parse(stored!) as Record<string, { sessionId: string }>;
      expect(sessions[testVault.id]?.sessionId).toBe("session-to-persist");
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

    it("removes session from storage on startNewSession", () => {
      type SessionData = Record<string, { sessionId: string } | undefined>;
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper([testVault]),
      });

      // First select a vault and set session
      act(() => {
        result.current.selectVault(testVault);
      });

      act(() => {
        result.current.setSessionId("session-123");
      });

      // Verify session is stored
      let stored = localStorage.getItem("memory-loop:sessions");
      expect(stored).toBeTruthy();
      let sessions = JSON.parse(stored!) as SessionData;
      expect(sessions[testVault.id]?.sessionId).toBe("session-123");

      // Start new session should clear it
      act(() => {
        result.current.startNewSession();
      });

      // Session should be cleared for this vault
      stored = localStorage.getItem("memory-loop:sessions");
      sessions = stored ? (JSON.parse(stored) as SessionData) : {};
      expect(sessions[testVault.id]).toBeUndefined();
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

  describe("browser state", () => {
    it("provides initial browser state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.browser.currentPath).toBe("");
      expect(result.current.browser.expandedDirs.size).toBe(0);
      expect(result.current.browser.directoryCache.size).toBe(0);
      expect(result.current.browser.currentFileContent).toBeNull();
      expect(result.current.browser.currentFileTruncated).toBe(false);
      expect(result.current.browser.fileError).toBeNull();
      expect(result.current.browser.isLoading).toBe(false);
    });

    it("setCurrentPath updates the current path", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setCurrentPath("folder/subfolder");
      });

      expect(result.current.browser.currentPath).toBe("folder/subfolder");
    });

    it("setCurrentPath clears file content and error", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up file content first
      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.setFileError("Some error");
      });

      // Changing path should clear file content and error
      act(() => {
        result.current.setCurrentPath("new/path");
      });

      expect(result.current.browser.currentFileContent).toBeNull();
      expect(result.current.browser.fileError).toBeNull();
    });

    it("setCurrentPath persists to localStorage", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setCurrentPath("folder/subfolder");
      });

      expect(localStorage.getItem("memory-loop:browserPath")).toBe("folder/subfolder");
    });

    it("toggleDirectory expands a collapsed directory", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.toggleDirectory("folder");
      });

      expect(result.current.browser.expandedDirs.has("folder")).toBe(true);
    });

    it("toggleDirectory collapses an expanded directory", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.toggleDirectory("folder");
      });

      expect(result.current.browser.expandedDirs.has("folder")).toBe(true);

      act(() => {
        result.current.toggleDirectory("folder");
      });

      expect(result.current.browser.expandedDirs.has("folder")).toBe(false);
    });

    it("cacheDirectory stores directory entries", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const entries = [
        { name: "folder1", type: "directory" as const, path: "folder1" },
        { name: "file.md", type: "file" as const, path: "file.md" },
      ];

      act(() => {
        result.current.cacheDirectory("", entries);
      });

      expect(result.current.browser.directoryCache.get("")).toEqual(entries);
    });

    it("cacheDirectory overwrites existing cache for same path", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const entries1 = [{ name: "old.md", type: "file" as const, path: "old.md" }];
      const entries2 = [{ name: "new.md", type: "file" as const, path: "new.md" }];

      act(() => {
        result.current.cacheDirectory("folder", entries1);
      });

      act(() => {
        result.current.cacheDirectory("folder", entries2);
      });

      expect(result.current.browser.directoryCache.get("folder")).toEqual(entries2);
    });

    it("setFileContent updates file content and clears error", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setFileLoading(true);
        result.current.setFileError("Previous error");
      });

      act(() => {
        result.current.setFileContent("# Hello World", false);
      });

      expect(result.current.browser.currentFileContent).toBe("# Hello World");
      expect(result.current.browser.currentFileTruncated).toBe(false);
      expect(result.current.browser.fileError).toBeNull();
      expect(result.current.browser.isLoading).toBe(false);
    });

    it("setFileContent handles truncated flag", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setFileContent("Content...", true);
      });

      expect(result.current.browser.currentFileTruncated).toBe(true);
    });

    it("setFileError updates error and clears content", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setFileContent("# Test", false);
      });

      act(() => {
        result.current.setFileError("File not found");
      });

      expect(result.current.browser.fileError).toBe("File not found");
      expect(result.current.browser.currentFileContent).toBeNull();
      expect(result.current.browser.isLoading).toBe(false);
    });

    it("setFileLoading updates loading state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setFileLoading(true);
      });

      expect(result.current.browser.isLoading).toBe(true);

      act(() => {
        result.current.setFileLoading(false);
      });

      expect(result.current.browser.isLoading).toBe(false);
    });

    it("setFileLoading clears error when starting new operation", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setFileError("Previous error");
      });

      act(() => {
        result.current.setFileLoading(true);
      });

      expect(result.current.browser.fileError).toBeNull();
    });

    it("clearBrowserState resets all browser state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up browser state
      act(() => {
        result.current.setCurrentPath("folder/subfolder");
        result.current.toggleDirectory("folder");
        result.current.cacheDirectory("folder", [{ name: "file.md", type: "file" as const, path: "folder/file.md" }]);
        result.current.setFileContent("# Test", true);
      });

      // Clear it
      act(() => {
        result.current.clearBrowserState();
      });

      expect(result.current.browser.currentPath).toBe("");
      expect(result.current.browser.expandedDirs.size).toBe(0);
      expect(result.current.browser.directoryCache.size).toBe(0);
      expect(result.current.browser.currentFileContent).toBeNull();
      expect(result.current.browser.currentFileTruncated).toBe(false);
    });

    it("selectVault clears browser state (REQ-F-23)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up browser state
      act(() => {
        result.current.selectVault(testVault);
        result.current.setCurrentPath("folder");
        result.current.toggleDirectory("folder");
        result.current.cacheDirectory("folder", [{ name: "file.md", type: "file" as const, path: "folder/file.md" }]);
      });

      // Switch vault should clear browser state
      act(() => {
        result.current.selectVault(testVault2);
      });

      expect(result.current.browser.currentPath).toBe("");
      expect(result.current.browser.expandedDirs.size).toBe(0);
      expect(result.current.browser.directoryCache.size).toBe(0);
    });

    it("setMode preserves browser state (REQ-F-22)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up browser state
      act(() => {
        result.current.setCurrentPath("folder");
        result.current.toggleDirectory("folder");
        result.current.cacheDirectory("folder", [{ name: "file.md", type: "file" as const, path: "folder/file.md" }]);
      });

      // Switch mode should preserve browser state
      act(() => {
        result.current.setMode("discussion");
      });

      expect(result.current.browser.currentPath).toBe("folder");
      expect(result.current.browser.expandedDirs.has("folder")).toBe(true);
      expect(result.current.browser.directoryCache.get("folder")).toBeDefined();
    });

    it("setMode includes browse mode", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setMode("browse");
      });

      expect(result.current.mode).toBe("browse");
    });
  });
});

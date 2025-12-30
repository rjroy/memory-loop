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
  contentRoot: "/path/to/vault",
  inboxPath: "inbox",
  metadataPath: "06_Metadata/memory-loop",
};

const testVault2: VaultInfo = {
  id: "test-vault-2",
  name: "Another Vault",
  path: "/path/to/vault2",
  hasClaudeMd: false,
  contentRoot: "/path/to/vault2",
  inboxPath: "inbox",
  metadataPath: "06_Metadata/memory-loop",
};

describe("SessionContext", () => {
  describe("initial state", () => {
    it("provides initial state with no vault selected", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.vault).toBeNull();
      expect(result.current.sessionId).toBeNull();
      expect(result.current.sessionStartTime).toBeNull();
      expect(result.current.mode).toBe("home");
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

    it("does not persist session ID to localStorage (server is source of truth)", () => {
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

      // Session is NOT stored locally - server is source of truth
      const stored = localStorage.getItem("memory-loop:sessions");
      expect(stored).toBeNull();
      // But sessionId is in context state
      expect(result.current.sessionId).toBe("session-xyz");
    });
  });

  describe("setMode", () => {
    it("switches between all modes", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.mode).toBe("home");

      act(() => {
        result.current.setMode("note");
      });

      expect(result.current.mode).toBe("note");

      act(() => {
        result.current.setMode("discussion");
      });

      expect(result.current.mode).toBe("discussion");

      act(() => {
        result.current.setMode("browse");
      });

      expect(result.current.mode).toBe("browse");

      act(() => {
        result.current.setMode("home");
      });

      expect(result.current.mode).toBe("home");
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

  describe("clearVault", () => {
    it("clears the current vault", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
      });

      expect(result.current.vault).toEqual(testVault);

      act(() => {
        result.current.clearVault();
      });

      expect(result.current.vault).toBeNull();
    });

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
        result.current.clearVault();
      });

      expect(result.current.vault).toBeNull();
      expect(result.current.sessionId).toBeNull();
      expect(result.current.messages).toEqual([]);
    });

    it("clears browser state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.setCurrentPath("folder");
        result.current.toggleDirectory("folder");
        result.current.cacheDirectory("folder", [{ name: "file.md", type: "file" as const, path: "folder/file.md" }]);
      });

      act(() => {
        result.current.clearVault();
      });

      expect(result.current.browser.currentPath).toBe("");
      expect(result.current.browser.expandedDirs.size).toBe(0);
      expect(result.current.browser.directoryCache.size).toBe(0);
    });

    it("clears recent notes", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.setRecentNotes([
          { id: "note-1", text: "Note 1", time: "12:00", date: "2025-01-01" },
          { id: "note-2", text: "Note 2", time: "12:01", date: "2025-01-01" },
        ]);
      });

      expect(result.current.recentNotes.length).toBe(2);

      act(() => {
        result.current.clearVault();
      });

      expect(result.current.recentNotes).toEqual([]);
    });

    it("removes vault ID from localStorage", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
      });

      expect(localStorage.getItem("memory-loop:vaultId")).toBe("test-vault");

      act(() => {
        result.current.clearVault();
      });

      expect(localStorage.getItem("memory-loop:vaultId")).toBeNull();
    });
  });

  describe("persistence (writing)", () => {
    // Note: Session messages are no longer persisted to localStorage.
    // The server is the source of truth for session data.
    // Only vault ID and browser path are persisted locally.

    it("persists vault ID when selected", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
      });

      expect(localStorage.getItem("memory-loop:vaultId")).toBe("test-vault");
    });

    it("clears session state on startNewSession", () => {
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

      act(() => {
        result.current.addMessage({ role: "user", content: "hello" });
      });

      expect(result.current.sessionId).toBe("session-123");
      expect(result.current.messages.length).toBe(1);

      // Start new session should clear state
      act(() => {
        result.current.startNewSession();
      });

      expect(result.current.sessionId).toBeNull();
      expect(result.current.messages).toEqual([]);
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

    it("handles session_ready with messages (resume)", () => {
      const { result } = renderHook(
        () => ({
          session: useSession(),
          handler: useServerMessageHandler(),
        }),
        { wrapper: createWrapper() }
      );

      const messages = [
        { id: "msg-1", role: "user" as const, content: "hello", timestamp: "2025-01-01T12:00:00Z" },
        { id: "msg-2", role: "assistant" as const, content: "hi there", timestamp: "2025-01-01T12:00:01Z" },
      ];

      act(() => {
        result.current.handler({
          type: "session_ready",
          sessionId: "resumed-session",
          vaultId: "vault-1",
          messages,
        });
      });

      expect(result.current.session.sessionId).toBe("resumed-session");
      expect(result.current.session.messages.length).toBe(2);
      expect(result.current.session.messages[0].content).toBe("hello");
      expect(result.current.session.messages[1].content).toBe("hi there");
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

    it("updateLastMessage does not corrupt user message (race condition fix)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Add a user message
      act(() => {
        result.current.addMessage({
          role: "user",
          content: "Hello",
        });
      });

      // Simulate race condition: response_chunk arrives before response_start
      // This should NOT append to the user message
      act(() => {
        result.current.updateLastMessage("This should not appear");
      });

      // User message should remain unchanged
      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].role).toBe("user");
      expect(result.current.messages[0].content).toBe("Hello");
    });

    it("updateLastMessage only updates assistant messages", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Add user message then assistant message
      act(() => {
        result.current.addMessage({
          role: "user",
          content: "Hello",
        });
        result.current.addMessage({
          role: "assistant",
          content: "",
          isStreaming: true,
        });
      });

      // This should update the assistant message
      act(() => {
        result.current.updateLastMessage("Hi there!");
      });

      expect(result.current.messages.length).toBe(2);
      expect(result.current.messages[0].content).toBe("Hello");
      expect(result.current.messages[1].content).toBe("Hi there!");
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

    it("clearDirectoryCache clears cache but preserves pinned folders", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up browser state including pinned folders
      act(() => {
        result.current.setCurrentPath("folder/subfolder");
        result.current.toggleDirectory("folder");
        result.current.cacheDirectory("folder", [{ name: "file.md", type: "file" as const, path: "folder/file.md" }]);
        result.current.setFileContent("# Test", true);
        result.current.pinFolder("pinned-folder");
      });

      // Verify pinned folder is set
      expect(result.current.browser.pinnedFolders).toContain("pinned-folder");

      // Clear directory cache only
      act(() => {
        result.current.clearDirectoryCache();
      });

      // Directory cache and expanded dirs should be cleared
      expect(result.current.browser.expandedDirs.size).toBe(0);
      expect(result.current.browser.directoryCache.size).toBe(0);

      // Pinned folders should be preserved
      expect(result.current.browser.pinnedFolders).toContain("pinned-folder");

      // Current path and file content should also be preserved
      expect(result.current.browser.currentPath).toBe("folder/subfolder");
      expect(result.current.browser.currentFileContent).toBe("# Test");
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

  describe("discussionPrefill", () => {
    it("provides initial state with discussionPrefill null", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.discussionPrefill).toBeNull();
    });

    it("setDiscussionPrefill sets the prefill text", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setDiscussionPrefill("What does this mean?");
      });

      expect(result.current.discussionPrefill).toBe("What does this mean?");
    });

    it("setDiscussionPrefill(null) clears the prefill", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setDiscussionPrefill("Some text");
      });

      expect(result.current.discussionPrefill).toBe("Some text");

      act(() => {
        result.current.setDiscussionPrefill(null);
      });

      expect(result.current.discussionPrefill).toBeNull();
    });

    it("prefill is cleared when vault changes (selectVault)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.setDiscussionPrefill("Discussion about this vault");
      });

      expect(result.current.discussionPrefill).toBe("Discussion about this vault");

      // Switch to different vault
      act(() => {
        result.current.selectVault(testVault2);
      });

      expect(result.current.discussionPrefill).toBeNull();
    });

    it("prefill is cleared when vault is cleared (clearVault)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.setDiscussionPrefill("Some prefill text");
      });

      expect(result.current.discussionPrefill).toBe("Some prefill text");

      act(() => {
        result.current.clearVault();
      });

      expect(result.current.discussionPrefill).toBeNull();
    });

    it("prefill is NOT persisted to localStorage (transient state)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setDiscussionPrefill("This should not be persisted");
      });

      expect(result.current.discussionPrefill).toBe("This should not be persisted");

      // Check localStorage doesn't contain prefill
      const allKeys = Object.keys(localStorage);
      const prefillKeys = allKeys.filter((key) => key.includes("prefill") || key.includes("Prefill"));
      expect(prefillKeys.length).toBe(0);
    });

    it("prefill is preserved when switching modes", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setDiscussionPrefill("Prefill for discussion");
      });

      // Switch to discussion mode
      act(() => {
        result.current.setMode("discussion");
      });

      expect(result.current.discussionPrefill).toBe("Prefill for discussion");

      // Switch to note mode
      act(() => {
        result.current.setMode("note");
      });

      expect(result.current.discussionPrefill).toBe("Prefill for discussion");
    });

    it("prefill can be updated multiple times", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setDiscussionPrefill("First");
      });
      expect(result.current.discussionPrefill).toBe("First");

      act(() => {
        result.current.setDiscussionPrefill("Second");
      });
      expect(result.current.discussionPrefill).toBe("Second");

      act(() => {
        result.current.setDiscussionPrefill("Third");
      });
      expect(result.current.discussionPrefill).toBe("Third");
    });
  });
});

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
  attachmentPath: "05_Attachments",
  setupComplete: false,
  promptsPerGeneration: 5,
  maxPoolSize: 50,
  quotesPerWeek: 1,
  badges: [],
  order: 999999,
    cardsEnabled: true,
      viMode: false,
};

const testVault2: VaultInfo = {
  id: "test-vault-2",
  name: "Another Vault",
  path: "/path/to/vault2",
  hasClaudeMd: false,
  contentRoot: "/path/to/vault2",
  inboxPath: "inbox",
  metadataPath: "06_Metadata/memory-loop",
  attachmentPath: "05_Attachments",
  setupComplete: false,
  promptsPerGeneration: 5,
  maxPoolSize: 50,
  quotesPerWeek: 1,
  badges: [],
  order: 999999,
    cardsEnabled: true,
      viMode: false,
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

    it("fixes stale running tools on session resume", () => {
      // When a session was interrupted (browser closed, network issue),
      // tools may be saved with status "running". On resume, these should
      // be marked as complete to prevent spinner from showing forever.
      const { result } = renderHook(
        () => ({
          session: useSession(),
          handler: useServerMessageHandler(),
        }),
        { wrapper: createWrapper() }
      );

      const messages = [
        { id: "msg-1", role: "user" as const, content: "hello", timestamp: "2025-01-01T12:00:00Z" },
        {
          id: "msg-2",
          role: "assistant" as const,
          content: "Let me check that file",
          timestamp: "2025-01-01T12:00:01Z",
          toolInvocations: [
            {
              toolUseId: "tool-stale-1",
              toolName: "Read",
              input: { file_path: "/test.md" },
              status: "running" as const, // Stale - should be fixed
            },
            {
              toolUseId: "tool-complete-1",
              toolName: "Write",
              input: { file_path: "/out.md" },
              output: "Success",
              status: "complete" as const, // Already complete - should stay
            },
          ],
        },
      ];

      act(() => {
        result.current.handler({
          type: "session_ready",
          sessionId: "resumed-session",
          vaultId: "vault-1",
          messages,
        });
      });

      const assistantMsg = result.current.session.messages[1];
      expect(assistantMsg.toolInvocations).toHaveLength(2);

      // Stale running tool should be marked complete
      expect(assistantMsg.toolInvocations![0].status).toBe("complete");
      expect(assistantMsg.toolInvocations![0].output).toBe("[Connection closed before tool completed]");

      // Already complete tool should stay complete with original output
      expect(assistantMsg.toolInvocations![1].status).toBe("complete");
      expect(assistantMsg.toolInvocations![1].output).toBe("Success");
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

    it("handles response_end with durationMs", () => {
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
          contextUsage: 42,
          durationMs: 1500,
        });
      });

      expect(result.current.session.messages[0].isStreaming).toBe(false);
      expect(result.current.session.messages[0].contextUsage).toBe(42);
      expect(result.current.session.messages[0].durationMs).toBe(1500);
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

  describe("adjust mode state", () => {
    it("provides initial adjust state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
      expect(result.current.browser.adjustError).toBeNull();
      expect(result.current.browser.isSaving).toBe(false);
    });

    it("startAdjust copies currentFileContent to adjustContent and sets isAdjusting", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up file content first
      act(() => {
        result.current.setFileContent("# Hello World\n\nThis is content.", false);
      });

      expect(result.current.browser.currentFileContent).toBe("# Hello World\n\nThis is content.");

      // Enter adjust mode
      act(() => {
        result.current.startAdjust();
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("# Hello World\n\nThis is content.");
      expect(result.current.browser.adjustError).toBeNull();
      expect(result.current.browser.isSaving).toBe(false);
    });

    it("startAdjust handles null currentFileContent", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // currentFileContent is null by default
      expect(result.current.browser.currentFileContent).toBeNull();

      // Enter adjust mode
      act(() => {
        result.current.startAdjust();
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("");
    });

    it("startAdjust clears previous adjustError", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up a previous error state
      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.saveError("Previous error");
      });

      expect(result.current.browser.adjustError).toBe("Previous error");

      // Start adjust again should clear the error
      act(() => {
        result.current.startAdjust();
      });

      expect(result.current.browser.adjustError).toBeNull();
    });

    it("updateAdjustContent updates the content being edited", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Enter adjust mode
      act(() => {
        result.current.setFileContent("# Original", false);
        result.current.startAdjust();
      });

      expect(result.current.browser.adjustContent).toBe("# Original");

      // Update content
      act(() => {
        result.current.updateAdjustContent("# Modified content");
      });

      expect(result.current.browser.adjustContent).toBe("# Modified content");
    });

    it("cancelAdjust clears all adjust state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up adjust state
      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("# Modified");

      // Cancel
      act(() => {
        result.current.cancelAdjust();
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
      expect(result.current.browser.adjustError).toBeNull();
      expect(result.current.browser.isSaving).toBe(false);
    });

    it("startSave sets isSaving and clears adjustError", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up adjust state with an error
      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.saveError("Previous error");
      });

      expect(result.current.browser.adjustError).toBe("Previous error");

      // Start save
      act(() => {
        result.current.startSave();
      });

      expect(result.current.browser.isSaving).toBe(true);
      expect(result.current.browser.adjustError).toBeNull();
    });

    it("saveSuccess clears all adjust state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up adjust state with saving in progress
      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
        result.current.startSave();
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.isSaving).toBe(true);

      // Save success
      act(() => {
        result.current.saveSuccess();
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
      expect(result.current.browser.adjustError).toBeNull();
      expect(result.current.browser.isSaving).toBe(false);
    });

    it("saveError sets error and preserves adjustContent (REQ-F-15)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up adjust state with saving in progress
      act(() => {
        result.current.setFileContent("# Original", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified content that user typed");
        result.current.startSave();
      });

      expect(result.current.browser.isSaving).toBe(true);
      expect(result.current.browser.adjustContent).toBe("# Modified content that user typed");

      // Save error
      act(() => {
        result.current.saveError("Permission denied");
      });

      expect(result.current.browser.isSaving).toBe(false);
      expect(result.current.browser.adjustError).toBe("Permission denied");
      // Critical: content must be preserved for retry/copy
      expect(result.current.browser.adjustContent).toBe("# Modified content that user typed");
      // Should still be in adjust mode
      expect(result.current.browser.isAdjusting).toBe(true);
    });

    it("setCurrentPath clears adjust state when navigating (REQ-F-9)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up adjust state
      act(() => {
        result.current.setCurrentPath("folder/file.md");
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("# Modified");

      // Navigate to different file
      act(() => {
        result.current.setCurrentPath("folder/other.md");
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
      expect(result.current.browser.adjustError).toBeNull();
      expect(result.current.browser.isSaving).toBe(false);
    });

    it("setCurrentPath clears adjust error when navigating", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up adjust state with error
      act(() => {
        result.current.setCurrentPath("folder/file.md");
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.saveError("Some error");
      });

      expect(result.current.browser.adjustError).toBe("Some error");

      // Navigate to different file
      act(() => {
        result.current.setCurrentPath("folder/other.md");
      });

      expect(result.current.browser.adjustError).toBeNull();
    });

    it("clearBrowserState clears adjust state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up adjust state
      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
      });

      expect(result.current.browser.isAdjusting).toBe(true);

      // Clear browser state
      act(() => {
        result.current.clearBrowserState();
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
      expect(result.current.browser.adjustError).toBeNull();
      expect(result.current.browser.isSaving).toBe(false);
    });

    it("selectVault clears adjust state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up adjust state
      act(() => {
        result.current.selectVault(testVault);
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
      });

      expect(result.current.browser.isAdjusting).toBe(true);

      // Switch vault
      act(() => {
        result.current.selectVault(testVault2);
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
      expect(result.current.browser.adjustError).toBeNull();
      expect(result.current.browser.isSaving).toBe(false);
    });

    it("clearVault clears adjust state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up adjust state
      act(() => {
        result.current.selectVault(testVault);
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
      });

      expect(result.current.browser.isAdjusting).toBe(true);

      // Clear vault
      act(() => {
        result.current.clearVault();
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
    });

    it("adjust state is preserved when switching modes", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up adjust state in browse mode
      act(() => {
        result.current.setMode("browse");
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("# Modified");

      // Switch to discussion mode
      act(() => {
        result.current.setMode("discussion");
      });

      // Adjust state should be preserved
      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("# Modified");

      // Switch back to browse mode
      act(() => {
        result.current.setMode("browse");
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("# Modified");
    });

    it("full adjust workflow: edit, save success", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Load file
      act(() => {
        result.current.setCurrentPath("notes/test.md");
        result.current.setFileContent("# Original content", false);
      });

      // Enter adjust mode
      act(() => {
        result.current.startAdjust();
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("# Original content");

      // Edit content
      act(() => {
        result.current.updateAdjustContent("# Updated content");
      });

      expect(result.current.browser.adjustContent).toBe("# Updated content");

      // Start save
      act(() => {
        result.current.startSave();
      });

      expect(result.current.browser.isSaving).toBe(true);

      // Save success
      act(() => {
        result.current.saveSuccess();
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.isSaving).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
    });

    it("full adjust workflow: edit, save error, retry", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Load file and start adjusting
      act(() => {
        result.current.setCurrentPath("notes/test.md");
        result.current.setFileContent("# Original", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
      });

      // First save attempt fails
      act(() => {
        result.current.startSave();
      });

      act(() => {
        result.current.saveError("Network error");
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.isSaving).toBe(false);
      expect(result.current.browser.adjustError).toBe("Network error");
      expect(result.current.browser.adjustContent).toBe("# Modified");

      // Retry save
      act(() => {
        result.current.startSave();
      });

      expect(result.current.browser.adjustError).toBeNull();
      expect(result.current.browser.isSaving).toBe(true);

      // Second attempt succeeds
      act(() => {
        result.current.saveSuccess();
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustError).toBeNull();
    });
  });

  describe("task state", () => {
    it("provides initial task state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.browser.viewMode).toBe("files");
      expect(result.current.browser.tasks).toEqual([]);
      expect(result.current.browser.isTasksLoading).toBe(false);
      expect(result.current.browser.tasksError).toBeNull();
    });

    it("setViewMode updates the view mode", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setViewMode("tasks");
      });

      expect(result.current.browser.viewMode).toBe("tasks");
    });

    it("setViewMode persists to localStorage", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setViewMode("tasks");
      });

      expect(localStorage.getItem("memory-loop:viewMode")).toBe("tasks");
    });

    it("setViewMode toggles back to files", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setViewMode("tasks");
      });

      expect(result.current.browser.viewMode).toBe("tasks");

      act(() => {
        result.current.setViewMode("files");
      });

      expect(result.current.browser.viewMode).toBe("files");
    });

    it("setTasks updates the task list", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const tasks = [
        { text: "Task 1", state: " ", filePath: "folder/file.md", lineNumber: 1, fileMtime: 1000, category: "inbox" as const },
        { text: "Task 2", state: "x", filePath: "folder/file.md", lineNumber: 2, fileMtime: 1000, category: "inbox" as const },
      ];

      act(() => {
        result.current.setTasks(tasks);
      });

      expect(result.current.browser.tasks).toEqual(tasks);
      expect(result.current.browser.isTasksLoading).toBe(false);
      expect(result.current.browser.tasksError).toBeNull();
    });

    it("setTasksLoading updates loading state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setTasksLoading(true);
      });

      expect(result.current.browser.isTasksLoading).toBe(true);

      act(() => {
        result.current.setTasksLoading(false);
      });

      expect(result.current.browser.isTasksLoading).toBe(false);
    });

    it("setTasksLoading clears error when starting new operation", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setTasksError("Previous error");
      });

      expect(result.current.browser.tasksError).toBe("Previous error");

      act(() => {
        result.current.setTasksLoading(true);
      });

      expect(result.current.browser.tasksError).toBeNull();
    });

    it("setTasksError updates error state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setTasksError("Failed to load tasks");
      });

      expect(result.current.browser.tasksError).toBe("Failed to load tasks");
      expect(result.current.browser.isTasksLoading).toBe(false);
    });

    it("setTasksError can clear error with null", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setTasksError("Some error");
      });

      expect(result.current.browser.tasksError).toBe("Some error");

      act(() => {
        result.current.setTasksError(null);
      });

      expect(result.current.browser.tasksError).toBeNull();
    });

    it("updateTask updates a single task by filePath and lineNumber", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const tasks = [
        { text: "Task 1", state: " ", filePath: "folder/file.md", lineNumber: 1, fileMtime: 1000, category: "inbox" as const },
        { text: "Task 2", state: " ", filePath: "folder/file.md", lineNumber: 2, fileMtime: 1000, category: "inbox" as const },
        { text: "Task 3", state: " ", filePath: "other/file.md", lineNumber: 1, fileMtime: 2000, category: "inbox" as const },
      ];

      act(() => {
        result.current.setTasks(tasks);
      });

      // Update the second task
      act(() => {
        result.current.updateTask("folder/file.md", 2, "x");
      });

      expect(result.current.browser.tasks[0].state).toBe(" ");
      expect(result.current.browser.tasks[1].state).toBe("x");
      expect(result.current.browser.tasks[2].state).toBe(" ");
    });

    it("updateTask does not modify tasks if no match found", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const tasks = [
        { text: "Task 1", state: " ", filePath: "folder/file.md", lineNumber: 1, fileMtime: 1000, category: "inbox" as const },
      ];

      act(() => {
        result.current.setTasks(tasks);
      });

      // Try to update non-existent task
      act(() => {
        result.current.updateTask("nonexistent.md", 99, "x");
      });

      expect(result.current.browser.tasks[0].state).toBe(" ");
    });

    it("updateTask supports full state cycle", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const tasks = [
        { text: "Task 1", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000, category: "inbox" as const },
      ];

      act(() => {
        result.current.setTasks(tasks);
      });

      // Cycle through all states
      const states = ["x", "/", "?", "b", "f", " "];
      for (const state of states) {
        act(() => {
          result.current.updateTask("file.md", 1, state);
        });
        expect(result.current.browser.tasks[0].state).toBe(state);
      }
    });

    it("selectVault clears task state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up task state
      act(() => {
        result.current.selectVault(testVault);
        result.current.setViewMode("tasks");
        result.current.setTasks([
          { text: "Task", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000, category: "inbox" as const },
        ]);
      });

      expect(result.current.browser.tasks.length).toBe(1);

      // Switch vault
      act(() => {
        result.current.selectVault(testVault2);
      });

      expect(result.current.browser.tasks).toEqual([]);
      // viewMode is persisted, so it remains
    });

    it("clearVault clears task state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up task state
      act(() => {
        result.current.selectVault(testVault);
        result.current.setTasks([
          { text: "Task", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000, category: "inbox" as const },
        ]);
      });

      expect(result.current.browser.tasks.length).toBe(1);

      // Clear vault
      act(() => {
        result.current.clearVault();
      });

      expect(result.current.browser.tasks).toEqual([]);
    });

    it("clearBrowserState clears task state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up task state
      act(() => {
        result.current.setTasks([
          { text: "Task", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000, category: "inbox" as const },
        ]);
        result.current.setTasksError("Some error");
      });

      expect(result.current.browser.tasks.length).toBe(1);
      expect(result.current.browser.tasksError).toBe("Some error");

      // Clear browser state
      act(() => {
        result.current.clearBrowserState();
      });

      expect(result.current.browser.tasks).toEqual([]);
      expect(result.current.browser.tasksError).toBeNull();
    });

    it("viewMode is preserved when switching modes", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setViewMode("tasks");
      });

      expect(result.current.browser.viewMode).toBe("tasks");

      // Switch application mode
      act(() => {
        result.current.setMode("discussion");
      });

      expect(result.current.browser.viewMode).toBe("tasks");

      // Switch back to browse mode
      act(() => {
        result.current.setMode("browse");
      });

      expect(result.current.browser.viewMode).toBe("tasks");
    });
  });

  describe("showNewSessionDialog", () => {
    it("provides initial state with showNewSessionDialog false", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.showNewSessionDialog).toBe(false);
    });

    it("setShowNewSessionDialog(true) shows the dialog", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setShowNewSessionDialog(true);
      });

      expect(result.current.showNewSessionDialog).toBe(true);
    });

    it("setShowNewSessionDialog(false) hides the dialog", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setShowNewSessionDialog(true);
      });

      expect(result.current.showNewSessionDialog).toBe(true);

      act(() => {
        result.current.setShowNewSessionDialog(false);
      });

      expect(result.current.showNewSessionDialog).toBe(false);
    });

    it("dialog state is preserved when switching modes", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setShowNewSessionDialog(true);
      });

      // Switch to note mode
      act(() => {
        result.current.setMode("note");
      });

      expect(result.current.showNewSessionDialog).toBe(true);

      // Switch to home mode
      act(() => {
        result.current.setMode("home");
      });

      expect(result.current.showNewSessionDialog).toBe(true);

      // Switch back to discussion mode
      act(() => {
        result.current.setMode("discussion");
      });

      expect(result.current.showNewSessionDialog).toBe(true);
    });

    it("dialog is closed when vault changes (selectVault)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.setShowNewSessionDialog(true);
      });

      expect(result.current.showNewSessionDialog).toBe(true);

      // Switch to different vault
      act(() => {
        result.current.selectVault(testVault2);
      });

      expect(result.current.showNewSessionDialog).toBe(false);
    });

    it("dialog is closed when vault is cleared (clearVault)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.setShowNewSessionDialog(true);
      });

      expect(result.current.showNewSessionDialog).toBe(true);

      act(() => {
        result.current.clearVault();
      });

      expect(result.current.showNewSessionDialog).toBe(false);
    });

    it("dialog state is NOT persisted to localStorage (transient state)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setShowNewSessionDialog(true);
      });

      expect(result.current.showNewSessionDialog).toBe(true);

      // Check localStorage doesn't contain dialog state
      const allKeys = Object.keys(localStorage);
      const dialogKeys = allKeys.filter(
        (key) => key.includes("dialog") || key.includes("Dialog") || key.includes("newSession")
      );
      expect(dialogKeys.length).toBe(0);
    });
  });

  describe("wantsNewSession", () => {
    it("provides initial state with wantsNewSession false", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.wantsNewSession).toBe(false);
    });

    it("startNewSession sets wantsNewSession to true", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.setSessionId("old-session");
      });

      expect(result.current.wantsNewSession).toBe(false);

      act(() => {
        result.current.startNewSession();
      });

      expect(result.current.wantsNewSession).toBe(true);
      expect(result.current.sessionId).toBeNull();
      expect(result.current.messages).toEqual([]);
    });

    it("setSessionId clears wantsNewSession", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.startNewSession();
      });

      expect(result.current.wantsNewSession).toBe(true);

      act(() => {
        result.current.setSessionId("new-session-id");
      });

      expect(result.current.wantsNewSession).toBe(false);
      expect(result.current.sessionId).toBe("new-session-id");
    });

    it("setPendingSessionId clears wantsNewSession (resume overrides new)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.startNewSession();
      });

      expect(result.current.wantsNewSession).toBe(true);

      // User clicks "Resume" on a previous session
      act(() => {
        result.current.setPendingSessionId("resume-session-id");
      });

      expect(result.current.wantsNewSession).toBe(false);
      expect(result.current.pendingSessionId).toBe("resume-session-id");
    });

    it("wantsNewSession is cleared when vault changes", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.startNewSession();
      });

      expect(result.current.wantsNewSession).toBe(true);

      act(() => {
        result.current.selectVault(testVault2);
      });

      expect(result.current.wantsNewSession).toBe(false);
    });

    it("wantsNewSession is cleared when vault is cleared", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.startNewSession();
      });

      expect(result.current.wantsNewSession).toBe(true);

      act(() => {
        result.current.clearVault();
      });

      expect(result.current.wantsNewSession).toBe(false);
    });

    it("wantsNewSession persists across mode switches", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.startNewSession();
      });

      expect(result.current.wantsNewSession).toBe(true);

      // Switch modes
      act(() => {
        result.current.setMode("home");
      });

      expect(result.current.wantsNewSession).toBe(true);

      act(() => {
        result.current.setMode("discussion");
      });

      expect(result.current.wantsNewSession).toBe(true);
    });
  });

  describe("tool invocations", () => {
    it("addToolToLastMessage adds a tool to the last assistant message", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Create an assistant message first
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "",
          isStreaming: true,
        });
      });

      // Add a tool
      act(() => {
        result.current.addToolToLastMessage("tool-123", "Read");
      });

      const lastMessage = result.current.messages[0];
      expect(lastMessage.toolInvocations).toBeDefined();
      expect(lastMessage.toolInvocations).toHaveLength(1);
      expect(lastMessage.toolInvocations![0]).toEqual({
        toolUseId: "tool-123",
        toolName: "Read",
        status: "running",
      });
    });

    it("updateToolInput updates tool input", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Create assistant message with tool
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "",
          isStreaming: true,
        });
        result.current.addToolToLastMessage("tool-123", "Read");
      });

      // Update tool input
      act(() => {
        result.current.updateToolInput("tool-123", { file_path: "/test.md" });
      });

      const lastMessage = result.current.messages[0];
      expect(lastMessage.toolInvocations![0].input).toEqual({ file_path: "/test.md" });
    });

    it("completeToolInvocation marks tool as complete with output", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Create assistant message with tool
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "",
          isStreaming: true,
        });
        result.current.addToolToLastMessage("tool-123", "Read");
      });

      // Complete the tool
      act(() => {
        result.current.completeToolInvocation("tool-123", "File contents here");
      });

      const lastMessage = result.current.messages[0];
      expect(lastMessage.toolInvocations![0].status).toBe("complete");
      expect(lastMessage.toolInvocations![0].output).toBe("File contents here");
    });

    it("completeToolInvocation finds tool in earlier messages (not just last)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Create first assistant message with tool
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "First response",
          isStreaming: false,
          toolInvocations: [{
            toolUseId: "tool-123",
            toolName: "Read",
            status: "running" as const,
          }],
        });
      });

      // Add another message (user follow-up)
      act(() => {
        result.current.addMessage({
          role: "user",
          content: "Thanks!",
        });
      });

      // Complete the tool from the earlier message
      act(() => {
        result.current.completeToolInvocation("tool-123", "File contents");
      });

      // Should update the first message's tool, not fail
      expect(result.current.messages[0].toolInvocations![0].status).toBe("complete");
      expect(result.current.messages[0].toolInvocations![0].output).toBe("File contents");
    });

    it("completeToolInvocation handles multiple tools in same message", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Create assistant message with multiple tools
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "",
          isStreaming: true,
        });
        result.current.addToolToLastMessage("tool-1", "Read");
        result.current.addToolToLastMessage("tool-2", "Grep");
      });

      // Complete second tool first
      act(() => {
        result.current.completeToolInvocation("tool-2", "Grep output");
      });

      // Complete first tool
      act(() => {
        result.current.completeToolInvocation("tool-1", "Read output");
      });

      const lastMessage = result.current.messages[0];
      expect(lastMessage.toolInvocations).toHaveLength(2);
      expect(lastMessage.toolInvocations![0].status).toBe("complete");
      expect(lastMessage.toolInvocations![0].output).toBe("Read output");
      expect(lastMessage.toolInvocations![1].status).toBe("complete");
      expect(lastMessage.toolInvocations![1].output).toBe("Grep output");
    });

    it("addToolToLastMessage creates assistant message if none exists (race condition)", () => {
      // This tests the race condition where tool_start arrives before
      // response_start has been committed to state
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // No messages exist yet
      expect(result.current.messages).toHaveLength(0);

      // Add tool without any assistant message (simulating race condition)
      act(() => {
        result.current.addToolToLastMessage("tool-123", "Read");
      });

      // Should have created a placeholder assistant message with the tool
      expect(result.current.messages).toHaveLength(1);
      const message = result.current.messages[0];
      expect(message.role).toBe("assistant");
      expect(message.isStreaming).toBe(true);
      expect(message.content).toBe("");
      expect(message.toolInvocations).toHaveLength(1);
      expect(message.toolInvocations![0].toolUseId).toBe("tool-123");
      expect(message.toolInvocations![0].toolName).toBe("Read");
      expect(message.toolInvocations![0].status).toBe("running");
    });

    it("addToolToLastMessage creates assistant message if last is user message", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Add a user message (not an assistant message)
      act(() => {
        result.current.addMessage({
          role: "user",
          content: "Hello",
        });
      });

      // Add tool when last message is user message
      act(() => {
        result.current.addToolToLastMessage("tool-456", "Grep");
      });

      // Should have created a new assistant message
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].role).toBe("user");
      expect(result.current.messages[1].role).toBe("assistant");
      expect(result.current.messages[1].toolInvocations![0].toolUseId).toBe("tool-456");
    });

    it("tool created by race condition can still be completed", () => {
      // Full end-to-end test of the race condition scenario
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Simulate race condition: tool_start before response_start
      act(() => {
        result.current.addToolToLastMessage("tool-race", "Read");
      });

      // Tool should exist in a placeholder message
      expect(result.current.messages[0].toolInvocations![0].status).toBe("running");

      // Update tool input
      act(() => {
        result.current.updateToolInput("tool-race", { file_path: "/test.md" });
      });

      expect(result.current.messages[0].toolInvocations![0].input).toEqual({
        file_path: "/test.md",
      });

      // Complete the tool
      act(() => {
        result.current.completeToolInvocation("tool-race", "File contents");
      });

      // Tool should now be complete (spinner stops)
      expect(result.current.messages[0].toolInvocations![0].status).toBe("complete");
      expect(result.current.messages[0].toolInvocations![0].output).toBe("File contents");
    });

    it("addToolToLastMessage works with non-streaming assistant message (creates new)", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Add a completed (non-streaming) assistant message
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "Previous response",
          isStreaming: false,
        });
      });

      // Add tool - should create a new streaming message since last isn't streaming
      act(() => {
        result.current.addToolToLastMessage("tool-789", "Write");
      });

      // Should have two messages: the completed one and a new streaming one
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].isStreaming).toBe(false);
      expect(result.current.messages[1].isStreaming).toBe(true);
      expect(result.current.messages[1].toolInvocations![0].toolUseId).toBe("tool-789");
    });

    it("completeToolInvocation queues completion when tool_end arrives before tool_start", () => {
      // Tests the race condition where tool_end arrives before tool_start
      // is committed to state. The completion should be queued and applied
      // when the tool is finally added.
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // First, simulate tool_end arriving (but tool doesn't exist yet)
      act(() => {
        result.current.completeToolInvocation("tool-early-end", "File contents");
      });

      // No messages yet, completion was queued
      expect(result.current.messages).toHaveLength(0);

      // Now tool_start arrives
      act(() => {
        result.current.addToolToLastMessage("tool-early-end", "Read");
      });

      // Tool should be created with the queued completion already applied
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].toolInvocations![0].status).toBe("complete");
      expect(result.current.messages[0].toolInvocations![0].output).toBe("File contents");
    });

    it("updateToolInput queues input when tool_input arrives before tool_start", () => {
      // Tests the race condition where tool_input arrives before tool_start
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // First, simulate tool_input arriving (but tool doesn't exist yet)
      act(() => {
        result.current.updateToolInput("tool-early-input", { file_path: "/test.md" });
      });

      // No messages yet, input was queued
      expect(result.current.messages).toHaveLength(0);

      // Now tool_start arrives
      act(() => {
        result.current.addToolToLastMessage("tool-early-input", "Read");
      });

      // Tool should be created with the queued input already applied
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].toolInvocations![0].input).toEqual({
        file_path: "/test.md",
      });
      expect(result.current.messages[0].toolInvocations![0].status).toBe("running");
    });

    it("handles both input and completion arriving before tool_start", () => {
      // Tests the extreme race condition where both tool_input and tool_end
      // arrive before tool_start
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Both arrive before tool exists
      act(() => {
        result.current.updateToolInput("tool-both-early", { path: "/file.md" });
        result.current.completeToolInvocation("tool-both-early", "Done!");
      });

      // No messages yet
      expect(result.current.messages).toHaveLength(0);

      // Now tool_start arrives
      act(() => {
        result.current.addToolToLastMessage("tool-both-early", "Write");
      });

      // Tool should have both input and completion applied
      expect(result.current.messages).toHaveLength(1);
      const tool = result.current.messages[0].toolInvocations![0];
      expect(tool.input).toEqual({ path: "/file.md" });
      expect(tool.output).toBe("Done!");
      expect(tool.status).toBe("complete");
    });
  });

  describe("line break after tool completion (issue #143)", () => {
    it("prepends line break to text arriving after tool completion", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up an assistant message with a tool
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "Let me check that file.",
          isStreaming: true,
        });
        result.current.addToolToLastMessage("tool-123", "Read");
      });

      // Tool completes
      act(() => {
        result.current.completeToolInvocation("tool-123", "File contents");
      });

      // New text arrives after tool completion
      act(() => {
        result.current.updateLastMessage("I found the file.", true);
      });

      // Text should have line break prefix
      expect(result.current.messages[0].content).toBe(
        "Let me check that file.\n\nI found the file."
      );
    });

    it("does not add line break when no tool completed", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up an assistant message
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "Hello",
          isStreaming: true,
        });
      });

      // More text arrives (no tool completion)
      act(() => {
        result.current.updateLastMessage(" world", true);
      });

      // No line break should be added
      expect(result.current.messages[0].content).toBe("Hello world");
    });

    it("does not add line break when content is empty, but preserves flag for next content", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up an assistant message with a tool
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "Checking...",
          isStreaming: true,
        });
        result.current.addToolToLastMessage("tool-123", "Read");
      });

      // Tool completes
      act(() => {
        result.current.completeToolInvocation("tool-123", "File contents");
      });

      // Empty content arrives (e.g., intermediate event)
      act(() => {
        result.current.updateLastMessage("", true);
      });

      // No line break should be added for empty content
      expect(result.current.messages[0].content).toBe("Checking...");

      // Now non-empty content arrives - should still get the line break
      act(() => {
        result.current.updateLastMessage("Found it!", true);
      });

      // Line break should be added before the non-empty content
      expect(result.current.messages[0].content).toBe("Checking...\n\nFound it!");
    });

    it("resets line break flag after use", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up an assistant message with a tool
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "First part.",
          isStreaming: true,
        });
        result.current.addToolToLastMessage("tool-123", "Read");
      });

      // Tool completes
      act(() => {
        result.current.completeToolInvocation("tool-123", "File contents");
      });

      // First text after tool - should get line break
      act(() => {
        result.current.updateLastMessage("After tool.", true);
      });

      // Second text - should NOT get line break (flag was reset)
      act(() => {
        result.current.updateLastMessage(" More text.", true);
      });

      // Only one line break should have been added
      expect(result.current.messages[0].content).toBe(
        "First part.\n\nAfter tool. More text."
      );
    });

    it("handles multiple tools completing before text arrives", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up an assistant message with multiple tools
      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "Let me check those files.",
          isStreaming: true,
        });
        result.current.addToolToLastMessage("tool-1", "Read");
        result.current.addToolToLastMessage("tool-2", "Grep");
      });

      // Both tools complete
      act(() => {
        result.current.completeToolInvocation("tool-1", "File 1 contents");
        result.current.completeToolInvocation("tool-2", "Grep results");
      });

      // Text arrives after both tools
      act(() => {
        result.current.updateLastMessage("Found what I needed.", true);
      });

      // Should have exactly one line break (not two)
      expect(result.current.messages[0].content).toBe(
        "Let me check those files.\n\nFound what I needed."
      );
    });
  });

  describe("search state", () => {
    it("provides initial search state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      expect(result.current.browser.search.isActive).toBe(false);
      expect(result.current.browser.search.mode).toBe("files");
      expect(result.current.browser.search.query).toBe("");
      expect(result.current.browser.search.fileResults).toEqual([]);
      expect(result.current.browser.search.contentResults).toEqual([]);
      expect(result.current.browser.search.isLoading).toBe(false);
      expect(result.current.browser.search.expandedPaths.size).toBe(0);
      expect(result.current.browser.search.snippetsCache.size).toBe(0);
    });

    it("SET_SEARCH_ACTIVE toggles isActive true", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSearchActive(true);
      });

      expect(result.current.browser.search.isActive).toBe(true);
    });

    it("SET_SEARCH_ACTIVE toggles isActive false and clears results", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up search state
      act(() => {
        result.current.setSearchActive(true);
        result.current.setSearchQuery("test query");
        result.current.setSearchResults("files", [
          { path: "test.md", name: "test.md", score: 100, matchPositions: [0, 1, 2, 3] },
        ]);
      });

      expect(result.current.browser.search.isActive).toBe(true);
      expect(result.current.browser.search.query).toBe("test query");
      expect(result.current.browser.search.fileResults).toHaveLength(1);

      // Deactivate search
      act(() => {
        result.current.setSearchActive(false);
      });

      expect(result.current.browser.search.isActive).toBe(false);
      expect(result.current.browser.search.query).toBe("");
      expect(result.current.browser.search.fileResults).toEqual([]);
    });

    it("SET_SEARCH_MODE changes mode and clears results", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up file search results
      act(() => {
        result.current.setSearchActive(true);
        result.current.setSearchResults("files", [
          { path: "test.md", name: "test.md", score: 100, matchPositions: [0, 1, 2, 3] },
        ]);
      });

      expect(result.current.browser.search.mode).toBe("files");
      expect(result.current.browser.search.fileResults).toHaveLength(1);

      // Switch to content mode
      act(() => {
        result.current.setSearchMode("content");
      });

      expect(result.current.browser.search.mode).toBe("content");
      expect(result.current.browser.search.fileResults).toEqual([]);
      expect(result.current.browser.search.contentResults).toEqual([]);
    });

    it("SET_SEARCH_QUERY updates query string", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSearchQuery("hello world");
      });

      expect(result.current.browser.search.query).toBe("hello world");
    });

    it("SET_SEARCH_RESULTS stores file results", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const fileResults = [
        { path: "folder/file1.md", name: "file1.md", score: 95, matchPositions: [0, 1, 2, 3, 4] },
        { path: "folder/file2.md", name: "file2.md", score: 80, matchPositions: [0, 1, 2, 3, 4] },
      ];

      act(() => {
        result.current.setSearchLoading(true);
      });

      expect(result.current.browser.search.isLoading).toBe(true);

      act(() => {
        result.current.setSearchResults("files", fileResults);
      });

      expect(result.current.browser.search.fileResults).toEqual(fileResults);
      expect(result.current.browser.search.isLoading).toBe(false);
    });

    it("SET_SEARCH_RESULTS stores content results", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const contentResults = [
        { path: "notes/meeting.md", name: "meeting.md", matchCount: 5 },
        { path: "docs/readme.md", name: "readme.md", matchCount: 2 },
      ];

      act(() => {
        result.current.setSearchMode("content");
        result.current.setSearchLoading(true);
      });

      act(() => {
        result.current.setSearchResults("content", undefined, contentResults);
      });

      expect(result.current.browser.search.contentResults).toEqual(contentResults);
      expect(result.current.browser.search.isLoading).toBe(false);
    });

    it("SET_SEARCH_LOADING updates loading state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSearchLoading(true);
      });

      expect(result.current.browser.search.isLoading).toBe(true);

      act(() => {
        result.current.setSearchLoading(false);
      });

      expect(result.current.browser.search.isLoading).toBe(false);
    });

    it("TOGGLE_RESULT_EXPANDED adds path to expandedPaths", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.toggleResultExpanded("folder/file.md");
      });

      expect(result.current.browser.search.expandedPaths.has("folder/file.md")).toBe(true);
    });

    it("TOGGLE_RESULT_EXPANDED removes path from expandedPaths when toggled again", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.toggleResultExpanded("folder/file.md");
      });

      expect(result.current.browser.search.expandedPaths.has("folder/file.md")).toBe(true);

      act(() => {
        result.current.toggleResultExpanded("folder/file.md");
      });

      expect(result.current.browser.search.expandedPaths.has("folder/file.md")).toBe(false);
    });

    it("SET_SNIPPETS caches snippets for a path", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const snippets = [
        {
          lineNumber: 10,
          line: "This is a matching line",
          contextBefore: ["Line 8", "Line 9"],
          contextAfter: ["Line 11", "Line 12"],
        },
        {
          lineNumber: 25,
          line: "Another match here",
          contextBefore: ["Line 23", "Line 24"],
          contextAfter: ["Line 26", "Line 27"],
        },
      ];

      act(() => {
        result.current.setSnippets("notes/meeting.md", snippets);
      });

      expect(result.current.browser.search.snippetsCache.get("notes/meeting.md")).toEqual(snippets);
    });

    it("SET_SNIPPETS can cache snippets for multiple paths", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      const snippets1 = [{ lineNumber: 1, line: "First", contextBefore: [], contextAfter: [] }];
      const snippets2 = [{ lineNumber: 5, line: "Second", contextBefore: [], contextAfter: [] }];

      act(() => {
        result.current.setSnippets("file1.md", snippets1);
        result.current.setSnippets("file2.md", snippets2);
      });

      expect(result.current.browser.search.snippetsCache.get("file1.md")).toEqual(snippets1);
      expect(result.current.browser.search.snippetsCache.get("file2.md")).toEqual(snippets2);
    });

    it("CLEAR_SEARCH resets search state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up full search state
      act(() => {
        result.current.setSearchActive(true);
        result.current.setSearchMode("content");
        result.current.setSearchQuery("important");
        result.current.setSearchResults("content", undefined, [
          { path: "notes/meeting.md", name: "meeting.md", matchCount: 3 },
        ]);
        result.current.toggleResultExpanded("notes/meeting.md");
        result.current.setSnippets("notes/meeting.md", [
          { lineNumber: 1, line: "Important note", contextBefore: [], contextAfter: [] },
        ]);
      });

      expect(result.current.browser.search.isActive).toBe(true);
      expect(result.current.browser.search.mode).toBe("content");
      expect(result.current.browser.search.query).toBe("important");
      expect(result.current.browser.search.contentResults).toHaveLength(1);
      expect(result.current.browser.search.expandedPaths.size).toBe(1);
      expect(result.current.browser.search.snippetsCache.size).toBe(1);

      // Clear search
      act(() => {
        result.current.clearSearch();
      });

      expect(result.current.browser.search.isActive).toBe(false);
      expect(result.current.browser.search.mode).toBe("files");
      expect(result.current.browser.search.query).toBe("");
      expect(result.current.browser.search.fileResults).toEqual([]);
      expect(result.current.browser.search.contentResults).toEqual([]);
      expect(result.current.browser.search.isLoading).toBe(false);
      expect(result.current.browser.search.expandedPaths.size).toBe(0);
      expect(result.current.browser.search.snippetsCache.size).toBe(0);
    });

    it("selectVault clears search state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up search state
      act(() => {
        result.current.selectVault(testVault);
        result.current.setSearchActive(true);
        result.current.setSearchQuery("test");
        result.current.setSearchResults("files", [
          { path: "test.md", name: "test.md", score: 100, matchPositions: [0, 1, 2, 3] },
        ]);
      });

      expect(result.current.browser.search.isActive).toBe(true);
      expect(result.current.browser.search.fileResults).toHaveLength(1);

      // Switch vault
      act(() => {
        result.current.selectVault(testVault2);
      });

      expect(result.current.browser.search.isActive).toBe(false);
      expect(result.current.browser.search.query).toBe("");
      expect(result.current.browser.search.fileResults).toEqual([]);
    });

    it("clearVault clears search state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up search state
      act(() => {
        result.current.selectVault(testVault);
        result.current.setSearchActive(true);
        result.current.setSearchQuery("test");
      });

      expect(result.current.browser.search.isActive).toBe(true);

      // Clear vault
      act(() => {
        result.current.clearVault();
      });

      expect(result.current.browser.search.isActive).toBe(false);
      expect(result.current.browser.search.query).toBe("");
    });

    it("clearBrowserState clears search state", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up search state
      act(() => {
        result.current.setSearchActive(true);
        result.current.setSearchQuery("test");
        result.current.setSearchResults("files", [
          { path: "test.md", name: "test.md", score: 100, matchPositions: [0, 1, 2, 3] },
        ]);
      });

      expect(result.current.browser.search.isActive).toBe(true);
      expect(result.current.browser.search.fileResults).toHaveLength(1);

      // Clear browser state
      act(() => {
        result.current.clearBrowserState();
      });

      expect(result.current.browser.search.isActive).toBe(false);
      expect(result.current.browser.search.query).toBe("");
      expect(result.current.browser.search.fileResults).toEqual([]);
    });

    it("search state is preserved when switching modes", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up search state in browse mode
      act(() => {
        result.current.setMode("browse");
        result.current.setSearchActive(true);
        result.current.setSearchQuery("meeting notes");
        result.current.setSearchResults("files", [
          { path: "notes/meeting.md", name: "meeting.md", score: 95, matchPositions: [0, 1, 2, 3, 4, 5, 6] },
        ]);
      });

      expect(result.current.browser.search.isActive).toBe(true);
      expect(result.current.browser.search.query).toBe("meeting notes");
      expect(result.current.browser.search.fileResults).toHaveLength(1);

      // Switch to discussion mode
      act(() => {
        result.current.setMode("discussion");
      });

      // Search state should be preserved
      expect(result.current.browser.search.isActive).toBe(true);
      expect(result.current.browser.search.query).toBe("meeting notes");
      expect(result.current.browser.search.fileResults).toHaveLength(1);

      // Switch back to browse mode
      act(() => {
        result.current.setMode("browse");
      });

      expect(result.current.browser.search.isActive).toBe(true);
      expect(result.current.browser.search.query).toBe("meeting notes");
      expect(result.current.browser.search.fileResults).toHaveLength(1);
    });

    it("switching search mode clears expandedPaths and snippetsCache", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      });

      // Set up content search with expanded results
      act(() => {
        result.current.setSearchActive(true);
        result.current.setSearchMode("content");
        result.current.setSearchResults("content", undefined, [
          { path: "file.md", name: "file.md", matchCount: 3 },
        ]);
        result.current.toggleResultExpanded("file.md");
        result.current.setSnippets("file.md", [
          { lineNumber: 1, line: "Match", contextBefore: [], contextAfter: [] },
        ]);
      });

      expect(result.current.browser.search.expandedPaths.size).toBe(1);
      expect(result.current.browser.search.snippetsCache.size).toBe(1);

      // Switch to files mode
      act(() => {
        result.current.setSearchMode("files");
      });

      // Expanded paths and snippets cache should be cleared
      expect(result.current.browser.search.expandedPaths.size).toBe(0);
      expect(result.current.browser.search.snippetsCache.size).toBe(0);
    });
  });

});

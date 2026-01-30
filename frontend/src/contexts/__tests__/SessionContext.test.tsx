/**
 * Tests for SessionContext
 *
 * Tests state management, persistence, and actions.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  SessionProvider,
  useSession,
  useServerMessageHandler,
} from "../SessionContext";
import type { VaultInfo, TaskEntry } from "@memory-loop/shared";

beforeEach(() => {
  localStorage.clear();
});

// ============================================================================
// Test Helpers
// ============================================================================

function createWrapper(initialVaults?: VaultInfo[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider initialVaults={initialVaults}>{children}</SessionProvider>
    );
  };
}

function useTestSession() {
  return renderHook(() => useSession(), { wrapper: createWrapper() });
}

function useTestSessionWithHandler() {
  return renderHook(
    () => ({
      session: useSession(),
      handler: useServerMessageHandler(),
    }),
    { wrapper: createWrapper() }
  );
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
  ...testVault,
  id: "test-vault-2",
  name: "Another Vault",
  path: "/path/to/vault2",
  contentRoot: "/path/to/vault2",
  hasClaudeMd: false,
};

function createTask(overrides: Partial<TaskEntry> = {}): TaskEntry {
  return {
    text: "Test task",
    state: " ",
    filePath: "file.md",
    lineNumber: 1,
    fileMtime: 1000,
    category: "inbox" as const,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("SessionContext", () => {
  describe("initial state", () => {
    it("provides initial state with no vault selected", () => {
      const { result } = useTestSession();

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
    it("sets the current vault and persists to localStorage", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.selectVault(testVault);
      });

      expect(result.current.vault).toEqual(testVault);
      expect(localStorage.getItem("memory-loop:vaultId")).toBe("test-vault");
    });

    it("clears session, messages, and browser state when switching vaults", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.selectVault(testVault);
        result.current.setSessionId("session-123");
        result.current.addMessage({ role: "user", content: "Hello" });
        result.current.setCurrentPath("folder");
        result.current.toggleDirectory("folder");
      });

      act(() => {
        result.current.selectVault(testVault2);
      });

      expect(result.current.vault).toEqual(testVault2);
      expect(result.current.sessionId).toBeNull();
      expect(result.current.messages).toEqual([]);
      expect(result.current.browser.currentPath).toBe("");
      expect(result.current.browser.expandedDirs.size).toBe(0);
    });
  });

  describe("setSessionId", () => {
    it("sets the session ID without persisting to localStorage", () => {
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper([testVault]),
      });

      act(() => {
        result.current.selectVault(testVault);
        result.current.setSessionId("session-xyz");
      });

      expect(result.current.sessionId).toBe("session-xyz");
      expect(localStorage.getItem("memory-loop:sessions")).toBeNull();
    });
  });

  describe("setMode", () => {
    it("switches between all modes", () => {
      const { result } = useTestSession();
      const modes = ["note", "discussion", "browse", "home"] as const;

      for (const mode of modes) {
        act(() => {
          result.current.setMode(mode);
        });
        expect(result.current.mode).toBe(mode);
      }
    });
  });

  describe("message management", () => {
    it("addMessage adds a message with ID and timestamp", () => {
      const { result } = useTestSession();
      const beforeAdd = new Date();

      act(() => {
        result.current.addMessage({ role: "user", content: "Hello, world!" });
      });

      const afterAdd = new Date();
      const message = result.current.messages[0];

      expect(message.role).toBe("user");
      expect(message.content).toBe("Hello, world!");
      expect(message.id).toMatch(/^msg_/);
      expect(message.timestamp.getTime()).toBeGreaterThanOrEqual(beforeAdd.getTime());
      expect(message.timestamp.getTime()).toBeLessThanOrEqual(afterAdd.getTime());
    });

    it("updateLastMessage appends to assistant messages only", () => {
      const { result } = useTestSession();

      // User message should not be modified
      act(() => {
        result.current.addMessage({ role: "user", content: "Hello" });
        result.current.updateLastMessage("This should not appear");
      });

      expect(result.current.messages[0].content).toBe("Hello");

      // Assistant message should be modified
      act(() => {
        result.current.addMessage({ role: "assistant", content: "", isStreaming: true });
        result.current.updateLastMessage("Hi there!");
      });

      expect(result.current.messages[1].content).toBe("Hi there!");
    });

    it("updateLastMessage can mark streaming as complete", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "assistant", content: "Done", isStreaming: true });
        result.current.updateLastMessage("", false);
      });

      expect(result.current.messages[0].isStreaming).toBe(false);
    });

    it("updateLastMessage does nothing with no messages", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.updateLastMessage("test");
      });

      expect(result.current.messages).toEqual([]);
    });

    it("clearMessages removes all messages", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "user", content: "One" });
        result.current.addMessage({ role: "assistant", content: "Two" });
      });

      act(() => {
        result.current.clearMessages();
      });

      expect(result.current.messages).toEqual([]);
    });
  });

  describe("startNewSession", () => {
    it("clears session ID and messages but preserves vault", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.selectVault(testVault);
        result.current.setSessionId("session-123");
        result.current.addMessage({ role: "user", content: "Hello" });
      });

      act(() => {
        result.current.startNewSession();
      });

      expect(result.current.sessionId).toBeNull();
      expect(result.current.messages).toEqual([]);
      expect(result.current.vault).toEqual(testVault);
      expect(result.current.wantsNewSession).toBe(true);
    });
  });

  describe("clearVault", () => {
    it("clears vault, session, messages, browser state, and recent notes", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.selectVault(testVault);
        result.current.setSessionId("session-123");
        result.current.addMessage({ role: "user", content: "Hello" });
        result.current.setCurrentPath("folder");
        result.current.setRecentNotes([
          { id: "note-1", text: "Note 1", time: "12:00", date: "2025-01-01" },
        ]);
      });

      act(() => {
        result.current.clearVault();
      });

      expect(result.current.vault).toBeNull();
      expect(result.current.sessionId).toBeNull();
      expect(result.current.messages).toEqual([]);
      expect(result.current.browser.currentPath).toBe("");
      expect(result.current.recentNotes).toEqual([]);
      expect(localStorage.getItem("memory-loop:vaultId")).toBeNull();
    });
  });

  describe("useServerMessageHandler", () => {
    it("handles session_ready message", () => {
      const { result } = useTestSessionWithHandler();

      act(() => {
        result.current.handler({
          type: "session_ready",
          sessionId: "new-session",
          vaultId: "vault-1",
        });
      });

      expect(result.current.session.sessionId).toBe("new-session");
    });

    it("handles session_ready with messages (resume) and fixes stale tools", () => {
      const { result } = useTestSessionWithHandler();

      const messages = [
        { id: "msg-1", role: "user" as const, content: "hello", timestamp: "2025-01-01T12:00:00Z" },
        {
          id: "msg-2",
          role: "assistant" as const,
          content: "Let me check",
          timestamp: "2025-01-01T12:00:01Z",
          toolInvocations: [
            { toolUseId: "tool-stale", toolName: "Read", input: { file_path: "/test.md" }, status: "running" as const },
            { toolUseId: "tool-complete", toolName: "Write", input: {}, output: "Success", status: "complete" as const },
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

      expect(result.current.session.messages).toHaveLength(2);
      expect(result.current.session.messages[0].content).toBe("hello");
      // Stale running tool should be marked complete
      expect(result.current.session.messages[1].toolInvocations![0].status).toBe("complete");
      expect(result.current.session.messages[1].toolInvocations![0].output).toBe("[Connection closed before tool completed]");
      // Already complete tool should remain unchanged
      expect(result.current.session.messages[1].toolInvocations![1].output).toBe("Success");
    });

    it("handles streaming response lifecycle", () => {
      const { result } = useTestSessionWithHandler();

      act(() => {
        result.current.handler({ type: "response_start", messageId: "msg-1" });
      });

      expect(result.current.session.messages[0].role).toBe("assistant");
      expect(result.current.session.messages[0].isStreaming).toBe(true);

      act(() => {
        result.current.handler({ type: "response_chunk", messageId: "msg-1", content: "Hello" });
        result.current.handler({ type: "response_chunk", messageId: "msg-1", content: ", world!" });
      });

      expect(result.current.session.messages[0].content).toBe("Hello, world!");

      act(() => {
        result.current.handler({ type: "response_end", messageId: "msg-1", contextUsage: 42, durationMs: 1500 });
      });

      expect(result.current.session.messages[0].isStreaming).toBe(false);
      expect(result.current.session.messages[0].contextUsage).toBe(42);
      expect(result.current.session.messages[0].durationMs).toBe(1500);
    });
  });

  describe("browser state", () => {
    it("provides initial browser state", () => {
      const { result } = useTestSession();

      expect(result.current.browser.currentPath).toBe("");
      expect(result.current.browser.expandedDirs.size).toBe(0);
      expect(result.current.browser.directoryCache.size).toBe(0);
      expect(result.current.browser.currentFileContent).toBeNull();
      expect(result.current.browser.fileError).toBeNull();
      expect(result.current.browser.isLoading).toBe(false);
    });

    it("setCurrentPath updates path, clears file content/error, and persists", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.setFileError("Some error");
        result.current.setCurrentPath("folder/subfolder");
      });

      expect(result.current.browser.currentPath).toBe("folder/subfolder");
      expect(result.current.browser.currentFileContent).toBeNull();
      expect(result.current.browser.fileError).toBeNull();
      expect(localStorage.getItem("memory-loop:browserPath")).toBe("folder/subfolder");
    });

    it("toggleDirectory expands and collapses directories", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.toggleDirectory("folder");
      });
      expect(result.current.browser.expandedDirs.has("folder")).toBe(true);

      act(() => {
        result.current.toggleDirectory("folder");
      });
      expect(result.current.browser.expandedDirs.has("folder")).toBe(false);
    });

    it("cacheDirectory stores and overwrites directory entries", () => {
      const { result } = useTestSession();
      const entries1 = [{ name: "old.md", type: "file" as const, path: "old.md" }];
      const entries2 = [{ name: "new.md", type: "file" as const, path: "new.md" }];

      act(() => {
        result.current.cacheDirectory("folder", entries1);
      });
      expect(result.current.browser.directoryCache.get("folder")).toEqual(entries1);

      act(() => {
        result.current.cacheDirectory("folder", entries2);
      });
      expect(result.current.browser.directoryCache.get("folder")).toEqual(entries2);
    });

    it("setFileContent updates content, truncated flag, and clears error/loading", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setFileLoading(true);
        result.current.setFileError("Previous error");
        result.current.setFileContent("# Hello World", true);
      });

      expect(result.current.browser.currentFileContent).toBe("# Hello World");
      expect(result.current.browser.currentFileTruncated).toBe(true);
      expect(result.current.browser.fileError).toBeNull();
      expect(result.current.browser.isLoading).toBe(false);
    });

    it("setFileError updates error and clears content/loading", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.setFileError("File not found");
      });

      expect(result.current.browser.fileError).toBe("File not found");
      expect(result.current.browser.currentFileContent).toBeNull();
      expect(result.current.browser.isLoading).toBe(false);
    });

    it("setFileLoading updates loading state and clears error when true", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setFileError("Previous error");
        result.current.setFileLoading(true);
      });

      expect(result.current.browser.isLoading).toBe(true);
      expect(result.current.browser.fileError).toBeNull();

      act(() => {
        result.current.setFileLoading(false);
      });
      expect(result.current.browser.isLoading).toBe(false);
    });

    it("clearBrowserState resets all browser state", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setCurrentPath("folder/subfolder");
        result.current.toggleDirectory("folder");
        result.current.cacheDirectory("folder", [{ name: "file.md", type: "file" as const, path: "folder/file.md" }]);
        result.current.setFileContent("# Test", true);
      });

      act(() => {
        result.current.clearBrowserState();
      });

      expect(result.current.browser.currentPath).toBe("");
      expect(result.current.browser.expandedDirs.size).toBe(0);
      expect(result.current.browser.directoryCache.size).toBe(0);
      expect(result.current.browser.currentFileContent).toBeNull();
    });

    it("clearDirectoryCache clears cache but preserves pinned folders", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setCurrentPath("folder/subfolder");
        result.current.toggleDirectory("folder");
        result.current.cacheDirectory("folder", [{ name: "file.md", type: "file" as const, path: "folder/file.md" }]);
        result.current.setFileContent("# Test", true);
        result.current.pinFolder("pinned-folder");
      });

      act(() => {
        result.current.clearDirectoryCache();
      });

      expect(result.current.browser.expandedDirs.size).toBe(0);
      expect(result.current.browser.directoryCache.size).toBe(0);
      expect(result.current.browser.pinnedFolders).toContain("pinned-folder");
      expect(result.current.browser.currentPath).toBe("folder/subfolder");
      expect(result.current.browser.currentFileContent).toBe("# Test");
    });

    it("setMode preserves browser state (REQ-F-22)", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setCurrentPath("folder");
        result.current.toggleDirectory("folder");
        result.current.setMode("discussion");
      });

      expect(result.current.browser.currentPath).toBe("folder");
      expect(result.current.browser.expandedDirs.has("folder")).toBe(true);
    });
  });

  describe("discussionPrefill", () => {
    it("manages prefill state correctly", () => {
      const { result } = useTestSession();

      expect(result.current.discussionPrefill).toBeNull();

      act(() => {
        result.current.setDiscussionPrefill("What does this mean?");
      });
      expect(result.current.discussionPrefill).toBe("What does this mean?");

      act(() => {
        result.current.setDiscussionPrefill(null);
      });
      expect(result.current.discussionPrefill).toBeNull();
    });

    it("is cleared when vault changes but preserved across mode switches", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.selectVault(testVault);
        result.current.setDiscussionPrefill("Discussion text");
      });

      // Preserved across mode switch
      act(() => {
        result.current.setMode("discussion");
      });
      expect(result.current.discussionPrefill).toBe("Discussion text");

      // Cleared on vault change
      act(() => {
        result.current.selectVault(testVault2);
      });
      expect(result.current.discussionPrefill).toBeNull();
    });

    it("is NOT persisted to localStorage (transient state)", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setDiscussionPrefill("This should not be persisted");
      });

      const allKeys = Object.keys(localStorage);
      const prefillKeys = allKeys.filter((key) => key.includes("prefill") || key.includes("Prefill"));
      expect(prefillKeys.length).toBe(0);
    });
  });

  describe("adjust mode state", () => {
    it("provides initial adjust state", () => {
      const { result } = useTestSession();

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
      expect(result.current.browser.adjustError).toBeNull();
      expect(result.current.browser.isSaving).toBe(false);
    });

    it("startAdjust copies file content, sets isAdjusting, and clears previous error", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.saveError("Previous error");
        result.current.startAdjust();
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("# Test");
      expect(result.current.browser.adjustError).toBeNull();
    });

    it("handles null currentFileContent", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.startAdjust();
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("");
    });

    it("updateAdjustContent updates the content being edited", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setFileContent("# Original", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified content");
      });

      expect(result.current.browser.adjustContent).toBe("# Modified content");
    });

    it("cancelAdjust clears all adjust state", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
        result.current.cancelAdjust();
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
    });

    it("save workflow: startSave, saveSuccess clears state", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.saveError("Previous error");
        result.current.startSave();
      });

      expect(result.current.browser.isSaving).toBe(true);
      expect(result.current.browser.adjustError).toBeNull();

      act(() => {
        result.current.saveSuccess();
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.isSaving).toBe(false);
    });

    it("saveError preserves adjustContent for retry (REQ-F-15)", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setFileContent("# Original", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified content");
        result.current.startSave();
        result.current.saveError("Permission denied");
      });

      expect(result.current.browser.isSaving).toBe(false);
      expect(result.current.browser.adjustError).toBe("Permission denied");
      expect(result.current.browser.adjustContent).toBe("# Modified content");
      expect(result.current.browser.isAdjusting).toBe(true);
    });

    it("setCurrentPath clears adjust state when navigating (REQ-F-9)", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setCurrentPath("folder/file.md");
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.setCurrentPath("folder/other.md");
      });

      expect(result.current.browser.isAdjusting).toBe(false);
      expect(result.current.browser.adjustContent).toBe("");
    });

    it("adjust state is preserved when switching modes", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setMode("browse");
        result.current.setFileContent("# Test", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
        result.current.setMode("discussion");
      });

      expect(result.current.browser.isAdjusting).toBe(true);
      expect(result.current.browser.adjustContent).toBe("# Modified");
    });

    it("full adjust workflow: edit, save error, retry success", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setCurrentPath("notes/test.md");
        result.current.setFileContent("# Original", false);
        result.current.startAdjust();
        result.current.updateAdjustContent("# Modified");
        result.current.startSave();
        result.current.saveError("Network error");
      });

      expect(result.current.browser.adjustContent).toBe("# Modified");

      act(() => {
        result.current.startSave();
        result.current.saveSuccess();
      });

      expect(result.current.browser.isAdjusting).toBe(false);
    });
  });

  describe("task state", () => {
    it("provides initial task state", () => {
      const { result } = useTestSession();

      expect(result.current.browser.viewMode).toBe("files");
      expect(result.current.browser.tasks).toEqual([]);
      expect(result.current.browser.isTasksLoading).toBe(false);
      expect(result.current.browser.tasksError).toBeNull();
    });

    it("setViewMode updates and persists view mode", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setViewMode("tasks");
      });

      expect(result.current.browser.viewMode).toBe("tasks");
      expect(localStorage.getItem("memory-loop:viewMode")).toBe("tasks");

      act(() => {
        result.current.setViewMode("files");
      });
      expect(result.current.browser.viewMode).toBe("files");
    });

    it("setTasks updates task list and clears loading/error", () => {
      const { result } = useTestSession();
      const tasks = [createTask({ text: "Task 1" }), createTask({ text: "Task 2", state: "x" })];

      act(() => {
        result.current.setTasks(tasks);
      });

      expect(result.current.browser.tasks).toEqual(tasks);
      expect(result.current.browser.isTasksLoading).toBe(false);
      expect(result.current.browser.tasksError).toBeNull();
    });

    it("setTasksLoading updates loading and clears error", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setTasksError("Previous error");
        result.current.setTasksLoading(true);
      });

      expect(result.current.browser.isTasksLoading).toBe(true);
      expect(result.current.browser.tasksError).toBeNull();
    });

    it("setTasksError updates error and clears loading", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setTasksError("Failed to load tasks");
      });

      expect(result.current.browser.tasksError).toBe("Failed to load tasks");
      expect(result.current.browser.isTasksLoading).toBe(false);

      act(() => {
        result.current.setTasksError(null);
      });
      expect(result.current.browser.tasksError).toBeNull();
    });

    it("updateTask updates a single task by filePath and lineNumber", () => {
      const { result } = useTestSession();
      const tasks = [
        createTask({ text: "Task 1", lineNumber: 1 }),
        createTask({ text: "Task 2", lineNumber: 2 }),
        createTask({ text: "Task 3", filePath: "other.md", lineNumber: 1 }),
      ];

      act(() => {
        result.current.setTasks(tasks);
        result.current.updateTask("file.md", 2, "x");
      });

      expect(result.current.browser.tasks[0].state).toBe(" ");
      expect(result.current.browser.tasks[1].state).toBe("x");
      expect(result.current.browser.tasks[2].state).toBe(" ");
    });

    it("updateTask does not modify tasks if no match found", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setTasks([createTask()]);
        result.current.updateTask("nonexistent.md", 99, "x");
      });

      expect(result.current.browser.tasks[0].state).toBe(" ");
    });

    it("updateTask supports full state cycle", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setTasks([createTask()]);
      });

      const states = ["x", "/", "?", "b", "f", " "];
      for (const state of states) {
        act(() => {
          result.current.updateTask("file.md", 1, state);
        });
        expect(result.current.browser.tasks[0].state).toBe(state);
      }
    });

    it("task state is cleared by selectVault, clearVault, and clearBrowserState", () => {
      const { result } = useTestSession();

      // Test selectVault clears tasks
      act(() => {
        result.current.selectVault(testVault);
        result.current.setTasks([createTask()]);
        result.current.selectVault(testVault2);
      });
      expect(result.current.browser.tasks).toEqual([]);

      // Test clearVault clears tasks
      act(() => {
        result.current.selectVault(testVault);
        result.current.setTasks([createTask()]);
        result.current.clearVault();
      });
      expect(result.current.browser.tasks).toEqual([]);

      // Test clearBrowserState clears tasks
      act(() => {
        result.current.setTasks([createTask()]);
        result.current.setTasksError("Some error");
        result.current.clearBrowserState();
      });
      expect(result.current.browser.tasks).toEqual([]);
      expect(result.current.browser.tasksError).toBeNull();
    });

    it("viewMode is preserved when switching application modes", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setViewMode("tasks");
        result.current.setMode("discussion");
        result.current.setMode("browse");
      });

      expect(result.current.browser.viewMode).toBe("tasks");
    });
  });

  describe("showNewSessionDialog", () => {
    it("manages dialog state correctly", () => {
      const { result } = useTestSession();

      expect(result.current.showNewSessionDialog).toBe(false);

      act(() => {
        result.current.setShowNewSessionDialog(true);
      });
      expect(result.current.showNewSessionDialog).toBe(true);

      act(() => {
        result.current.setShowNewSessionDialog(false);
      });
      expect(result.current.showNewSessionDialog).toBe(false);
    });

    it("is preserved across mode switches but cleared on vault change", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.selectVault(testVault);
        result.current.setShowNewSessionDialog(true);
      });

      // Preserved across mode switch
      act(() => {
        result.current.setMode("note");
      });
      expect(result.current.showNewSessionDialog).toBe(true);

      // Cleared on vault change
      act(() => {
        result.current.selectVault(testVault2);
      });
      expect(result.current.showNewSessionDialog).toBe(false);
    });

    it("is NOT persisted to localStorage (transient state)", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setShowNewSessionDialog(true);
      });

      const allKeys = Object.keys(localStorage);
      const dialogKeys = allKeys.filter(
        (key) => key.includes("dialog") || key.includes("Dialog") || key.includes("newSession")
      );
      expect(dialogKeys.length).toBe(0);
    });
  });

  describe("wantsNewSession", () => {
    it("is set by startNewSession and cleared by setSessionId", () => {
      const { result } = useTestSession();

      expect(result.current.wantsNewSession).toBe(false);

      act(() => {
        result.current.startNewSession();
      });
      expect(result.current.wantsNewSession).toBe(true);

      act(() => {
        result.current.setSessionId("new-session-id");
      });
      expect(result.current.wantsNewSession).toBe(false);
    });

    it("is cleared by setPendingSessionId (resume overrides new)", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.startNewSession();
        result.current.setPendingSessionId("resume-session-id");
      });

      expect(result.current.wantsNewSession).toBe(false);
      expect(result.current.pendingSessionId).toBe("resume-session-id");
    });

    it("is cleared when vault changes or is cleared", () => {
      const { result } = useTestSession();

      // Cleared on vault change
      act(() => {
        result.current.selectVault(testVault);
        result.current.startNewSession();
        result.current.selectVault(testVault2);
      });
      expect(result.current.wantsNewSession).toBe(false);

      // Cleared on vault clear
      act(() => {
        result.current.selectVault(testVault);
        result.current.startNewSession();
        result.current.clearVault();
      });
      expect(result.current.wantsNewSession).toBe(false);
    });

    it("persists across mode switches", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.startNewSession();
        result.current.setMode("home");
        result.current.setMode("discussion");
      });

      expect(result.current.wantsNewSession).toBe(true);
    });
  });

  describe("tool invocations", () => {
    it("addToolToLastMessage adds a tool to the last assistant message", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "assistant", content: "", isStreaming: true });
        result.current.addToolToLastMessage("tool-123", "Read");
      });

      const tool = result.current.messages[0].toolInvocations![0];
      expect(tool).toEqual({
        toolUseId: "tool-123",
        toolName: "Read",
        status: "running",
      });
    });

    it("updateToolInput updates tool input", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "assistant", content: "", isStreaming: true });
        result.current.addToolToLastMessage("tool-123", "Read");
        result.current.updateToolInput("tool-123", { file_path: "/test.md" });
      });

      expect(result.current.messages[0].toolInvocations![0].input).toEqual({ file_path: "/test.md" });
    });

    it("completeToolInvocation marks tool as complete with output", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "assistant", content: "", isStreaming: true });
        result.current.addToolToLastMessage("tool-123", "Read");
        result.current.completeToolInvocation("tool-123", "File contents here");
      });

      expect(result.current.messages[0].toolInvocations![0].status).toBe("complete");
      expect(result.current.messages[0].toolInvocations![0].output).toBe("File contents here");
    });

    it("completeToolInvocation finds tool in earlier messages", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "First response",
          isStreaming: false,
          toolInvocations: [{ toolUseId: "tool-123", toolName: "Read", status: "running" as const }],
        });
        result.current.addMessage({ role: "user", content: "Thanks!" });
        result.current.completeToolInvocation("tool-123", "File contents");
      });

      expect(result.current.messages[0].toolInvocations![0].status).toBe("complete");
    });

    it("handles multiple tools completing out of order", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "assistant", content: "", isStreaming: true });
        result.current.addToolToLastMessage("tool-1", "Read");
        result.current.addToolToLastMessage("tool-2", "Grep");
        result.current.completeToolInvocation("tool-2", "Grep output");
        result.current.completeToolInvocation("tool-1", "Read output");
      });

      expect(result.current.messages[0].toolInvocations![0].output).toBe("Read output");
      expect(result.current.messages[0].toolInvocations![1].output).toBe("Grep output");
    });

    it("addToolToLastMessage creates assistant message if none exists (race condition)", () => {
      const { result } = useTestSession();

      // No messages exist - simulates tool_start arriving before response_start
      act(() => {
        result.current.addToolToLastMessage("tool-123", "Read");
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].role).toBe("assistant");
      expect(result.current.messages[0].isStreaming).toBe(true);
      expect(result.current.messages[0].toolInvocations![0].toolUseId).toBe("tool-123");
    });

    it("addToolToLastMessage creates new assistant message if last is user message", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "user", content: "Hello" });
        result.current.addToolToLastMessage("tool-456", "Grep");
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1].role).toBe("assistant");
      expect(result.current.messages[1].toolInvocations![0].toolUseId).toBe("tool-456");
    });

    it("addToolToLastMessage creates new message if last assistant is not streaming", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "assistant", content: "Previous response", isStreaming: false });
        result.current.addToolToLastMessage("tool-789", "Write");
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1].isStreaming).toBe(true);
      expect(result.current.messages[1].toolInvocations![0].toolUseId).toBe("tool-789");
    });

    it("queues completion when tool_end arrives before tool_start", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.completeToolInvocation("tool-early-end", "File contents");
      });
      expect(result.current.messages).toHaveLength(0);

      act(() => {
        result.current.addToolToLastMessage("tool-early-end", "Read");
      });

      expect(result.current.messages[0].toolInvocations![0].status).toBe("complete");
      expect(result.current.messages[0].toolInvocations![0].output).toBe("File contents");
    });

    it("queues input when tool_input arrives before tool_start", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.updateToolInput("tool-early-input", { file_path: "/test.md" });
      });
      expect(result.current.messages).toHaveLength(0);

      act(() => {
        result.current.addToolToLastMessage("tool-early-input", "Read");
      });

      expect(result.current.messages[0].toolInvocations![0].input).toEqual({ file_path: "/test.md" });
    });

    it("handles both input and completion arriving before tool_start", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.updateToolInput("tool-both-early", { path: "/file.md" });
        result.current.completeToolInvocation("tool-both-early", "Done!");
        result.current.addToolToLastMessage("tool-both-early", "Write");
      });

      const tool = result.current.messages[0].toolInvocations![0];
      expect(tool.input).toEqual({ path: "/file.md" });
      expect(tool.output).toBe("Done!");
      expect(tool.status).toBe("complete");
    });
  });

  describe("line break after tool completion (issue #143)", () => {
    it("prepends line break to text arriving after tool completion", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({
          role: "assistant",
          content: "Let me check that file.",
          isStreaming: true,
        });
        result.current.addToolToLastMessage("tool-123", "Read");
        result.current.completeToolInvocation("tool-123", "File contents");
        result.current.updateLastMessage("I found the file.", true);
      });

      expect(result.current.messages[0].content).toBe("Let me check that file.\n\nI found the file.");
    });

    it("does not add line break when no tool completed", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "assistant", content: "Hello", isStreaming: true });
        result.current.updateLastMessage(" world", true);
      });

      expect(result.current.messages[0].content).toBe("Hello world");
    });

    it("preserves flag for next non-empty content when content is empty", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "assistant", content: "Checking...", isStreaming: true });
        result.current.addToolToLastMessage("tool-123", "Read");
        result.current.completeToolInvocation("tool-123", "File contents");
        result.current.updateLastMessage("", true);
        result.current.updateLastMessage("Found it!", true);
      });

      expect(result.current.messages[0].content).toBe("Checking...\n\nFound it!");
    });

    it("resets line break flag after use (only one line break)", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "assistant", content: "First part.", isStreaming: true });
        result.current.addToolToLastMessage("tool-123", "Read");
        result.current.completeToolInvocation("tool-123", "File contents");
        result.current.updateLastMessage("After tool.", true);
        result.current.updateLastMessage(" More text.", true);
      });

      expect(result.current.messages[0].content).toBe("First part.\n\nAfter tool. More text.");
    });

    it("handles multiple tools completing before text arrives (single line break)", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.addMessage({ role: "assistant", content: "Let me check those files.", isStreaming: true });
        result.current.addToolToLastMessage("tool-1", "Read");
        result.current.addToolToLastMessage("tool-2", "Grep");
        result.current.completeToolInvocation("tool-1", "File 1 contents");
        result.current.completeToolInvocation("tool-2", "Grep results");
        result.current.updateLastMessage("Found what I needed.", true);
      });

      expect(result.current.messages[0].content).toBe("Let me check those files.\n\nFound what I needed.");
    });
  });

  describe("search state", () => {
    it("provides initial search state", () => {
      const { result } = useTestSession();

      expect(result.current.browser.search.isActive).toBe(false);
      expect(result.current.browser.search.mode).toBe("files");
      expect(result.current.browser.search.query).toBe("");
      expect(result.current.browser.search.fileResults).toEqual([]);
      expect(result.current.browser.search.contentResults).toEqual([]);
      expect(result.current.browser.search.isLoading).toBe(false);
      expect(result.current.browser.search.expandedPaths.size).toBe(0);
      expect(result.current.browser.search.snippetsCache.size).toBe(0);
    });

    it("setSearchActive toggles isActive and clears results when deactivating", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setSearchActive(true);
        result.current.setSearchQuery("test query");
        result.current.setSearchResults("files", [
          { path: "test.md", name: "test.md", score: 100, matchPositions: [0, 1, 2, 3] },
        ]);
      });

      expect(result.current.browser.search.isActive).toBe(true);

      act(() => {
        result.current.setSearchActive(false);
      });

      expect(result.current.browser.search.isActive).toBe(false);
      expect(result.current.browser.search.query).toBe("");
      expect(result.current.browser.search.fileResults).toEqual([]);
    });

    it("setSearchMode changes mode and clears results", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setSearchActive(true);
        result.current.setSearchResults("files", [
          { path: "test.md", name: "test.md", score: 100, matchPositions: [0, 1, 2, 3] },
        ]);
        result.current.setSearchMode("content");
      });

      expect(result.current.browser.search.mode).toBe("content");
      expect(result.current.browser.search.fileResults).toEqual([]);
    });

    it("setSearchResults stores file and content results", () => {
      const { result } = useTestSession();
      const fileResults = [{ path: "file.md", name: "file.md", score: 95, matchPositions: [0, 1, 2, 3, 4] }];
      const contentResults = [{ path: "notes/meeting.md", name: "meeting.md", matchCount: 5 }];

      act(() => {
        result.current.setSearchLoading(true);
        result.current.setSearchResults("files", fileResults);
      });

      expect(result.current.browser.search.fileResults).toEqual(fileResults);
      expect(result.current.browser.search.isLoading).toBe(false);

      act(() => {
        result.current.setSearchMode("content");
        result.current.setSearchResults("content", undefined, contentResults);
      });

      expect(result.current.browser.search.contentResults).toEqual(contentResults);
    });

    it("toggleResultExpanded adds and removes paths", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.toggleResultExpanded("folder/file.md");
      });
      expect(result.current.browser.search.expandedPaths.has("folder/file.md")).toBe(true);

      act(() => {
        result.current.toggleResultExpanded("folder/file.md");
      });
      expect(result.current.browser.search.expandedPaths.has("folder/file.md")).toBe(false);
    });

    it("setSnippets caches snippets for paths", () => {
      const { result } = useTestSession();
      const snippets1 = [{ lineNumber: 1, line: "First", contextBefore: [], contextAfter: [] }];
      const snippets2 = [{ lineNumber: 5, line: "Second", contextBefore: [], contextAfter: [] }];

      act(() => {
        result.current.setSnippets("file1.md", snippets1);
        result.current.setSnippets("file2.md", snippets2);
      });

      expect(result.current.browser.search.snippetsCache.get("file1.md")).toEqual(snippets1);
      expect(result.current.browser.search.snippetsCache.get("file2.md")).toEqual(snippets2);
    });

    it("clearSearch resets all search state", () => {
      const { result } = useTestSession();

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

      act(() => {
        result.current.clearSearch();
      });

      expect(result.current.browser.search.isActive).toBe(false);
      expect(result.current.browser.search.mode).toBe("files");
      expect(result.current.browser.search.query).toBe("");
      expect(result.current.browser.search.expandedPaths.size).toBe(0);
      expect(result.current.browser.search.snippetsCache.size).toBe(0);
    });

    it("search state is cleared by selectVault, clearVault, and clearBrowserState", () => {
      const { result } = useTestSession();

      // Test selectVault
      act(() => {
        result.current.selectVault(testVault);
        result.current.setSearchActive(true);
        result.current.setSearchQuery("test");
        result.current.selectVault(testVault2);
      });
      expect(result.current.browser.search.isActive).toBe(false);

      // Test clearVault
      act(() => {
        result.current.selectVault(testVault);
        result.current.setSearchActive(true);
        result.current.clearVault();
      });
      expect(result.current.browser.search.isActive).toBe(false);

      // Test clearBrowserState
      act(() => {
        result.current.setSearchActive(true);
        result.current.clearBrowserState();
      });
      expect(result.current.browser.search.isActive).toBe(false);
    });

    it("search state is preserved when switching application modes", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setMode("browse");
        result.current.setSearchActive(true);
        result.current.setSearchQuery("meeting notes");
        result.current.setMode("discussion");
        result.current.setMode("browse");
      });

      expect(result.current.browser.search.isActive).toBe(true);
      expect(result.current.browser.search.query).toBe("meeting notes");
    });

    it("switching search mode clears expandedPaths and snippetsCache", () => {
      const { result } = useTestSession();

      act(() => {
        result.current.setSearchActive(true);
        result.current.setSearchMode("content");
        result.current.toggleResultExpanded("file.md");
        result.current.setSnippets("file.md", [
          { lineNumber: 1, line: "Match", contextBefore: [], contextAfter: [] },
        ]);
        result.current.setSearchMode("files");
      });

      expect(result.current.browser.search.expandedPaths.size).toBe(0);
      expect(result.current.browser.search.snippetsCache.size).toBe(0);
    });
  });
});

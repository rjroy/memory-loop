/**
 * Integration Tests for BrowseMode Adjust Feature
 *
 * Tests WebSocket integration for file editing:
 * - Basic edit round-trip (Acceptance Test #1)
 * - Cancel discards changes (Acceptance Test #2)
 * - Path security rejection (Acceptance Test #6)
 * - File type rejection (Acceptance Test #7)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { BrowseMode } from "../BrowseMode";
import { SessionProvider, useSession } from "../../contexts/SessionContext";
import type { ServerMessage, ClientMessage } from "@memory-loop/shared";

// Track WebSocket instances and messages
let wsInstances: MockWebSocket[] = [];
let sentMessages: ClientMessage[] = [];

// Mock WebSocket
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(public url: string) {
    wsInstances.push(this);
    setTimeout(() => {
      if (this.onopen) this.onopen(new Event("open"));
    }, 0);
  }

  send(data: string): void {
    sentMessages.push(JSON.parse(data) as ClientMessage);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateMessage(msg: ServerMessage): void {
    if (this.onmessage) {
      // Wrap in act to ensure React processes state updates
      act(() => {
        this.onmessage!(new MessageEvent("message", { data: JSON.stringify(msg) }));
      });
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

/**
 * Helper component to populate browser state for tests
 */
interface StateConfig {
  currentPath?: string;
  currentFileContent?: string | null;
  currentFileTruncated?: boolean;
}

function createTestWrapper(config: StateConfig = {}) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider>
        <StatePopulator config={config}>{children}</StatePopulator>
      </SessionProvider>
    );
  };
}

function StatePopulator({
  children,
  config,
}: {
  children: ReactNode;
  config: StateConfig;
}) {
  const session = useSession();

  useEffect(() => {
    if (config.currentPath !== undefined) {
      session.setCurrentPath(config.currentPath);
    }
    if (config.currentFileContent !== undefined && config.currentFileContent !== null) {
      session.setFileContent(config.currentFileContent, config.currentFileTruncated ?? false);
    }
  }, []);

  return <>{children}</>;
}

/**
 * Get the most recent WebSocket instance
 */
function getWebSocket(): MockWebSocket {
  if (wsInstances.length === 0) {
    throw new Error("No WebSocket instances created");
  }
  return wsInstances[wsInstances.length - 1];
}

/**
 * Clear sent messages and return them
 */
function clearAndGetMessages(): ClientMessage[] {
  const messages = [...sentMessages];
  sentMessages.length = 0;
  return messages;
}

beforeEach(() => {
  wsInstances = [];
  sentMessages = [];
  localStorage.clear();
  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
});

describe("BrowseMode Adjust Integration", () => {
  describe("Acceptance Test #1: Basic edit round-trip", () => {
    it("sends write_file message when Save is clicked", async () => {
      const originalContent = "# Original Title\n\nOriginal content.";
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "test-file.md",
          currentFileContent: originalContent,
        }),
      });

      // Wait for WebSocket to connect
      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      clearAndGetMessages();

      // Enter adjust mode
      const adjustButton = screen.getByRole("button", { name: "Adjust file" });
      fireEvent.click(adjustButton);

      // Wait for adjust mode to activate
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      // Modify content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "File content editor" });
      const modifiedContent = "# Modified Title\n\nModified content.";
      fireEvent.change(textarea, { target: { value: modifiedContent } });

      // Click Save
      const saveButton = screen.getByRole("button", { name: "Save changes" });
      fireEvent.click(saveButton);

      // Verify write_file message was sent
      const messages = clearAndGetMessages();
      const writeMsg = messages.find((m) => m.type === "write_file");
      expect(writeMsg).toBeDefined();
      expect(writeMsg).toEqual({
        type: "write_file",
        path: "test-file.md",
        content: modifiedContent,
      });
    });

    it("clears adjust state and refreshes content on file_written response", async () => {
      const originalContent = "# Original";
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "test-file.md",
          currentFileContent: originalContent,
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      const ws = getWebSocket();

      // Enter adjust mode and save
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      clearAndGetMessages();

      // Simulate file_written response
      ws.simulateMessage({
        type: "file_written",
        path: "test-file.md",
        success: true,
      });

      // Adjust mode should be cleared - Adjust button should reappear
      await waitFor(() => {
        expect(screen.queryByRole("textbox", { name: "File content editor" })).toBeNull();
      });

      // Verify read_file was sent to refresh content
      const messages = clearAndGetMessages();
      const readMsg = messages.find((m) => m.type === "read_file");
      expect(readMsg).toBeDefined();
      expect(readMsg).toEqual({
        type: "read_file",
        path: "test-file.md",
      });
    });

    it("shows saving state while waiting for response", async () => {
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "test-file.md",
          currentFileContent: "# Test",
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Enter adjust mode and save
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      // Should show saving state
      expect(screen.getByText("Saving...")).toBeDefined();
      expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(true);
    });
  });

  describe("Acceptance Test #2: Cancel discards changes", () => {
    it("does not send write_file when Cancel is clicked", async () => {
      const originalContent = "# Original content";
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "test-file.md",
          currentFileContent: originalContent,
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      clearAndGetMessages();

      // Enter adjust mode
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      // Modify content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "File content editor" });
      fireEvent.change(textarea, { target: { value: "# Modified content" } });

      // Click Cancel
      fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));

      // Verify no write_file message was sent
      const messages = clearAndGetMessages();
      const writeMsg = messages.find((m) => m.type === "write_file");
      expect(writeMsg).toBeUndefined();
    });

    it("returns to view mode with original content after Cancel", async () => {
      const originalContent = "# Original content";
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "test-file.md",
          currentFileContent: originalContent,
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Enter adjust mode
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      // Click Cancel
      fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));

      // Should exit adjust mode
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Adjust file" })).toBeDefined();
      });

      // Original content should still be rendered
      expect(screen.getByText("Original content")).toBeDefined();
    });

    it("discards changes when Escape key is pressed", async () => {
      const originalContent = "# Original";
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "test-file.md",
          currentFileContent: originalContent,
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      clearAndGetMessages();

      // Enter adjust mode
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      // Modify and press Escape
      const textarea = screen.getByRole("textbox", { name: "File content editor" });
      fireEvent.change(textarea, { target: { value: "# Modified" } });
      fireEvent.keyDown(textarea, { key: "Escape" });

      // Should exit adjust mode without saving
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Adjust file" })).toBeDefined();
      });

      // No write_file message should have been sent
      const messages = clearAndGetMessages();
      expect(messages.find((m) => m.type === "write_file")).toBeUndefined();
    });
  });

  describe("Acceptance Test #6: Path security rejection", () => {
    it("shows error and preserves content when PATH_TRAVERSAL error received", async () => {
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "../etc/config.md",
          currentFileContent: "malicious content",
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      const ws = getWebSocket();

      // Enter adjust mode and save
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      const modifiedContent = "modified malicious content";
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "File content editor" });
      fireEvent.change(textarea, { target: { value: modifiedContent } });

      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      // Simulate PATH_TRAVERSAL error response
      ws.simulateMessage({
        type: "error",
        code: "PATH_TRAVERSAL",
        message: "Path cannot contain path traversal sequences",
      });

      // Error should be displayed
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
      });
      expect(screen.getByText("Path cannot contain path traversal sequences")).toBeDefined();

      // Should still be in adjust mode with content preserved (REQ-F-15)
      expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      expect(textarea.value).toBe(modifiedContent);
    });
  });

  describe("Acceptance Test #7: File type rejection", () => {
    it("shows error when INVALID_FILE_TYPE error received during save", async () => {
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "test-file.md",
          currentFileContent: "# Test content",
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      const ws = getWebSocket();

      // Enter adjust mode and save
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      // Simulate INVALID_FILE_TYPE error response
      ws.simulateMessage({
        type: "error",
        code: "INVALID_FILE_TYPE",
        message: "Only .md files can be edited",
      });

      // Error should be displayed
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
      });
      expect(screen.getByText("Only .md files can be edited")).toBeDefined();

      // Should still be in adjust mode (content preserved)
      expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
    });

    it("preserves textarea content on INVALID_FILE_TYPE error (REQ-F-15)", async () => {
      const content = "# My markdown-like content";
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "not-markdown.txt",
          currentFileContent: content,
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      const ws = getWebSocket();

      // Enter adjust mode, modify, and save
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      const modifiedContent = "# Modified content that should be preserved";
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "File content editor" });
      fireEvent.change(textarea, { target: { value: modifiedContent } });

      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      // Simulate error
      ws.simulateMessage({
        type: "error",
        code: "INVALID_FILE_TYPE",
        message: "Only markdown files can be written",
      });

      // Content should still be preserved
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
      });
      expect(textarea.value).toBe(modifiedContent);
    });
  });

  describe("Error handling edge cases", () => {
    it("handles INTERNAL_ERROR during save", async () => {
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: "# Test",
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      const ws = getWebSocket();

      // Enter adjust mode and save
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      // Simulate INTERNAL_ERROR (e.g., disk full, permission denied)
      ws.simulateMessage({
        type: "error",
        code: "INTERNAL_ERROR",
        message: "Permission denied: cannot write to file",
      });

      // Error should be displayed
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
      });
      expect(screen.getByText("Permission denied: cannot write to file")).toBeDefined();

      // Should still be in adjust mode
      expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
    });

    it("handles FILE_NOT_FOUND error during save", async () => {
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "deleted-file.md",
          currentFileContent: "# Content for file that was deleted",
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      const ws = getWebSocket();

      // Enter adjust mode and save
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      // Simulate FILE_NOT_FOUND error
      ws.simulateMessage({
        type: "error",
        code: "FILE_NOT_FOUND",
        message: "File no longer exists",
      });

      // Error should be displayed
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
      });
      expect(screen.getByText("File no longer exists")).toBeDefined();
    });
  });

  describe("WebSocket message format", () => {
    it("sends correctly formatted write_file message", async () => {
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "documents/notes/my-note.md",
          currentFileContent: "# Note",
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      clearAndGetMessages();

      // Enter adjust mode
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      // Modify and save
      const newContent = "# Updated Note\n\nNew content with special chars: <>\"'&";
      fireEvent.change(screen.getByRole("textbox"), { target: { value: newContent } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      // Verify message format
      const messages = clearAndGetMessages();
      const writeMsg = messages.find((m) => m.type === "write_file");
      expect(writeMsg).toEqual({
        type: "write_file",
        path: "documents/notes/my-note.md",
        content: newContent,
      });
    });

    it("handles empty content save", async () => {
      render(<BrowseMode />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: "# Content to clear",
        }),
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });
      clearAndGetMessages();

      // Enter adjust mode
      fireEvent.click(screen.getByRole("button", { name: "Adjust file" }));
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });

      // Clear content and save
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      // Should still send write_file with empty content
      const messages = clearAndGetMessages();
      const writeMsg = messages.find((m) => m.type === "write_file");
      expect(writeMsg).toEqual({
        type: "write_file",
        path: "test.md",
        content: "",
      });
    });
  });
});

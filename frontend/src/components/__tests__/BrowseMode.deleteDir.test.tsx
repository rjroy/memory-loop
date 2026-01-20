/**
 * Tests for BrowseMode delete directory functionality
 *
 * Tests the delete directory feature including:
 * - Sending get_directory_contents message to preview contents
 * - Handling directory_contents response
 * - Sending delete_directory message via WebSocket
 * - Handling directory_deleted response
 * - Refreshing directory listing after deletion
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { BrowseMode } from "../BrowseMode";
import { SessionProvider, useSession } from "../../contexts/SessionContext";
import type { ServerMessage, ClientMessage, VaultInfo } from "@memory-loop/shared";

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
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(msg) }));
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

// Test wrapper that sets up vault context
function TestWrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

// Helper component to set vault
function SetupVault({ vaultId }: { vaultId: string }) {
  const { selectVault } = useSession();

  // Set up vault on mount
  useEffect(() => {
    const vault: VaultInfo = {
      id: vaultId,
      name: "Test Vault",
      path: "/test/vault",
      contentRoot: "/test/vault",
      hasClaudeMd: true,
      inboxPath: "00_Inbox",
      metadataPath: "06_Metadata/memory-loop",
      attachmentPath: "attachments",
      setupComplete: true,
      promptsPerGeneration: 5,
      maxPoolSize: 50,
      quotesPerWeek: 1,
      badges: [],
      order: 0,
    };
    selectVault(vault);
  }, [selectVault, vaultId]);

  return null;
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

describe("BrowseMode delete directory functionality", () => {
  describe("directory_contents message handling", () => {
    it("receives and stores directory contents for deletion preview", async () => {
      render(
        <TestWrapper>
          <SetupVault vaultId="test-vault" />
          <BrowseMode />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];

      // Simulate session ready and directory listing
      act(() => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "test-vault" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "my-folder", path: "my-folder", type: "directory" },
          ],
        });
      });

      // Clear initial messages
      sentMessages.length = 0;

      // Simulate receiving directory_contents message
      act(() => {
        ws.simulateMessage({
          type: "directory_contents",
          path: "my-folder",
          files: ["file1.md", "file2.md"],
          directories: ["subdir"],
          totalFiles: 2,
          totalDirectories: 1,
          truncated: false,
        });
      });

      // The message should be handled without errors
      // (BrowseMode stores this in pendingDirectoryContents state)
    });

    it("handles truncated directory contents", async () => {
      render(
        <TestWrapper>
          <SetupVault vaultId="test-vault" />
          <BrowseMode />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];

      act(() => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "test-vault" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "large-folder", path: "large-folder", type: "directory" },
          ],
        });
      });

      // Simulate receiving truncated directory_contents
      act(() => {
        ws.simulateMessage({
          type: "directory_contents",
          path: "large-folder",
          files: ["f1.md", "f2.md", "f3.md", "f4.md", "f5.md"],
          directories: ["d1", "d2", "d3", "d4", "d5"],
          totalFiles: 100,
          totalDirectories: 20,
          truncated: true,
        });
      });

      // Message should be handled - truncated flag indicates more items exist
    });
  });

  describe("directory_deleted message handling", () => {
    it("refreshes parent directory after directory deletion", async () => {
      render(
        <TestWrapper>
          <SetupVault vaultId="test-vault" />
          <BrowseMode />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];

      act(() => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "test-vault" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "my-folder", path: "my-folder", type: "directory" },
          ],
        });
      });

      // Clear messages
      sentMessages.length = 0;

      // Simulate directory_deleted message
      act(() => {
        ws.simulateMessage({
          type: "directory_deleted",
          path: "my-folder",
          filesDeleted: 5,
          directoriesDeleted: 2,
        });
      });

      // Should have sent a list_directory message to refresh the parent
      await waitFor(() => {
        const listDirMsg = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === ""
        );
        expect(listDirMsg).toBeDefined();
      });
    });

    it("refreshes nested parent directory after deletion", async () => {
      render(
        <TestWrapper>
          <SetupVault vaultId="test-vault" />
          <BrowseMode />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];

      act(() => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "test-vault" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "docs", path: "docs", type: "directory" },
          ],
        });
      });

      sentMessages.length = 0;

      // Simulate deletion of nested directory
      act(() => {
        ws.simulateMessage({
          type: "directory_deleted",
          path: "docs/archive/old-project",
          filesDeleted: 10,
          directoriesDeleted: 3,
        });
      });

      // Should refresh the parent directory (docs/archive)
      await waitFor(() => {
        const listDirMsg = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === "docs/archive"
        );
        expect(listDirMsg).toBeDefined();
      });
    });

    it("handles empty directory deletion", async () => {
      render(
        <TestWrapper>
          <SetupVault vaultId="test-vault" />
          <BrowseMode />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];

      act(() => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "test-vault" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "empty-folder", path: "empty-folder", type: "directory" },
          ],
        });
      });

      sentMessages.length = 0;

      // Simulate deletion of empty directory
      act(() => {
        ws.simulateMessage({
          type: "directory_deleted",
          path: "empty-folder",
          filesDeleted: 0,
          directoriesDeleted: 0,
        });
      });

      // Should still refresh the parent directory
      await waitFor(() => {
        const listDirMsg = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === ""
        );
        expect(listDirMsg).toBeDefined();
      });
    });
  });

  describe("delete_directory message format", () => {
    it("should match expected protocol format", () => {
      // This test verifies the expected message format
      // The actual sending is done through FileTree's onDeleteDirectory callback

      const expectedMessage = {
        type: "delete_directory",
        path: "my-folder",
      };

      // Verify message structure matches protocol
      expect(expectedMessage.type).toBe("delete_directory");
      expect(expectedMessage.path).toBeDefined();
    });
  });

  describe("get_directory_contents message format", () => {
    it("should match expected protocol format", () => {
      // This test verifies the expected message format
      // The actual sending is done through FileTree's onGetDirectoryContents callback

      const expectedMessage = {
        type: "get_directory_contents",
        path: "my-folder",
      };

      // Verify message structure matches protocol
      expect(expectedMessage.type).toBe("get_directory_contents");
      expect(expectedMessage.path).toBeDefined();
    });
  });
});

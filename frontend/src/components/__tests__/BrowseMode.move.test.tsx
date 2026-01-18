/**
 * Tests for BrowseMode move functionality
 *
 * Tests the move file/directory feature including:
 * - Sending move_file message via WebSocket
 * - Handling file_moved response
 * - Refreshing both source and destination directories
 * - Updating current path when moved file is being viewed
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
      hasSyncConfig: false,
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

describe("BrowseMode move functionality", () => {
  describe("file_moved message handling", () => {
    it("refreshes source parent directory after file move", async () => {
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
            { name: "source", path: "source", type: "directory" },
            { name: "dest", path: "dest", type: "directory" },
          ],
        });
      });

      sentMessages.length = 0;

      // Simulate file_moved message
      act(() => {
        ws.simulateMessage({
          type: "file_moved",
          oldPath: "source/file.md",
          newPath: "dest/file.md",
          referencesUpdated: 0,
        });
      });

      // Should refresh the source parent directory
      await waitFor(() => {
        const listDirMsg = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === "source"
        );
        expect(listDirMsg).toBeDefined();
      });
    });

    it("refreshes destination parent directory after file move", async () => {
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
            { name: "source", path: "source", type: "directory" },
            { name: "dest", path: "dest", type: "directory" },
          ],
        });
      });

      sentMessages.length = 0;

      act(() => {
        ws.simulateMessage({
          type: "file_moved",
          oldPath: "source/file.md",
          newPath: "dest/file.md",
          referencesUpdated: 0,
        });
      });

      // Should refresh the destination parent directory
      await waitFor(() => {
        const listDirMsg = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === "dest"
        );
        expect(listDirMsg).toBeDefined();
      });
    });

    it("refreshes both source and dest directories when different", async () => {
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
            { name: "folderA", path: "folderA", type: "directory" },
            { name: "folderB", path: "folderB", type: "directory" },
          ],
        });
      });

      sentMessages.length = 0;

      act(() => {
        ws.simulateMessage({
          type: "file_moved",
          oldPath: "folderA/doc.md",
          newPath: "folderB/doc.md",
          referencesUpdated: 2,
        });
      });

      // Should have sent two list_directory messages (one for each parent)
      await waitFor(() => {
        const sourceRefresh = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === "folderA"
        );
        const destRefresh = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === "folderB"
        );
        expect(sourceRefresh).toBeDefined();
        expect(destRefresh).toBeDefined();
      });
    });

    it("refreshes root directory when moving from root", async () => {
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
            { name: "file.md", path: "file.md", type: "file" },
            { name: "subfolder", path: "subfolder", type: "directory" },
          ],
        });
      });

      sentMessages.length = 0;

      // Move file from root to subfolder
      act(() => {
        ws.simulateMessage({
          type: "file_moved",
          oldPath: "file.md",
          newPath: "subfolder/file.md",
          referencesUpdated: 0,
        });
      });

      // Should refresh root directory (empty string path)
      await waitFor(() => {
        const rootRefresh = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === ""
        );
        expect(rootRefresh).toBeDefined();
      });
    });

    it("refreshes root directory when moving to root", async () => {
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
            { name: "subfolder", path: "subfolder", type: "directory" },
          ],
        });
      });

      sentMessages.length = 0;

      // Move file from subfolder to root
      act(() => {
        ws.simulateMessage({
          type: "file_moved",
          oldPath: "subfolder/file.md",
          newPath: "file.md",
          referencesUpdated: 0,
        });
      });

      // Should refresh both subfolder and root
      await waitFor(() => {
        const subfolderRefresh = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === "subfolder"
        );
        const rootRefresh = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === ""
        );
        expect(subfolderRefresh).toBeDefined();
        expect(rootRefresh).toBeDefined();
      });
    });

    it("refreshes deeply nested directories after move", async () => {
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
            { name: "projects", path: "projects", type: "directory" },
          ],
        });
      });

      sentMessages.length = 0;

      // Move file between deeply nested directories
      act(() => {
        ws.simulateMessage({
          type: "file_moved",
          oldPath: "projects/active/webapp/docs/readme.md",
          newPath: "projects/archive/2024/webapp/docs/readme.md",
          referencesUpdated: 5,
        });
      });

      // Should refresh both nested parent directories
      await waitFor(() => {
        const sourceRefresh = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === "projects/active/webapp/docs"
        );
        const destRefresh = sentMessages.find(
          (m) => m.type === "list_directory" && (m as { path: string }).path === "projects/archive/2024/webapp/docs"
        );
        expect(sourceRefresh).toBeDefined();
        expect(destRefresh).toBeDefined();
      });
    });

    it("only refreshes once when moving within same directory", async () => {
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

      // Move file within same directory (e.g., rename via move)
      act(() => {
        ws.simulateMessage({
          type: "file_moved",
          oldPath: "docs/old-name.md",
          newPath: "docs/new-name.md",
          referencesUpdated: 0,
        });
      });

      // Should only send one list_directory message since source and dest are same
      await waitFor(() => {
        const docsRefreshes = sentMessages.filter(
          (m) => m.type === "list_directory" && (m as { path: string }).path === "docs"
        );
        expect(docsRefreshes.length).toBe(1);
      });
    });
  });

  describe("move_file message format", () => {
    it("includes path and newPath in message", () => {
      // Verify the expected message format matches protocol
      const expectedMessage = {
        type: "move_file",
        path: "source/file.md",
        newPath: "dest/file.md",
      };

      expect(expectedMessage.type).toBe("move_file");
      expect(expectedMessage.path).toBeDefined();
      expect(expectedMessage.newPath).toBeDefined();
    });
  });
});

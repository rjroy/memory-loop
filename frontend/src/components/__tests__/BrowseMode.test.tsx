/**
 * Tests for BrowseMode component
 *
 * Tests layout, tree/viewer coordination, and responsive behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowseMode } from "../BrowseMode";
import { SessionProvider } from "../../contexts/SessionContext";
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
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(msg) }));
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

function TestWrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
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

describe("BrowseMode", () => {
  describe("layout", () => {
    it("renders tree pane and viewer pane", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      expect(screen.getByText("Files")).toBeDefined();
      expect(screen.getByText("No file selected")).toBeDefined();
    });

    it("has collapsible tree pane with toggle button", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      const collapseBtn = screen.getByRole("button", { name: /collapse file tree/i });
      expect(collapseBtn).toBeDefined();
      expect(collapseBtn.getAttribute("aria-expanded")).toBe("true");
    });

    it("collapses tree when toggle button is clicked", () => {
      const { container } = render(<BrowseMode />, { wrapper: TestWrapper });

      const collapseBtn = screen.getByRole("button", { name: /collapse file tree/i });
      fireEvent.click(collapseBtn);

      expect(container.querySelector(".browse-mode--tree-collapsed")).toBeDefined();
      expect(collapseBtn.getAttribute("aria-expanded")).toBe("false");
    });

    it("expands tree when toggle button is clicked again", () => {
      const { container } = render(<BrowseMode />, { wrapper: TestWrapper });

      const collapseBtn = screen.getByRole("button", { name: /collapse file tree/i });

      // Collapse
      fireEvent.click(collapseBtn);
      expect(container.querySelector(".browse-mode--tree-collapsed")).toBeDefined();

      // Expand
      fireEvent.click(collapseBtn);
      expect(container.querySelector(".browse-mode--tree-collapsed")).toBeNull();
    });
  });

  describe("mobile overlay", () => {
    it("has mobile menu button in viewer header", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // The mobile menu button exists but may be hidden via CSS
      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      expect(menuBtn).toBeDefined();
    });

    it("opens mobile tree overlay when menu button is clicked", () => {
      const { container } = render(<BrowseMode />, { wrapper: TestWrapper });

      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      fireEvent.click(menuBtn);

      expect(container.querySelector(".browse-mode__overlay")).toBeDefined();
      expect(container.querySelector(".browse-mode__mobile-tree")).toBeDefined();
    });

    it("closes mobile tree when close button is clicked", () => {
      const { container } = render(<BrowseMode />, { wrapper: TestWrapper });

      // Open mobile tree
      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      fireEvent.click(menuBtn);

      // Close it
      const closeBtn = screen.getByRole("button", { name: /close file browser/i });
      fireEvent.click(closeBtn);

      expect(container.querySelector(".browse-mode__overlay")).toBeNull();
      expect(container.querySelector(".browse-mode__mobile-tree")).toBeNull();
    });

    it("closes mobile tree when overlay is clicked", () => {
      const { container } = render(<BrowseMode />, { wrapper: TestWrapper });

      // Open mobile tree
      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      fireEvent.click(menuBtn);

      // Click overlay
      const overlay = container.querySelector(".browse-mode__overlay");
      fireEvent.click(overlay!);

      expect(container.querySelector(".browse-mode__overlay")).toBeNull();
    });
  });

  describe("empty state", () => {
    it("shows empty message in viewer when no file selected", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      expect(screen.getByText("Select a file to view its content")).toBeDefined();
    });

    it("shows 'No file selected' in header", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      expect(screen.getByText("No file selected")).toBeDefined();
    });
  });

  describe("file tree integration", () => {
    it("renders FileTree component in tree pane", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // FileTree renders its empty state initially
      expect(screen.getByText("No files in vault")).toBeDefined();
    });
  });

  describe("markdown viewer integration", () => {
    it("renders MarkdownViewer component in viewer pane", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // MarkdownViewer renders its empty state initially
      expect(screen.getByText("Select a file to view its content")).toBeDefined();
    });
  });

  describe("reload button", () => {
    it("has reload button in tree header", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      const reloadBtn = screen.getByRole("button", { name: /reload file tree/i });
      expect(reloadBtn).toBeDefined();
      expect(reloadBtn.textContent).toBe("♻");
    });

    it("sends list_directory message when reload button is clicked", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect and send initial messages
      await new Promise((resolve) => setTimeout(resolve, 10));
      sentMessages.length = 0; // Clear initial messages

      const reloadBtn = screen.getByRole("button", { name: /reload file tree/i });
      fireEvent.click(reloadBtn);

      // Should have sent a list_directory message for root
      const listDirMsg = sentMessages.find((m) => m.type === "list_directory");
      expect(listDirMsg).toBeDefined();
      expect(listDirMsg).toEqual({ type: "list_directory", path: "" });
    });

    it("hides reload button when tree is collapsed", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Initially visible
      expect(screen.queryByRole("button", { name: /reload file tree/i })).toBeDefined();

      // Collapse tree
      const collapseBtn = screen.getByRole("button", { name: /collapse file tree/i });
      fireEvent.click(collapseBtn);

      // Reload button should be hidden (only in desktop header - mobile still has it)
      // The desktop header reload button is conditionally rendered based on isTreeCollapsed
      // But mobile header always shows it. We have 2 buttons when expanded, 1 when collapsed.
      const reloadBtns = screen.queryAllByRole("button", { name: /reload file tree/i });
      // When collapsed, only the mobile one remains (which is hidden via CSS)
      expect(reloadBtns.length).toBeLessThan(2);
    });

    it("has reload button in mobile tree overlay", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Open mobile tree
      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      fireEvent.click(menuBtn);

      // Find all reload buttons - one should be in mobile tree
      const reloadBtns = screen.getAllByRole("button", { name: /reload file tree/i });
      expect(reloadBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("view toggle", () => {
    it("shows Files header by default", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      expect(screen.getByText("Files")).toBeDefined();
    });

    it("toggles header text when clicked", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Click the header to toggle to tasks view
      const header = screen.getByRole("button", { name: /switch to tasks view/i });
      fireEvent.click(header);

      // Now should show Tasks
      expect(screen.getByText("Tasks")).toBeDefined();
    });

    it("toggles back to files on second click", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      const header = screen.getByRole("button", { name: /switch to tasks view/i });

      // Toggle to tasks
      fireEvent.click(header);
      expect(screen.getByText("Tasks")).toBeDefined();

      // Toggle back to files - need to find the button with the new label
      const tasksHeader = screen.getByRole("button", { name: /switch to files view/i });
      fireEvent.click(tasksHeader);
      expect(screen.getByText("Files")).toBeDefined();
    });

    it("renders TaskList when in tasks view", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Toggle to tasks view
      const header = screen.getByRole("button", { name: /switch to tasks view/i });
      fireEvent.click(header);

      // TaskList should render with its empty state
      expect(screen.getByText("No tasks found")).toBeDefined();
    });

    it("persists viewMode to localStorage", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Toggle to tasks view
      const header = screen.getByRole("button", { name: /switch to tasks view/i });
      fireEvent.click(header);

      // Check localStorage (key is "memory-loop:viewMode")
      expect(localStorage.getItem("memory-loop:viewMode")).toBe("tasks");
    });
  });

  describe("task toggle when disconnected", () => {
    it("shows error and does not send message when WebSocket is disconnected", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Simulate session ready
      ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });

      // Toggle to tasks view
      const header = screen.getByRole("button", { name: /switch to tasks view/i });
      fireEvent.click(header);

      // Wait for get_tasks request to be sent
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate tasks response with a sample task
      ws.simulateMessage({
        type: "tasks",
        tasks: [
          { text: "Test task", state: " ", filePath: "test.md", lineNumber: 1, fileMtime: 1000, category: "inbox" },
        ],
        incomplete: 1,
        total: 1,
      });

      // Wait for tasks to render
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify task is displayed
      expect(screen.getByText("Test task")).toBeDefined();

      // Clear sent messages to track only new ones
      sentMessages.length = 0;

      // Simulate disconnect
      ws.readyState = MockWebSocket.CLOSED;
      ws.onclose?.(new Event("close"));

      // Wait for disconnect to propagate
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Click the task toggle button
      const toggleButton = screen.getByRole("button", { name: /Toggle task: Test task/i });
      fireEvent.click(toggleButton);

      // Verify error message is displayed
      expect(screen.getByText("Not connected. Please wait and try again.")).toBeDefined();

      // Verify no toggle_task message was sent
      const toggleMessages = sentMessages.filter((m) => m.type === "toggle_task");
      expect(toggleMessages.length).toBe(0);
    });
  });

  describe("archive functionality", () => {
    it("refreshes parent directory when file_archived message is received", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Simulate session ready
      ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });

      // Wait for session
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Clear messages to track only new ones
      sentMessages.length = 0;

      // Simulate file_archived message from server
      ws.simulateMessage({
        type: "file_archived",
        path: "00_Inbox/chats",
        archivePath: "07_Archive/2025-01/chats",
      });

      // Wait for message processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify list_directory message was sent for parent path
      const listDirMsg = sentMessages.find((m) => m.type === "list_directory" && (m as { path: string }).path === "00_Inbox");
      expect(listDirMsg).toBeDefined();
    });
  });

  describe("breadcrumb updates", () => {
    it("updates breadcrumb immediately when selecting a text file", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Simulate session ready
      ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });

      // Simulate directory listing with a markdown file
      ws.simulateMessage({
        type: "directory_listing",
        path: "",
        entries: [
          { name: "notes.md", type: "file", path: "notes.md" },
        ],
      });

      // Wait for entries to render
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Click the file
      const fileButton = screen.getByText("notes.md").closest("button");
      fireEvent.click(fileButton!);

      // Wait for state update
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Breadcrumb should update immediately (before file_content response)
      // The breadcrumb is now inside the viewer (MarkdownViewer shows .markdown-viewer__breadcrumb-current)
      const breadcrumbCurrent = document.querySelector(".markdown-viewer__breadcrumb-current");
      expect(breadcrumbCurrent?.textContent).toBe("notes.md");
    });

    it("updates breadcrumb when following wiki-links", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Simulate session ready
      ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });

      // Simulate directory listing
      ws.simulateMessage({
        type: "directory_listing",
        path: "",
        entries: [
          { name: "source.md", type: "file", path: "source.md" },
        ],
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Select the source file first
      const fileButton = screen.getByText("source.md").closest("button");
      fireEvent.click(fileButton!);

      // Simulate file content with a wiki-link
      ws.simulateMessage({
        type: "file_content",
        path: "source.md",
        content: "Check out [[target]]",
        truncated: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Clear messages to track navigation
      sentMessages.length = 0;

      // Click the wiki-link (rendered as a link in MarkdownViewer)
      const wikiLink = screen.getByText("target");
      fireEvent.click(wikiLink);

      // Verify read_file was sent for the target
      const readMsg = sentMessages.find((m) => m.type === "read_file");
      expect(readMsg).toBeDefined();
      expect((readMsg as { path: string }).path).toBe("target.md");

      // Breadcrumb should update immediately to target.md
      // The breadcrumb is now inside the viewer (MarkdownViewer shows .markdown-viewer__breadcrumb-current)
      const breadcrumbCurrent = document.querySelector(".markdown-viewer__breadcrumb-current");
      expect(breadcrumbCurrent?.textContent).toBe("target.md");
    });
  });

  describe("create directory functionality", () => {
    it("refreshes parent directory when directory_created message is received", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Simulate session ready
      ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });

      // Wait for session
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Clear messages to track only new ones
      sentMessages.length = 0;

      // Simulate directory_created message from server
      ws.simulateMessage({
        type: "directory_created",
        path: "docs/new-folder",
      });

      // Wait for message processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify list_directory message was sent for parent path
      const listDirMsg = sentMessages.find((m) => m.type === "list_directory" && (m as { path: string }).path === "docs");
      expect(listDirMsg).toBeDefined();
    });

    it("refreshes root directory when directory_created at root", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Simulate session ready
      ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });

      // Wait for session
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Clear messages to track only new ones
      sentMessages.length = 0;

      // Simulate directory_created message from server for root-level directory
      ws.simulateMessage({
        type: "directory_created",
        path: "new-folder",
      });

      // Wait for message processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify list_directory message was sent for root path
      const listDirMsg = sentMessages.find((m) => m.type === "list_directory" && (m as { path: string }).path === "");
      expect(listDirMsg).toBeDefined();
    });

    it("sends create_directory message when handleCreateDirectory is called", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Simulate session ready
      ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });

      // Simulate directory listing so FileTree renders
      ws.simulateMessage({
        type: "directory_listing",
        path: "",
        entries: [
          { name: "docs", type: "directory", path: "docs" },
        ],
      });

      // Wait for session and entries
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Clear messages to track only new ones
      sentMessages.length = 0;

      // Open context menu on docs directory
      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(docsButton!);

      // Click "Add Directory"
      fireEvent.click(screen.getByText("Add Directory"));

      // Enter directory name in dialog
      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "new-folder" } });

      // Click Create
      fireEvent.click(screen.getByText("Create"));

      // Wait for message
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify create_directory message was sent
      const createDirMsg = sentMessages.find((m) => m.type === "create_directory");
      expect(createDirMsg).toBeDefined();
      expect(createDirMsg).toEqual({
        type: "create_directory",
        path: "docs",
        name: "new-folder",
      });
    });
  });
});

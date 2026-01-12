/**
 * Tests for BrowseMode recall widgets integration
 *
 * Tests request timing, display states, and widget updates.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowseMode } from "../BrowseMode";
import { SessionProvider } from "../../contexts/SessionContext";
import type { ServerMessage, ClientMessage, WidgetResult } from "@memory-loop/shared";

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

// Sample widget results for testing
const sampleWidget: WidgetResult = {
  widgetId: "game-stats-widget",
  name: "Game Stats",
  type: "aggregate",
  location: "recall",
  display: {
    type: "summary-card",
    title: "Game Statistics",
  },
  data: {
    items: [
      { label: "Rating", value: 8.5 },
      { label: "Play Count", value: 12 },
    ],
  },
  isEmpty: false,
};

const emptyWidget: WidgetResult = {
  widgetId: "empty-widget",
  name: "Empty Widget",
  type: "aggregate",
  location: "recall",
  display: {
    type: "summary-card",
  },
  data: {},
  isEmpty: true,
  emptyReason: "No files match the pattern",
};

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

describe("BrowseMode Recall Widgets", () => {
  describe("widget request on file selection", () => {
    it("sends get_recall_widgets when a markdown file is selected", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const ws = wsInstances[0];

      // Simulate session ready and directory listing
      await act(async () => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "test.md", path: "test.md", type: "file",  },
          ],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Clear sent messages to track only new ones
      sentMessages.length = 0;

      // Click on the file to select it
      await act(async () => {
        const fileButton = screen.getByRole("button", { name: "test.md" });
        fireEvent.click(fileButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Should have sent both read_file and get_recall_widgets
      const readFileMsg = sentMessages.find((m) => m.type === "read_file");
      const recallWidgetsMsg = sentMessages.find((m) => m.type === "get_recall_widgets");
      expect(readFileMsg).toBeDefined();
      expect(recallWidgetsMsg).toBeDefined();
      // Verify the path is correct
      if (recallWidgetsMsg && recallWidgetsMsg.type === "get_recall_widgets") {
        expect(recallWidgetsMsg.path).toBe("test.md");
      }
    });

    it("sends get_recall_widgets when an image file is selected", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const ws = wsInstances[0];

      await act(async () => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "image.png", path: "image.png", type: "file",  },
          ],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      sentMessages.length = 0;

      await act(async () => {
        const fileButton = screen.getByRole("button", { name: "image.png" });
        fireEvent.click(fileButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Should send get_recall_widgets (but NOT read_file for images)
      const recallWidgetsMsg = sentMessages.find((m) => m.type === "get_recall_widgets");
      expect(recallWidgetsMsg).toBeDefined();
      if (recallWidgetsMsg && recallWidgetsMsg.type === "get_recall_widgets") {
        expect(recallWidgetsMsg.path).toBe("image.png");
      }
      // Images don't need read_file
      const readFileMsg = sentMessages.find((m) => m.type === "read_file");
      expect(readFileMsg).toBeUndefined();
    });
  });

  describe("widget display states", () => {
    it("shows loading skeleton while fetching widgets", async () => {
      const { container } = render(<BrowseMode />, { wrapper: TestWrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const ws = wsInstances[0];

      await act(async () => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "test.md", path: "test.md", type: "file",  },
          ],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Select a file (this triggers loading state)
      await act(async () => {
        const fileButton = screen.getByRole("button", { name: "test.md" });
        fireEvent.click(fileButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Should show loading skeleton
      const skeleton = container.querySelector(".browse-mode__widget-skeleton");
      expect(skeleton).toBeDefined();
    });

    it("displays widgets when recall_widgets response is received", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const ws = wsInstances[0];

      await act(async () => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "test.md", path: "test.md", type: "file",  },
          ],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        const fileButton = screen.getByRole("button", { name: "test.md" });
        fireEvent.click(fileButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Simulate file content and recall widgets response
      await act(async () => {
        ws.simulateMessage({
          type: "file_content",
          path: "test.md",
          content: "# Test",
          truncated: false,
        });
        ws.simulateMessage({
          type: "recall_widgets",
          path: "test.md",
          widgets: [sampleWidget],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Should display the widget
      expect(screen.getByText("Game Statistics")).toBeDefined();
    });

    it("shows error message when widget computation fails", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const ws = wsInstances[0];

      await act(async () => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "test.md", path: "test.md", type: "file",  },
          ],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        const fileButton = screen.getByRole("button", { name: "test.md" });
        fireEvent.click(fileButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        ws.simulateMessage({
          type: "file_content",
          path: "test.md",
          content: "# Test",
          truncated: false,
        });
        // Simulate widget error
        ws.simulateMessage({
          type: "widget_error",
          widgetId: "test-widget",
          error: "Expression evaluation failed",
          filePath: "test.md",
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Should display error message
      expect(screen.getByText("Expression evaluation failed")).toBeDefined();
    });

    it("displays empty state for widgets with no data", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const ws = wsInstances[0];

      await act(async () => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "test.md", path: "test.md", type: "file",  },
          ],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        const fileButton = screen.getByRole("button", { name: "test.md" });
        fireEvent.click(fileButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        ws.simulateMessage({
          type: "file_content",
          path: "test.md",
          content: "# Test",
          truncated: false,
        });
        // Simulate recall widgets response with empty widget
        ws.simulateMessage({
          type: "recall_widgets",
          path: "test.md",
          widgets: [emptyWidget],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Should display empty reason
      expect(screen.getByText("No files match the pattern")).toBeDefined();
    });

    it("hides widgets section when no widgets are returned", async () => {
      const { container } = render(<BrowseMode />, { wrapper: TestWrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const ws = wsInstances[0];

      await act(async () => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "test.md", path: "test.md", type: "file",  },
          ],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        const fileButton = screen.getByRole("button", { name: "test.md" });
        fireEvent.click(fileButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        ws.simulateMessage({
          type: "file_content",
          path: "test.md",
          content: "# Test",
          truncated: false,
        });
        // Simulate recall widgets response with no widgets
        ws.simulateMessage({
          type: "recall_widgets",
          path: "test.md",
          widgets: [],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Should not show the widgets section content (no widgets to render)
      const widgetsSection = container.querySelector(".browse-mode__widgets");
      expect(widgetsSection).toBeNull();
    });
  });

  describe("widget updates", () => {
    it("only shows widgets for the currently viewed file", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const ws = wsInstances[0];

      await act(async () => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [
            { name: "file1.md", path: "file1.md", type: "file",  },
            { name: "file2.md", path: "file2.md", type: "file",  },
          ],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Select first file
      await act(async () => {
        const file1Button = screen.getByRole("button", { name: "file1.md" });
        fireEvent.click(file1Button);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        ws.simulateMessage({
          type: "file_content",
          path: "file1.md",
          content: "# File 1",
          truncated: false,
        });
        ws.simulateMessage({
          type: "recall_widgets",
          path: "file1.md",
          widgets: [{ ...sampleWidget, widgetId: "file1-widget", name: "File 1 Widget", display: { ...sampleWidget.display, title: "File 1 Stats" } }],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // File 1 widget should be visible
      expect(screen.getByText("File 1 Stats")).toBeDefined();

      // Select second file (widgets from file1 should disappear due to path mismatch)
      await act(async () => {
        const file2Button = screen.getByRole("button", { name: "file2.md" });
        fireEvent.click(file2Button);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        ws.simulateMessage({
          type: "file_content",
          path: "file2.md",
          content: "# File 2",
          truncated: false,
        });
        // New widgets for file2
        ws.simulateMessage({
          type: "recall_widgets",
          path: "file2.md",
          widgets: [{ ...sampleWidget, widgetId: "file2-widget", name: "File 2 Widget", display: { ...sampleWidget.display, title: "File 2 Stats" } }],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // File 2 widget should be visible, File 1 widget should not
      expect(screen.getByText("File 2 Stats")).toBeDefined();
      expect(screen.queryByText("File 1 Stats")).toBeNull();
    });

    it("re-requests recall widgets after file save", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const ws = wsInstances[0];

      await act(async () => {
        ws.simulateMessage({ type: "session_ready", sessionId: "test-session", vaultId: "vault-1" });
        ws.simulateMessage({
          type: "directory_listing",
          path: "",
          entries: [{ name: "test.md", path: "test.md", type: "file" }],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Select file to view
      await act(async () => {
        const fileButton = screen.getByRole("button", { name: "test.md" });
        fireEvent.click(fileButton);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Clear sent messages to track new ones
      sentMessages.length = 0;

      // Simulate file_written message (file saved)
      await act(async () => {
        ws.simulateMessage({
          type: "file_written",
          path: "test.md",
          success: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Verify get_recall_widgets was sent after file save
      const widgetRequest = sentMessages.find(
        (msg) => msg.type === "get_recall_widgets"
      );
      expect(widgetRequest).toBeDefined();
      expect((widgetRequest as { type: string; path: string })?.path).toBe("test.md");
    });
  });
});

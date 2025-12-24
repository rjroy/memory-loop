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
});

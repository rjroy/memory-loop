/**
 * Tests for ModeToggle component
 *
 * Tests mode switching and visual states for Note, Chat, and View modes.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModeToggle } from "../ModeToggle";
import { SessionProvider } from "../../contexts/SessionContext";

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
    setTimeout(() => {
      if (this.onopen) this.onopen(new Event("open"));
    }, 0);
  }

  send(): void {}
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

const originalWebSocket = globalThis.WebSocket;

// Wrapper with providers
function TestWrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

beforeEach(() => {
  localStorage.clear();
  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
});

describe("ModeToggle", () => {
  describe("rendering", () => {
    it("renders Home, Note, Chat, and View options", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      expect(screen.getByText("Home")).toBeDefined();
      expect(screen.getByText("Note")).toBeDefined();
      expect(screen.getByText("Chat")).toBeDefined();
      expect(screen.getByText("View")).toBeDefined();
    });

    it("has proper accessibility attributes", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const tablist = screen.getByRole("tablist");
      expect(tablist).toBeDefined();
      expect(tablist.getAttribute("aria-label")).toBe("Application mode");

      const tabs = screen.getAllByRole("tab");
      expect(tabs.length).toBe(4);
    });

    it("shows Home as selected by default", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const homeTab = screen.getByText("Home").closest("button");
      const noteTab = screen.getByText("Note").closest("button");

      expect(homeTab?.getAttribute("aria-selected")).toBe("true");
      expect(noteTab?.getAttribute("aria-selected")).toBe("false");
    });

    it("applies selected class to active mode", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const homeTab = screen.getByText("Home").closest("button");
      expect(homeTab?.className).toContain("mode-toggle__segment--selected");
    });
  });

  describe("mode switching", () => {
    it("switches to Chat when clicked", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const discussionTab = screen.getByText("Chat").closest("button");
      fireEvent.click(discussionTab!);

      expect(discussionTab?.getAttribute("aria-selected")).toBe("true");
      expect(discussionTab?.className).toContain("mode-toggle__segment--selected");
    });

    it("switches back to Note when clicked", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      // First switch to Chat
      const discussionTab = screen.getByText("Chat").closest("button");
      fireEvent.click(discussionTab!);

      // Then switch back to Note
      const noteTab = screen.getByText("Note").closest("button");
      fireEvent.click(noteTab!);

      expect(noteTab?.getAttribute("aria-selected")).toBe("true");
      expect(noteTab?.className).toContain("mode-toggle__segment--selected");
    });

    it("does not switch when clicking already selected mode", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const noteTab = screen.getByText("Note").closest("button");
      fireEvent.click(noteTab!);

      // Should still be selected
      expect(noteTab?.getAttribute("aria-selected")).toBe("true");
    });

    it("switches to View when clicked", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const browseTab = screen.getByText("View").closest("button");
      fireEvent.click(browseTab!);

      expect(browseTab?.getAttribute("aria-selected")).toBe("true");
      expect(browseTab?.className).toContain("mode-toggle__segment--selected");
    });

    it("can switch between all four modes", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      // Start at Home
      const homeTab = screen.getByText("Home").closest("button");
      expect(homeTab?.getAttribute("aria-selected")).toBe("true");

      // Switch to Note
      const noteTab = screen.getByText("Note").closest("button");
      fireEvent.click(noteTab!);
      expect(noteTab?.getAttribute("aria-selected")).toBe("true");

      // Switch to Chat
      const discussionTab = screen.getByText("Chat").closest("button");
      fireEvent.click(discussionTab!);
      expect(discussionTab?.getAttribute("aria-selected")).toBe("true");

      // Switch to View
      const browseTab = screen.getByText("View").closest("button");
      fireEvent.click(browseTab!);
      expect(browseTab?.getAttribute("aria-selected")).toBe("true");

      // Switch back to Home
      fireEvent.click(homeTab!);
      expect(homeTab?.getAttribute("aria-selected")).toBe("true");
    });
  });

  describe("disabled state", () => {
    it("disables all buttons when disabled prop is true", () => {
      render(<ModeToggle disabled />, { wrapper: TestWrapper });

      const homeTab = screen.getByText("Home").closest("button");
      const noteTab = screen.getByText("Note").closest("button");
      const discussionTab = screen.getByText("Chat").closest("button");
      const browseTab = screen.getByText("View").closest("button");

      expect(homeTab?.hasAttribute("disabled")).toBe(true);
      expect(noteTab?.hasAttribute("disabled")).toBe(true);
      expect(discussionTab?.hasAttribute("disabled")).toBe(true);
      expect(browseTab?.hasAttribute("disabled")).toBe(true);
    });

    it("does not switch mode when disabled", () => {
      render(<ModeToggle disabled />, { wrapper: TestWrapper });

      const discussionTab = screen.getByText("Chat").closest("button");
      fireEvent.click(discussionTab!);

      // Home should still be selected
      const homeTab = screen.getByText("Home").closest("button");
      expect(homeTab?.getAttribute("aria-selected")).toBe("true");
    });
  });
});

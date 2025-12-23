/**
 * Tests for ModeToggle component
 *
 * Tests mode switching and visual states.
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
    it("renders Note and Discussion options", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      expect(screen.getByText("Note")).toBeDefined();
      expect(screen.getByText("Discussion")).toBeDefined();
    });

    it("has proper accessibility attributes", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const tablist = screen.getByRole("tablist");
      expect(tablist).toBeDefined();
      expect(tablist.getAttribute("aria-label")).toBe("Application mode");

      const tabs = screen.getAllByRole("tab");
      expect(tabs.length).toBe(2);
    });

    it("shows Note as selected by default", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const noteTab = screen.getByText("Note").closest("button");
      const discussionTab = screen.getByText("Discussion").closest("button");

      expect(noteTab?.getAttribute("aria-selected")).toBe("true");
      expect(discussionTab?.getAttribute("aria-selected")).toBe("false");
    });

    it("applies selected class to active mode", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const noteTab = screen.getByText("Note").closest("button");
      expect(noteTab?.className).toContain("mode-toggle__segment--selected");
    });
  });

  describe("mode switching", () => {
    it("switches to Discussion when clicked", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const discussionTab = screen.getByText("Discussion").closest("button");
      fireEvent.click(discussionTab!);

      expect(discussionTab?.getAttribute("aria-selected")).toBe("true");
      expect(discussionTab?.className).toContain("mode-toggle__segment--selected");
    });

    it("switches back to Note when clicked", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      // First switch to Discussion
      const discussionTab = screen.getByText("Discussion").closest("button");
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
  });

  describe("disabled state", () => {
    it("disables both buttons when disabled prop is true", () => {
      render(<ModeToggle disabled />, { wrapper: TestWrapper });

      const noteTab = screen.getByText("Note").closest("button");
      const discussionTab = screen.getByText("Discussion").closest("button");

      expect(noteTab?.hasAttribute("disabled")).toBe(true);
      expect(discussionTab?.hasAttribute("disabled")).toBe(true);
    });

    it("does not switch mode when disabled", () => {
      render(<ModeToggle disabled />, { wrapper: TestWrapper });

      const discussionTab = screen.getByText("Discussion").closest("button");
      fireEvent.click(discussionTab!);

      // Note should still be selected
      const noteTab = screen.getByText("Note").closest("button");
      expect(noteTab?.getAttribute("aria-selected")).toBe("true");
    });
  });
});

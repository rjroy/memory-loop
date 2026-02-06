/**
 * Tests for ModeToggle component
 *
 * Tests mode switching and visual states for Ground, Capture, Think, and Recall modes.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModeToggle } from "../ModeToggle";
import { SessionProvider } from "../../../contexts/SessionContext";

// Wrapper with providers
function TestWrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("ModeToggle", () => {
  describe("rendering", () => {
    it("renders Ground, Capture, Think, and Recall options", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      expect(screen.getByText("Ground")).toBeDefined();
      expect(screen.getByText("Capture")).toBeDefined();
      expect(screen.getByText("Think")).toBeDefined();
      expect(screen.getByText("Recall")).toBeDefined();
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

      const homeTab = screen.getByText("Ground").closest("button");
      const noteTab = screen.getByText("Capture").closest("button");

      expect(homeTab?.getAttribute("aria-selected")).toBe("true");
      expect(noteTab?.getAttribute("aria-selected")).toBe("false");
    });

    it("applies selected class to active mode", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const homeTab = screen.getByText("Ground").closest("button");
      expect(homeTab?.className).toContain("mode-toggle__segment--selected");
    });
  });

  describe("mode switching", () => {
    it("switches to Think when clicked", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const discussionTab = screen.getByText("Think").closest("button");
      fireEvent.click(discussionTab!);

      expect(discussionTab?.getAttribute("aria-selected")).toBe("true");
      expect(discussionTab?.className).toContain("mode-toggle__segment--selected");
    });

    it("switches back to Capture when clicked", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      // First switch to Think
      const discussionTab = screen.getByText("Think").closest("button");
      fireEvent.click(discussionTab!);

      // Then switch back to Capture
      const noteTab = screen.getByText("Capture").closest("button");
      fireEvent.click(noteTab!);

      expect(noteTab?.getAttribute("aria-selected")).toBe("true");
      expect(noteTab?.className).toContain("mode-toggle__segment--selected");
    });

    it("does not switch when clicking already selected mode", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const noteTab = screen.getByText("Capture").closest("button");
      fireEvent.click(noteTab!);

      // Should still be selected
      expect(noteTab?.getAttribute("aria-selected")).toBe("true");
    });

    it("switches to Recall when clicked", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      const browseTab = screen.getByText("Recall").closest("button");
      fireEvent.click(browseTab!);

      expect(browseTab?.getAttribute("aria-selected")).toBe("true");
      expect(browseTab?.className).toContain("mode-toggle__segment--selected");
    });

    it("can switch between all four modes", () => {
      render(<ModeToggle />, { wrapper: TestWrapper });

      // Start at Home
      const homeTab = screen.getByText("Ground").closest("button");
      expect(homeTab?.getAttribute("aria-selected")).toBe("true");

      // Switch to Capture
      const noteTab = screen.getByText("Capture").closest("button");
      fireEvent.click(noteTab!);
      expect(noteTab?.getAttribute("aria-selected")).toBe("true");

      // Switch to Think
      const discussionTab = screen.getByText("Think").closest("button");
      fireEvent.click(discussionTab!);
      expect(discussionTab?.getAttribute("aria-selected")).toBe("true");

      // Switch to Recall
      const browseTab = screen.getByText("Recall").closest("button");
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

      const homeTab = screen.getByText("Ground").closest("button");
      const noteTab = screen.getByText("Capture").closest("button");
      const discussionTab = screen.getByText("Think").closest("button");
      const browseTab = screen.getByText("Recall").closest("button");

      expect(homeTab?.hasAttribute("disabled")).toBe(true);
      expect(noteTab?.hasAttribute("disabled")).toBe(true);
      expect(discussionTab?.hasAttribute("disabled")).toBe(true);
      expect(browseTab?.hasAttribute("disabled")).toBe(true);
    });

    it("does not switch mode when disabled", () => {
      render(<ModeToggle disabled />, { wrapper: TestWrapper });

      const discussionTab = screen.getByText("Think").closest("button");
      fireEvent.click(discussionTab!);

      // Home should still be selected
      const homeTab = screen.getByText("Ground").closest("button");
      expect(homeTab?.getAttribute("aria-selected")).toBe("true");
    });
  });
});

/**
 * Tests for SearchHeader component
 *
 * Tests debounced input, dropdown menu, mode toggle, close action, and keyboard accessibility.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { SearchHeader, type SearchHeaderProps } from "../SearchHeader";

// Default props for tests
const defaultProps: SearchHeaderProps = {
  mode: "files",
  query: "",
  isLoading: false,
  onQueryChange: () => {},
  onModeChange: () => {},
  onClear: () => {},
};

beforeEach(() => {
  // Use fake timers for debounce testing
});

afterEach(() => {
  cleanup();
});

/**
 * Helper to open the dropdown menu
 */
function openMenu() {
  const menuTrigger = screen.getByRole("button", { name: "Search options" });
  fireEvent.click(menuTrigger);
}

describe("SearchHeader", () => {
  describe("rendering", () => {
    it("renders search input with correct placeholder for files mode", () => {
      render(<SearchHeader {...defaultProps} mode="files" />);

      const input = screen.getByRole("textbox", { name: "Search query" });
      expect(input).toBeDefined();
      expect(input.getAttribute("placeholder")).toBe("Search file names...");
    });

    it("renders search input with correct placeholder for content mode", () => {
      render(<SearchHeader {...defaultProps} mode="content" />);

      const input = screen.getByRole("textbox", { name: "Search query" });
      expect(input.getAttribute("placeholder")).toBe("Search content...");
    });

    it("renders menu trigger button", () => {
      render(<SearchHeader {...defaultProps} mode="files" />);

      const menuTrigger = screen.getByRole("button", { name: "Search options" });
      expect(menuTrigger).toBeDefined();
    });

    it("shows loading spinner when isLoading is true", () => {
      render(<SearchHeader {...defaultProps} isLoading={true} />);

      const spinner = screen.getByLabelText("Searching");
      expect(spinner).toBeDefined();
    });

    it("does not show loading spinner when isLoading is false", () => {
      render(<SearchHeader {...defaultProps} isLoading={false} />);

      expect(screen.queryByLabelText("Searching")).toBeNull();
    });
  });

  describe("dropdown menu", () => {
    it("does not show menu by default", () => {
      render(<SearchHeader {...defaultProps} />);

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("shows menu when trigger is clicked", () => {
      render(<SearchHeader {...defaultProps} />);

      openMenu();

      expect(screen.getByRole("menu")).toBeDefined();
    });

    it("hides menu when trigger is clicked again", () => {
      render(<SearchHeader {...defaultProps} />);

      openMenu();
      expect(screen.getByRole("menu")).toBeDefined();

      // Click trigger again to close
      const menuTrigger = screen.getByRole("button", { name: "Search options" });
      fireEvent.click(menuTrigger);

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("has aria-expanded attribute on trigger", () => {
      render(<SearchHeader {...defaultProps} />);

      const menuTrigger = screen.getByRole("button", { name: "Search options" });
      expect(menuTrigger.getAttribute("aria-expanded")).toBe("false");

      openMenu();
      expect(menuTrigger.getAttribute("aria-expanded")).toBe("true");
    });

    it("contains mode toggle and close menu items", () => {
      render(<SearchHeader {...defaultProps} mode="files" />);

      openMenu();

      const menuItems = screen.getAllByRole("menuitem");
      expect(menuItems).toHaveLength(2);
      expect(menuItems[0].textContent).toContain("Switch to Content Search");
      expect(menuItems[1].textContent).toContain("Close Search");
    });
  });

  describe("focus behavior", () => {
    it("focuses input on mount", async () => {
      render(<SearchHeader {...defaultProps} />);

      const input = screen.getByRole("textbox", { name: "Search query" });

      // Wait for the useEffect to run
      await waitFor(() => {
        expect(document.activeElement).toBe(input);
      });
    });
  });

  describe("debounced input", () => {
    it("updates local state immediately on input", () => {
      render(<SearchHeader {...defaultProps} />);

      const input: HTMLInputElement = screen.getByRole("textbox", {
        name: "Search query",
      });
      fireEvent.change(input, { target: { value: "test" } });

      expect(input.value).toBe("test");
    });

    it("calls onQueryChange after debounce delay", async () => {
      const onQueryChange = mock(() => {});
      render(<SearchHeader {...defaultProps} onQueryChange={onQueryChange} />);

      const input = screen.getByRole("textbox", { name: "Search query" });
      fireEvent.change(input, { target: { value: "test query" } });

      // Should not be called immediately
      expect(onQueryChange).not.toHaveBeenCalled();

      // Wait for debounce (250ms + buffer)
      await waitFor(
        () => {
          expect(onQueryChange).toHaveBeenCalledWith("test query");
        },
        { timeout: 500 }
      );
    });

    it("does not call onQueryChange if query matches prop", async () => {
      const onQueryChange = mock(() => {});
      render(
        <SearchHeader
          {...defaultProps}
          query="same"
          onQueryChange={onQueryChange}
        />
      );

      const input = screen.getByRole("textbox", { name: "Search query" });
      // Change to same value as prop
      fireEvent.change(input, { target: { value: "same" } });

      // Wait longer than debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(onQueryChange).not.toHaveBeenCalled();
    });

    it("syncs local state when query prop changes", async () => {
      const { rerender } = render(
        <SearchHeader {...defaultProps} query="initial" />
      );

      const input: HTMLInputElement = screen.getByRole("textbox", {
        name: "Search query",
      });
      expect(input.value).toBe("initial");

      // Rerender with new query (e.g., from clear action)
      rerender(<SearchHeader {...defaultProps} query="" />);

      await waitFor(() => {
        expect(input.value).toBe("");
      });
    });
  });

  describe("mode toggle", () => {
    it("calls onModeChange with content when in files mode", () => {
      const onModeChange = mock(() => {});
      render(
        <SearchHeader {...defaultProps} mode="files" onModeChange={onModeChange} />
      );

      openMenu();
      const modeItem = screen.getByRole("menuitem", {
        name: /Switch to Content Search/i,
      });
      fireEvent.click(modeItem);

      expect(onModeChange).toHaveBeenCalledWith("content");
    });

    it("calls onModeChange with files when in content mode", () => {
      const onModeChange = mock(() => {});
      render(
        <SearchHeader {...defaultProps} mode="content" onModeChange={onModeChange} />
      );

      openMenu();
      const modeItem = screen.getByRole("menuitem", {
        name: /Switch to File Name Search/i,
      });
      fireEvent.click(modeItem);

      expect(onModeChange).toHaveBeenCalledWith("files");
    });

    it("shows Content search option when in files mode", () => {
      render(<SearchHeader {...defaultProps} mode="files" />);

      openMenu();
      const modeItem = screen.getByRole("menuitem", {
        name: /Switch to Content Search/i,
      });
      expect(modeItem).toBeDefined();
    });

    it("shows File Name search option when in content mode", () => {
      render(<SearchHeader {...defaultProps} mode="content" />);

      openMenu();
      const modeItem = screen.getByRole("menuitem", {
        name: /Switch to File Name Search/i,
      });
      expect(modeItem).toBeDefined();
    });

    it("closes menu after mode toggle", () => {
      const onModeChange = mock(() => {});
      render(
        <SearchHeader {...defaultProps} mode="files" onModeChange={onModeChange} />
      );

      openMenu();
      expect(screen.getByRole("menu")).toBeDefined();

      const modeItem = screen.getByRole("menuitem", {
        name: /Switch to Content Search/i,
      });
      fireEvent.click(modeItem);

      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  describe("close action", () => {
    it("calls onClear when Close Search is clicked", () => {
      const onClear = mock(() => {});
      render(<SearchHeader {...defaultProps} onClear={onClear} />);

      openMenu();
      const closeItem = screen.getByRole("menuitem", { name: /Close Search/i });
      fireEvent.click(closeItem);

      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it("closes menu after close action", () => {
      const onClear = mock(() => {});
      render(<SearchHeader {...defaultProps} onClear={onClear} />);

      openMenu();
      expect(screen.getByRole("menu")).toBeDefined();

      const closeItem = screen.getByRole("menuitem", { name: /Close Search/i });
      fireEvent.click(closeItem);

      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  describe("keyboard accessibility", () => {
    it("calls onClear when Escape is pressed in input (menu closed)", () => {
      const onClear = mock(() => {});
      render(<SearchHeader {...defaultProps} onClear={onClear} />);

      const input = screen.getByRole("textbox", { name: "Search query" });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it("closes menu when Escape is pressed (menu open)", () => {
      const onClear = mock(() => {});
      render(<SearchHeader {...defaultProps} onClear={onClear} />);

      openMenu();
      expect(screen.getByRole("menu")).toBeDefined();

      const input = screen.getByRole("textbox", { name: "Search query" });
      fireEvent.keyDown(input, { key: "Escape" });

      // Menu should close, but onClear should not be called
      expect(screen.queryByRole("menu")).toBeNull();
      expect(onClear).not.toHaveBeenCalled();
    });

    it("does not call onClear for other keys", () => {
      const onClear = mock(() => {});
      render(<SearchHeader {...defaultProps} onClear={onClear} />);

      const input = screen.getByRole("textbox", { name: "Search query" });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Tab" });
      fireEvent.keyDown(input, { key: "a" });

      expect(onClear).not.toHaveBeenCalled();
    });
  });

  describe("accessibility", () => {
    it("has proper aria-label on search input", () => {
      render(<SearchHeader {...defaultProps} />);

      const input = screen.getByRole("textbox", { name: "Search query" });
      expect(input.getAttribute("aria-label")).toBe("Search query");
    });

    it("has proper aria-label on menu trigger", () => {
      render(<SearchHeader {...defaultProps} mode="files" />);

      const menuTrigger = screen.getByRole("button", { name: "Search options" });
      expect(menuTrigger.getAttribute("aria-label")).toBe("Search options");
    });

    it("has aria-haspopup on menu trigger", () => {
      render(<SearchHeader {...defaultProps} />);

      const menuTrigger = screen.getByRole("button", { name: "Search options" });
      expect(menuTrigger.getAttribute("aria-haspopup")).toBe("true");
    });
  });
});

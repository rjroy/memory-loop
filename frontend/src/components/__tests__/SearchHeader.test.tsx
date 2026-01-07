/**
 * Tests for SearchHeader component
 *
 * Tests debounced input, mode toggle, clear action, and keyboard accessibility.
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

    it("renders mode toggle button", () => {
      render(<SearchHeader {...defaultProps} mode="files" />);

      const modeBtn = screen.getByRole("button", {
        name: "Switch to content search",
      });
      expect(modeBtn).toBeDefined();
      expect(modeBtn.textContent).toBe("Names");
    });

    it("renders clear button", () => {
      render(<SearchHeader {...defaultProps} />);

      const clearBtn = screen.getByRole("button", { name: "Clear search" });
      expect(clearBtn).toBeDefined();
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

      const modeBtn = screen.getByRole("button", {
        name: "Switch to content search",
      });
      fireEvent.click(modeBtn);

      expect(onModeChange).toHaveBeenCalledWith("content");
    });

    it("calls onModeChange with files when in content mode", () => {
      const onModeChange = mock(() => {});
      render(
        <SearchHeader {...defaultProps} mode="content" onModeChange={onModeChange} />
      );

      const modeBtn = screen.getByRole("button", {
        name: "Switch to files search",
      });
      fireEvent.click(modeBtn);

      expect(onModeChange).toHaveBeenCalledWith("files");
    });

    it("shows Names when in files mode", () => {
      render(<SearchHeader {...defaultProps} mode="files" />);

      const modeBtn = screen.getByRole("button", {
        name: "Switch to content search",
      });
      expect(modeBtn.textContent).toBe("Names");
    });

    it("shows Content when in content mode", () => {
      render(<SearchHeader {...defaultProps} mode="content" />);

      const modeBtn = screen.getByRole("button", {
        name: "Switch to files search",
      });
      expect(modeBtn.textContent).toBe("Content");
    });

    it("has aria-pressed=true when in content mode", () => {
      render(<SearchHeader {...defaultProps} mode="content" />);

      const modeBtn = screen.getByRole("button", {
        name: "Switch to files search",
      });
      expect(modeBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("has aria-pressed=false when in files mode", () => {
      render(<SearchHeader {...defaultProps} mode="files" />);

      const modeBtn = screen.getByRole("button", {
        name: "Switch to content search",
      });
      expect(modeBtn.getAttribute("aria-pressed")).toBe("false");
    });
  });

  describe("clear action", () => {
    it("calls onClear when clear button is clicked", () => {
      const onClear = mock(() => {});
      render(<SearchHeader {...defaultProps} onClear={onClear} />);

      const clearBtn = screen.getByRole("button", { name: "Clear search" });
      fireEvent.click(clearBtn);

      expect(onClear).toHaveBeenCalledTimes(1);
    });
  });

  describe("keyboard accessibility", () => {
    it("calls onClear when Escape is pressed in input", () => {
      const onClear = mock(() => {});
      render(<SearchHeader {...defaultProps} onClear={onClear} />);

      const input = screen.getByRole("textbox", { name: "Search query" });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(onClear).toHaveBeenCalledTimes(1);
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

    it("has proper aria-label on mode toggle", () => {
      render(<SearchHeader {...defaultProps} mode="files" />);

      const modeBtn = screen.getByRole("button", {
        name: "Switch to content search",
      });
      expect(modeBtn.getAttribute("aria-label")).toBe(
        "Switch to content search"
      );
    });

    it("has proper aria-label on clear button", () => {
      render(<SearchHeader {...defaultProps} />);

      const clearBtn = screen.getByRole("button", { name: "Clear search" });
      expect(clearBtn.getAttribute("aria-label")).toBe("Clear search");
    });
  });
});

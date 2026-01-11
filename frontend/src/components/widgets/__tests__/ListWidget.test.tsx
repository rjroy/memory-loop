/**
 * Tests for ListWidget component
 *
 * Tests list rendering, limits, and click handling.
 */

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ListWidget } from "../ListWidget";
import type { WidgetResult } from "@memory-loop/shared";

afterEach(() => {
  cleanup();
});

// Test data factory
function createWidget(
  data: unknown,
  limit?: number
): WidgetResult {
  return {
    widgetId: "test-list",
    name: "Test List",
    type: "similarity",
    location: "recall",
    display: {
      type: "list",
      limit,
    },
    data,
    isEmpty: false,
  };
}

describe("ListWidget", () => {
  describe("basic rendering", () => {
    it("renders list with string array data", () => {
      const widget = createWidget(["First", "Second", "Third"]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByRole("list")).toBeDefined();
      expect(screen.getByText("First")).toBeDefined();
      expect(screen.getByText("Second")).toBeDefined();
      expect(screen.getByText("Third")).toBeDefined();
    });

    it("renders list with object array data", () => {
      const widget = createWidget([
        { title: "Item A", subtitle: "Description A" },
        { title: "Item B", subtitle: "Description B" },
      ]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("Item A")).toBeDefined();
      expect(screen.getByText("Description A")).toBeDefined();
    });

    it("shows rank numbers", () => {
      const widget = createWidget(["First", "Second"]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("1.")).toBeDefined();
      expect(screen.getByText("2.")).toBeDefined();
    });
  });

  describe("data normalization", () => {
    it("uses name field as title", () => {
      const widget = createWidget([{ name: "Named Item" }]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("Named Item")).toBeDefined();
    });

    it("uses label field as title", () => {
      const widget = createWidget([{ label: "Labeled Item" }]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("Labeled Item")).toBeDefined();
    });

    it("prefers title over name", () => {
      const widget = createWidget([{ title: "Title", name: "Name" }]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("Title")).toBeDefined();
      expect(screen.queryByText("Name")).toBeNull();
    });

    it("filters out items without valid title", () => {
      const widget = createWidget([
        { title: "Valid" },
        { score: 100 }, // No title
        { title: "Also Valid" },
      ]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("Valid")).toBeDefined();
      expect(screen.getByText("Also Valid")).toBeDefined();
      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(2);
    });
  });

  describe("score display", () => {
    it("displays score as percentage for 0-1 range", () => {
      const widget = createWidget([{ title: "Similar", score: 0.85 }]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("85%")).toBeDefined();
    });

    it("displays score with precision for other ranges", () => {
      const widget = createWidget([{ title: "Scored", score: 42.567 }]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("42.57")).toBeDefined();
    });

    it("handles edge case 1.0 as 100%", () => {
      const widget = createWidget([{ title: "Perfect", score: 1 }]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("100%")).toBeDefined();
    });

    it("handles edge case 0 as 0%", () => {
      const widget = createWidget([{ title: "Zero", score: 0 }]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("0%")).toBeDefined();
    });
  });

  describe("limit behavior", () => {
    it("limits displayed items", () => {
      const widget = createWidget(
        ["One", "Two", "Three", "Four", "Five"],
        3
      );

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("One")).toBeDefined();
      expect(screen.getByText("Two")).toBeDefined();
      expect(screen.getByText("Three")).toBeDefined();
      expect(screen.queryByText("Four")).toBeNull();
      expect(screen.queryByText("Five")).toBeNull();
    });

    it("shows ellipsis when there are more items", () => {
      const widget = createWidget(["One", "Two", "Three", "Four"], 2);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("...")).toBeDefined();
    });

    it("does not show ellipsis when exactly at limit", () => {
      const widget = createWidget(["One", "Two"], 2);

      render(<ListWidget widget={widget} />);

      expect(screen.queryByText("...")).toBeNull();
    });

    it("does not show ellipsis when under limit", () => {
      const widget = createWidget(["One"], 5);

      render(<ListWidget widget={widget} />);

      expect(screen.queryByText("...")).toBeNull();
    });
  });

  describe("click handling", () => {
    it("renders buttons when onItemClick is provided", () => {
      const widget = createWidget([{ title: "Clickable" }]);
      const handleClick = mock(() => {});

      render(<ListWidget widget={widget} onItemClick={handleClick} />);

      const button = screen.getByRole("button", { name: "Clickable" });
      expect(button).toBeDefined();
    });

    it("calls onItemClick with item and index", () => {
      const widget = createWidget([
        { title: "First" },
        { title: "Second" },
      ]);
      let capturedItem: unknown = null;
      let capturedIndex: unknown = null;
      const handleClick = mock((item: unknown, index: unknown) => {
        capturedItem = item;
        capturedIndex = index;
      });

      render(<ListWidget widget={widget} onItemClick={handleClick} />);

      const secondButton = screen.getByRole("button", { name: "Second" });
      fireEvent.click(secondButton);

      expect(handleClick).toHaveBeenCalledTimes(1);
      expect((capturedItem as { title: string }).title).toBe("Second");
      expect(capturedIndex).toBe(1);
    });

    it("includes subtitle in aria-label", () => {
      const widget = createWidget([
        { title: "Main", subtitle: "Supporting text" },
      ]);
      const handleClick = mock(() => {});

      render(<ListWidget widget={widget} onItemClick={handleClick} />);

      expect(
        screen.getByRole("button", { name: "Main: Supporting text" })
      ).toBeDefined();
    });

    it("does not render buttons without onItemClick", () => {
      const widget = createWidget([{ title: "Not Clickable" }]);

      render(<ListWidget widget={widget} />);

      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("empty state", () => {
    it("shows empty message for empty array", () => {
      const widget = createWidget([]);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("No items")).toBeDefined();
    });

    it("shows empty message for null data", () => {
      const widget = createWidget(null);

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("No items")).toBeDefined();
    });

    it("shows empty message for non-array data", () => {
      const widget = createWidget("not an array");

      render(<ListWidget widget={widget} />);

      expect(screen.getByText("No items")).toBeDefined();
    });
  });
});

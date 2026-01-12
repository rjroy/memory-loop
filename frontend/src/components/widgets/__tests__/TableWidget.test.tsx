/**
 * Tests for TableWidget component
 *
 * Tests table rendering, sorting, and various data formats.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TableWidget } from "../TableWidget";
import type { WidgetResult } from "@memory-loop/shared";

afterEach(() => {
  cleanup();
});

// Test data factory
function createWidget(
  data: unknown,
  columns?: string[]
): WidgetResult {
  return {
    widgetId: "test-table",
    name: "Test Table",
    type: "aggregate",
    location: "ground",
    display: {
      type: "table",
      columns,
    },
    data,
    isEmpty: false,
  };
}

describe("TableWidget", () => {
  describe("basic rendering", () => {
    it("renders table with data", () => {
      const widget = createWidget([
        { name: "Game A", score: 100 },
        { name: "Game B", score: 85 },
      ]);

      render(<TableWidget widget={widget} />);

      expect(screen.getByRole("table")).toBeDefined();
      expect(screen.getByText("Game A")).toBeDefined();
      expect(screen.getByText("Game B")).toBeDefined();
    });

    it("auto-detects columns from first row", () => {
      const widget = createWidget([
        { title: "First", count: 10 },
        { title: "Second", count: 20 },
      ]);

      render(<TableWidget widget={widget} />);

      expect(screen.getByText("Title")).toBeDefined();
      expect(screen.getByText("Count")).toBeDefined();
    });

    it("uses configured columns", () => {
      const widget = createWidget(
        [
          { name: "Item", extra: "ignored", value: 42 },
        ],
        ["name", "value"]
      );

      render(<TableWidget widget={widget} />);

      expect(screen.getByText("Name")).toBeDefined();
      expect(screen.getByText("Value")).toBeDefined();
      expect(screen.queryByText("Extra")).toBeNull();
    });
  });

  describe("column name formatting", () => {
    it("formats snake_case to Title Case", () => {
      const widget = createWidget([{ play_count: 5 }]);

      render(<TableWidget widget={widget} />);

      expect(screen.getByText("Play Count")).toBeDefined();
    });

    it("formats camelCase to Title Case", () => {
      const widget = createWidget([{ playCount: 5 }]);

      render(<TableWidget widget={widget} />);

      expect(screen.getByText("Play Count")).toBeDefined();
    });
  });

  describe("value formatting", () => {
    it("formats numbers with locale separators", () => {
      const widget = createWidget([{ value: 1234567 }]);

      render(<TableWidget widget={widget} />);

      expect(screen.getByText(/1.*234.*567/)).toBeDefined();
    });

    it("formats decimal numbers with limited precision", () => {
      const widget = createWidget([{ value: 3.14159 }]);

      render(<TableWidget widget={widget} />);

      expect(screen.getByText(/3\.14/)).toBeDefined();
    });

    it("displays dash for null values", () => {
      const widget = createWidget([{ value: null }]);

      render(<TableWidget widget={widget} />);

      expect(screen.getByText("—")).toBeDefined();
    });

    it("joins arrays with commas", () => {
      const widget = createWidget([{ tags: ["one", "two", "three"] }]);

      render(<TableWidget widget={widget} />);

      expect(screen.getByText("one, two, three")).toBeDefined();
    });
  });

  describe("sorting", () => {
    it("sorts ascending on first click", () => {
      const widget = createWidget([
        { name: "Banana", score: 2 },
        { name: "Apple", score: 1 },
        { name: "Cherry", score: 3 },
      ]);

      render(<TableWidget widget={widget} />);

      const nameHeader = screen.getByLabelText("Sort by name");
      fireEvent.click(nameHeader);

      const cells = screen.getAllByRole("cell");
      const names = cells.filter((_, i) => i % 2 === 0).map((c) => c.textContent);
      expect(names).toEqual(["Apple", "Banana", "Cherry"]);
    });

    it("sorts descending on second click", () => {
      const widget = createWidget([
        { name: "Banana", score: 2 },
        { name: "Apple", score: 1 },
      ]);

      render(<TableWidget widget={widget} />);

      const nameHeader = screen.getByLabelText("Sort by name");
      fireEvent.click(nameHeader);
      fireEvent.click(nameHeader);

      const cells = screen.getAllByRole("cell");
      expect(cells[0].textContent).toBe("Banana");
    });

    it("clears sort on third click", () => {
      const widget = createWidget([
        { name: "B", score: 2 },
        { name: "A", score: 1 },
      ]);

      render(<TableWidget widget={widget} />);

      const nameHeader = screen.getByLabelText("Sort by name");
      fireEvent.click(nameHeader); // asc
      fireEvent.click(nameHeader); // desc
      fireEvent.click(nameHeader); // clear

      // Back to original order
      const cells = screen.getAllByRole("cell");
      expect(cells[0].textContent).toBe("B");
    });

    it("sorts numbers numerically", () => {
      const widget = createWidget([
        { name: "A", score: 100 },
        { name: "B", score: 20 },
        { name: "C", score: 3 },
      ]);

      render(<TableWidget widget={widget} />);

      const scoreHeader = screen.getByLabelText("Sort by score");
      fireEvent.click(scoreHeader);

      const cells = screen.getAllByRole("cell");
      const scores = cells.filter((_, i) => i % 2 === 1).map((c) => c.textContent);
      expect(scores).toEqual(["3", "20", "100"]);
    });

    it("handles null values in sort", () => {
      const widget = createWidget([
        { name: "A", score: null },
        { name: "B", score: 50 },
        { name: "C", score: 100 },
      ]);

      render(<TableWidget widget={widget} />);

      const scoreHeader = screen.getByLabelText("Sort by score");
      fireEvent.click(scoreHeader);

      // Nulls should sort to end for ascending
      const cells = screen.getAllByRole("cell");
      const names = cells.filter((_, i) => i % 2 === 0).map((c) => c.textContent);
      expect(names).toEqual(["B", "C", "A"]);
    });

    it("shows sort indicator", () => {
      const widget = createWidget([{ name: "Test", score: 1 }]);

      render(<TableWidget widget={widget} />);

      const nameHeader = screen.getByLabelText("Sort by name");
      fireEvent.click(nameHeader);

      expect(screen.getByText("↑")).toBeDefined();

      fireEvent.click(nameHeader);
      expect(screen.getByText("↓")).toBeDefined();
    });

    it("has aria-sort attribute", () => {
      const widget = createWidget([{ name: "Test" }]);

      render(<TableWidget widget={widget} />);

      const nameHeader = screen.getByLabelText("Sort by name");
      const th = nameHeader.closest("th");

      fireEvent.click(nameHeader);
      expect(th?.getAttribute("aria-sort")).toBe("ascending");

      fireEvent.click(nameHeader);
      expect(th?.getAttribute("aria-sort")).toBe("descending");
    });
  });

  describe("empty state", () => {
    it("shows empty message for empty array", () => {
      const widget = createWidget([]);

      render(<TableWidget widget={widget} />);

      expect(screen.getByText("No table data")).toBeDefined();
    });

    it("shows empty message for null data", () => {
      const widget = createWidget(null);

      render(<TableWidget widget={widget} />);

      expect(screen.getByText("No table data")).toBeDefined();
    });
  });
});

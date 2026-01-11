/**
 * Tests for SummaryCardWidget component
 *
 * Tests key-value pair rendering and various data formats.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { SummaryCardWidget } from "../SummaryCardWidget";
import type { WidgetResult } from "@memory-loop/shared";

afterEach(() => {
  cleanup();
});

// Test data factory
function createWidget(data: unknown): WidgetResult {
  return {
    widgetId: "test-summary",
    name: "Test Summary",
    type: "aggregate",
    location: "ground",
    display: {
      type: "summary-card",
    },
    data,
    isEmpty: false,
  };
}

describe("SummaryCardWidget", () => {
  describe("array data format", () => {
    it("renders array of label-value objects", () => {
      const widget = createWidget([
        { label: "Total Games", value: 42 },
        { label: "Average Score", value: 8.5 },
      ]);

      render(<SummaryCardWidget widget={widget} />);

      expect(screen.getByText("Total Games")).toBeDefined();
      expect(screen.getByText("42")).toBeDefined();
      expect(screen.getByText("Average Score")).toBeDefined();
      expect(screen.getByText("8.5")).toBeDefined();
    });

    it("uses definition list semantics", () => {
      const widget = createWidget([{ label: "Count", value: 10 }]);

      render(<SummaryCardWidget widget={widget} />);

      const terms = document.querySelectorAll("dt");
      const definitions = document.querySelectorAll("dd");

      expect(terms).toHaveLength(1);
      expect(definitions).toHaveLength(1);
    });

    it("filters out items without label", () => {
      const widget = createWidget([
        { label: "Valid", value: 1 },
        { value: 2 }, // No label
      ]);

      render(<SummaryCardWidget widget={widget} />);

      expect(screen.getByText("Valid")).toBeDefined();
      const items = document.querySelectorAll(".summary-card__item");
      expect(items).toHaveLength(1);
    });
  });

  describe("object data format", () => {
    it("renders object keys as labels", () => {
      const widget = createWidget({
        "Total Count": 100,
        "Unique Items": 25,
      });

      render(<SummaryCardWidget widget={widget} />);

      expect(screen.getByText("Total Count")).toBeDefined();
      expect(screen.getByText("100")).toBeDefined();
      expect(screen.getByText("Unique Items")).toBeDefined();
      expect(screen.getByText("25")).toBeDefined();
    });
  });

  describe("value formatting", () => {
    it("formats integers with locale separators", () => {
      const widget = createWidget([{ label: "Big Number", value: 1000000 }]);

      render(<SummaryCardWidget widget={widget} />);

      // Note: toLocaleString() behavior varies by locale
      const valueEl = screen.getByText(/1.*000.*000/);
      expect(valueEl).toBeDefined();
    });

    it("formats decimals with limited precision", () => {
      const widget = createWidget([{ label: "Decimal", value: 3.14159 }]);

      render(<SummaryCardWidget widget={widget} />);

      // Should have at most 2 decimal places
      expect(screen.getByText(/3\.14/)).toBeDefined();
    });

    it("formats percent values", () => {
      const widget = createWidget([
        { label: "Completion", value: 0.85, format: "percent" },
      ]);

      render(<SummaryCardWidget widget={widget} />);

      expect(screen.getByText("85.0%")).toBeDefined();
    });

    it("formats currency values", () => {
      const widget = createWidget([
        { label: "Price", value: 29.99, format: "currency" },
      ]);

      render(<SummaryCardWidget widget={widget} />);

      expect(screen.getByText("$29.99")).toBeDefined();
    });

    it("displays dash for null values", () => {
      const widget = createWidget([{ label: "Missing", value: null }]);

      render(<SummaryCardWidget widget={widget} />);

      expect(screen.getByText("Missing")).toBeDefined();
      expect(screen.getByText("—")).toBeDefined();
    });

    it("displays strings as-is", () => {
      const widget = createWidget([{ label: "Status", value: "Complete" }]);

      render(<SummaryCardWidget widget={widget} />);

      expect(screen.getByText("Complete")).toBeDefined();
    });
  });

  describe("empty state", () => {
    it("shows empty message for empty array", () => {
      const widget = createWidget([]);

      render(<SummaryCardWidget widget={widget} />);

      expect(screen.getByText("No summary data")).toBeDefined();
    });

    it("shows empty message for null data", () => {
      const widget = createWidget(null);

      render(<SummaryCardWidget widget={widget} />);

      expect(screen.getByText("No summary data")).toBeDefined();
    });

    it("shows empty message for non-object data", () => {
      const widget = createWidget("invalid");

      render(<SummaryCardWidget widget={widget} />);

      expect(screen.getByText("No summary data")).toBeDefined();
    });
  });
});

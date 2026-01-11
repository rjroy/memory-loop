/**
 * Tests for WidgetRenderer component
 *
 * Tests rendering, empty states, and dispatch to type-specific components.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { WidgetRenderer } from "../WidgetRenderer";
import type { WidgetResult } from "@memory-loop/shared";

afterEach(() => {
  cleanup();
});

// Test data factories
function createWidget(overrides: Partial<WidgetResult> = {}): WidgetResult {
  return {
    widgetId: "test-widget",
    name: "Test Widget",
    type: "aggregate",
    location: "ground",
    display: {
      type: "summary-card",
    },
    data: [],
    isEmpty: false,
    ...overrides,
  };
}

describe("WidgetRenderer", () => {
  describe("empty state", () => {
    it("renders empty state with default message", () => {
      const widget = createWidget({
        isEmpty: true,
      });

      render(<WidgetRenderer widget={widget} />);

      expect(screen.getByText("No data available")).toBeDefined();
    });

    it("renders empty state with custom reason", () => {
      const widget = createWidget({
        isEmpty: true,
        emptyReason: "No files match pattern **/*.md",
      });

      render(<WidgetRenderer widget={widget} />);

      expect(screen.getByText("No files match pattern **/*.md")).toBeDefined();
    });

    it("applies empty modifier class", () => {
      const widget = createWidget({
        isEmpty: true,
      });

      const { container } = render(<WidgetRenderer widget={widget} />);

      expect(container.querySelector(".widget--empty")).toBeDefined();
    });

    it("has accessible label for empty widget", () => {
      const widget = createWidget({
        name: "Game Stats",
        isEmpty: true,
      });

      render(<WidgetRenderer widget={widget} />);

      expect(
        screen.getByRole("article", { name: "Game Stats widget (empty)" })
      ).toBeDefined();
    });
  });

  describe("header rendering", () => {
    it("uses widget name as default title", () => {
      const widget = createWidget({
        name: "My Widget",
        display: {
          type: "summary-card",
        },
      });

      render(<WidgetRenderer widget={widget} />);

      expect(screen.getByText("My Widget")).toBeDefined();
    });

    it("uses custom title from display config", () => {
      const widget = createWidget({
        name: "Internal Name",
        display: {
          type: "summary-card",
          title: "Custom Display Title",
        },
      });

      render(<WidgetRenderer widget={widget} />);

      expect(screen.getByText("Custom Display Title")).toBeDefined();
      expect(screen.queryByText("Internal Name")).toBeNull();
    });
  });

  describe("display type dispatch", () => {
    it("dispatches to SummaryCardWidget for summary-card type", () => {
      const widget = createWidget({
        display: {
          type: "summary-card",
        },
        data: [{ label: "Count", value: 42 }],
      });

      render(<WidgetRenderer widget={widget} />);

      expect(screen.getByText("Count")).toBeDefined();
      expect(screen.getByText("42")).toBeDefined();
    });

    it("dispatches to TableWidget for table type", () => {
      const widget = createWidget({
        display: {
          type: "table",
          columns: ["Name", "Score"],
        },
        data: [{ Name: "Item 1", Score: 100 }],
      });

      render(<WidgetRenderer widget={widget} />);

      expect(screen.getByRole("table")).toBeDefined();
      expect(screen.getByText("Item 1")).toBeDefined();
    });

    it("dispatches to ListWidget for list type", () => {
      const widget = createWidget({
        display: {
          type: "list",
          limit: 5,
        },
        data: [{ title: "First Item" }, { title: "Second Item" }],
      });

      render(<WidgetRenderer widget={widget} />);

      expect(screen.getByRole("list")).toBeDefined();
      expect(screen.getByText("First Item")).toBeDefined();
    });

    it("dispatches to MeterWidget for meter type", () => {
      const widget = createWidget({
        display: {
          type: "meter",
          min: 0,
          max: 100,
        },
        data: { value: 75 },
      });

      render(<WidgetRenderer widget={widget} />);

      expect(screen.getByRole("meter")).toBeDefined();
      expect(screen.getByText("75")).toBeDefined();
    });
  });

  describe("accessibility", () => {
    it("has accessible article role", () => {
      const widget = createWidget({
        name: "Stats Widget",
      });

      render(<WidgetRenderer widget={widget} />);

      expect(
        screen.getByRole("article", { name: "Stats Widget widget" })
      ).toBeDefined();
    });

    it("applies display type as class modifier", () => {
      const widget = createWidget({
        display: {
          type: "table",
        },
        data: [],
      });

      const { container } = render(<WidgetRenderer widget={widget} />);

      expect(container.querySelector(".widget--table")).toBeDefined();
    });
  });

  describe("className prop", () => {
    it("appends custom className", () => {
      const widget = createWidget();

      const { container } = render(
        <WidgetRenderer widget={widget} className="my-custom-class" />
      );

      expect(container.querySelector(".my-custom-class")).toBeDefined();
    });

    it("trims whitespace with no custom className", () => {
      const widget = createWidget();

      const { container } = render(<WidgetRenderer widget={widget} />);

      const article = container.querySelector("article");
      expect(article?.className).not.toContain("  ");
    });
  });
});

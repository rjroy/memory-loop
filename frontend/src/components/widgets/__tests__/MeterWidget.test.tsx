/**
 * Tests for MeterWidget component
 *
 * Tests meter rendering, color states, and value formatting.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { MeterWidget } from "../MeterWidget";
import type { WidgetResult } from "@memory-loop/shared";

afterEach(() => {
  cleanup();
});

// Test data factory
function createWidget(
  data: unknown,
  min?: number,
  max?: number
): WidgetResult {
  return {
    widgetId: "test-meter",
    name: "Test Meter",
    type: "aggregate",
    location: "ground",
    display: {
      type: "meter",
      min,
      max,
    },
    data,
    isEmpty: false,
  };
}

describe("MeterWidget", () => {
  describe("basic rendering", () => {
    it("renders meter with numeric value", () => {
      const widget = createWidget(75, 0, 100);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByRole("meter")).toBeDefined();
      expect(screen.getByText("75")).toBeDefined();
    });

    it("renders min and max values", () => {
      const widget = createWidget(50, 0, 100);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText("0")).toBeDefined();
      expect(screen.getByText("100")).toBeDefined();
    });

    it("displays label from data object", () => {
      const widget = createWidget({ value: 85, label: "points" }, 0, 100);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText("85")).toBeDefined();
      expect(screen.getByText("points")).toBeDefined();
    });
  });

  describe("data extraction", () => {
    it("handles direct number", () => {
      const widget = createWidget(42, 0, 100);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText("42")).toBeDefined();
    });

    it("extracts value from object", () => {
      const widget = createWidget({ value: 65 }, 0, 100);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText("65")).toBeDefined();
    });

    it("extracts score as value", () => {
      const widget = createWidget({ score: 88 }, 0, 100);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText("88")).toBeDefined();
    });

    it("extracts total as value", () => {
      const widget = createWidget({ total: 200 }, 0, 500);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText("200")).toBeDefined();
    });

    it("defaults to 0 for invalid data", () => {
      const widget = createWidget(null, 0, 100);

      const { container } = render(<MeterWidget widget={widget} />);

      const valueEl = container.querySelector(".meter-widget__value");
      expect(valueEl?.textContent).toBe("0");
    });
  });

  describe("value formatting", () => {
    it("formats integers without decimals", () => {
      const widget = createWidget(42, 0, 100);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText("42")).toBeDefined();
    });

    it("formats decimals with one digit", () => {
      const widget = createWidget(42.567, 0, 100);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText("42.6")).toBeDefined();
    });

    it("formats large numbers with separators", () => {
      const widget = createWidget(1234567, 0, 2000000);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText(/1.*234.*567/)).toBeDefined();
    });
  });

  describe("default min/max", () => {
    it("uses 0 as default min", () => {
      const widget = createWidget(50, undefined, 100);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText("0")).toBeDefined();
    });

    it("uses 100 as default max", () => {
      const widget = createWidget(50, 0, undefined);

      render(<MeterWidget widget={widget} />);

      expect(screen.getByText("100")).toBeDefined();
    });
  });

  describe("fill percentage", () => {
    it("calculates correct fill percentage", () => {
      const widget = createWidget(50, 0, 100);

      const { container } = render(<MeterWidget widget={widget} />);

      const fill = container.querySelector(".meter-widget__fill") as HTMLElement;
      expect(fill?.style.width).toBe("50%");
    });

    it("handles non-zero min", () => {
      const widget = createWidget(75, 50, 100);

      const { container } = render(<MeterWidget widget={widget} />);

      const fill = container.querySelector(".meter-widget__fill") as HTMLElement;
      // 75 is 50% between 50 and 100
      expect(fill?.style.width).toBe("50%");
    });

    it("clamps percentage to 0-100", () => {
      const widget = createWidget(150, 0, 100); // Over max

      const { container } = render(<MeterWidget widget={widget} />);

      const fill = container.querySelector(".meter-widget__fill") as HTMLElement;
      expect(fill?.style.width).toBe("100%");
    });

    it("clamps negative percentage to 0", () => {
      const widget = createWidget(-10, 0, 100); // Under min

      const { container } = render(<MeterWidget widget={widget} />);

      const fill = container.querySelector(".meter-widget__fill") as HTMLElement;
      expect(fill?.style.width).toBe("0%");
    });
  });

  describe("color classes", () => {
    it("applies high color for >= 80%", () => {
      const widget = createWidget(85, 0, 100);

      const { container } = render(<MeterWidget widget={widget} />);

      const fill = container.querySelector(".meter-widget__fill--high");
      expect(fill).toBeDefined();
    });

    it("applies medium color for >= 50%", () => {
      const widget = createWidget(60, 0, 100);

      const { container } = render(<MeterWidget widget={widget} />);

      const fill = container.querySelector(".meter-widget__fill--medium");
      expect(fill).toBeDefined();
    });

    it("applies low color for >= 25%", () => {
      const widget = createWidget(30, 0, 100);

      const { container } = render(<MeterWidget widget={widget} />);

      const fill = container.querySelector(".meter-widget__fill--low");
      expect(fill).toBeDefined();
    });

    it("applies critical color for < 25%", () => {
      const widget = createWidget(10, 0, 100);

      const { container } = render(<MeterWidget widget={widget} />);

      const fill = container.querySelector(".meter-widget__fill--critical");
      expect(fill).toBeDefined();
    });
  });

  describe("accessibility", () => {
    it("has meter role with aria attributes", () => {
      const widget = createWidget(75, 0, 100);

      render(<MeterWidget widget={widget} />);

      const meter = screen.getByRole("meter");
      expect(meter.getAttribute("aria-valuenow")).toBe("75");
      expect(meter.getAttribute("aria-valuemin")).toBe("0");
      expect(meter.getAttribute("aria-valuemax")).toBe("100");
    });

    it("hides fill bar from screen readers", () => {
      const widget = createWidget(50, 0, 100);

      const { container } = render(<MeterWidget widget={widget} />);

      const fill = container.querySelector(".meter-widget__fill");
      expect(fill?.getAttribute("aria-hidden")).toBe("true");
    });
  });
});

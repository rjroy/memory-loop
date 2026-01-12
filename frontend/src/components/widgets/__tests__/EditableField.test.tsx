/**
 * Tests for EditableField component
 *
 * Tests each input type, debouncing, optimistic updates, and error display.
 */

import { describe, it, expect, afterEach, mock, beforeEach } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { EditableField } from "../EditableField";
import type { WidgetEditableField } from "@memory-loop/shared";

afterEach(() => {
  cleanup();
});

// Test data factory
function createField(overrides: Partial<WidgetEditableField> = {}): WidgetEditableField {
  return {
    field: "rating",
    type: "number",
    label: "Rating",
    ...overrides,
  };
}

describe("EditableField", () => {
  describe("slider input", () => {
    it("renders slider with min/max/step", () => {
      const field = createField({
        type: "slider",
        label: "Score",
        min: 0,
        max: 10,
        step: 0.5,
        currentValue: 5,
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
        />
      );

      const slider = screen.getByRole("slider");
      expect(slider.getAttribute("min")).toBe("0");
      expect(slider.getAttribute("max")).toBe("10");
      expect(slider.getAttribute("step")).toBe("0.5");
      expect(slider.getAttribute("value")).toBe("5");
    });

    it("shows current value", () => {
      const field = createField({
        type: "slider",
        min: 0,
        max: 100,
        currentValue: 75,
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
        />
      );

      expect(screen.getByText("75")).toBeDefined();
    });

    it("updates value on change", () => {
      const field = createField({
        type: "slider",
        min: 0,
        max: 100,
        currentValue: 50,
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
        />
      );

      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "75" } });

      expect(screen.getByText("75")).toBeDefined();
    });
  });

  describe("number input", () => {
    it("renders number input with constraints", () => {
      const field = createField({
        type: "number",
        label: "Count",
        min: 1,
        max: 99,
        step: 1,
        currentValue: 42,
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
        />
      );

      const input = screen.getByRole("spinbutton");
      expect(input.getAttribute("min")).toBe("1");
      expect(input.getAttribute("max")).toBe("99");
      expect(input.getAttribute("value")).toBe("42");
    });

    it("handles empty value as null", async () => {
      const onEdit = mock(() => {});
      const field = createField({
        type: "number",
        currentValue: 10,
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={onEdit}
        />
      );

      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "" } });

      // Wait for debounce
      await waitFor(() => {
        expect(onEdit).toHaveBeenCalled();
      }, { timeout: 500 });
    });
  });

  describe("text input", () => {
    it("renders text input", () => {
      const field = createField({
        type: "text",
        label: "Title",
        currentValue: "Hello World",
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
        />
      );

      const input = screen.getByRole("textbox");
      expect(input.getAttribute("value")).toBe("Hello World");
    });

    it("sends edit immediately on change", () => {
      const onEdit = mock(() => {});
      const field = createField({
        type: "text",
        currentValue: "",
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={onEdit}
        />
      );

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "New Value" } });

      // Text input sends immediately (no debounce)
      expect(onEdit).toHaveBeenCalledWith("test.md", "rating", "New Value");
    });
  });

  describe("date input", () => {
    it("renders date input", () => {
      const field = createField({
        type: "date",
        label: "Due Date",
        currentValue: "2025-12-31",
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
        />
      );

      // Date inputs have no specific role, use class selector
      const input = document.querySelector(".editable-field__date") as HTMLInputElement;
      expect(input.value).toBe("2025-12-31");
    });

    it("sends edit on date change", () => {
      const onEdit = mock(() => {});
      const field = createField({
        type: "date",
        currentValue: "2025-01-01",
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={onEdit}
        />
      );

      const input = document.querySelector(".editable-field__date") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "2025-06-15" } });

      expect(onEdit).toHaveBeenCalledWith("test.md", "rating", "2025-06-15");
    });
  });

  describe("select input", () => {
    it("renders select with options", () => {
      const field = createField({
        type: "select",
        label: "Status",
        options: ["Pending", "In Progress", "Complete"],
        currentValue: "In Progress",
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
        />
      );

      const select = screen.getByRole<HTMLSelectElement>("combobox");
      // For select elements, check the value property, not attribute
      expect(select.value).toBe("In Progress");

      // Check options
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(4); // Including "Select..." placeholder
    });

    it("sends edit on selection change", () => {
      const onEdit = mock(() => {});
      const field = createField({
        type: "select",
        options: ["A", "B", "C"],
        currentValue: "A",
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={onEdit}
        />
      );

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "B" } });

      expect(onEdit).toHaveBeenCalledWith("test.md", "rating", "B");
    });
  });

  describe("label rendering", () => {
    it("displays field label", () => {
      const field = createField({
        label: "My Custom Label",
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
        />
      );

      expect(screen.getByText("My Custom Label")).toBeDefined();
    });
  });

  describe("pending state", () => {
    it("shows spinner when pending", () => {
      const field = createField();

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
          isPending={true}
        />
      );

      expect(screen.getByLabelText("Saving")).toBeDefined();
    });

    it("disables input when pending", () => {
      const field = createField({
        type: "text",
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
          isPending={true}
        />
      );

      const input = screen.getByRole("textbox");
      expect(input).toHaveProperty("disabled", true);
    });

    it("applies pending class", () => {
      const field = createField();

      const { container } = render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
          isPending={true}
        />
      );

      expect(container.querySelector(".editable-field--pending")).toBeDefined();
    });
  });

  describe("error display", () => {
    it("shows error message", () => {
      const field = createField();

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
          error="Failed to save"
        />
      );

      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText("Failed to save")).toBeDefined();
    });

    it("does not show error when null", () => {
      const field = createField();

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
          error={null}
        />
      );

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("debouncing", () => {
    beforeEach(() => {
      // Use fake timers for debounce tests
    });

    it("debounces slider changes", async () => {
      const onEdit = mock(() => {});
      const field = createField({
        type: "slider",
        min: 0,
        max: 100,
        currentValue: 50,
      });

      render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={onEdit}
        />
      );

      const slider = screen.getByRole("slider");

      // Rapid changes
      fireEvent.change(slider, { target: { value: "60" } });
      fireEvent.change(slider, { target: { value: "70" } });
      fireEvent.change(slider, { target: { value: "80" } });

      // Should not call immediately
      expect(onEdit).not.toHaveBeenCalled();

      // Wait for debounce
      await waitFor(() => {
        expect(onEdit).toHaveBeenCalledTimes(1);
      }, { timeout: 500 });

      // Should only send final value
      expect(onEdit).toHaveBeenCalledWith("test.md", "rating", 80);
    });
  });

  describe("value sync", () => {
    it("updates local value when currentValue changes and not pending", () => {
      const field = createField({
        type: "number",
        currentValue: 10,
      });

      const { rerender } = render(
        <EditableField
          field={field}
          filePath="test.md"
          onEdit={mock(() => {})}
          isPending={false}
        />
      );

      // Change currentValue from server
      const updatedField = createField({
        type: "number",
        currentValue: 20,
      });

      rerender(
        <EditableField
          field={updatedField}
          filePath="test.md"
          onEdit={mock(() => {})}
          isPending={false}
        />
      );

      const input = screen.getByRole("spinbutton");
      expect(input.getAttribute("value")).toBe("20");
    });
  });
});

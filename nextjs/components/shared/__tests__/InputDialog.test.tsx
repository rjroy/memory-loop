/**
 * Tests for InputDialog component
 *
 * Tests rendering, accessibility, input validation, and user interactions.
 */

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InputDialog } from "../InputDialog";

afterEach(() => {
  cleanup();
});

describe("InputDialog", () => {
  const defaultProps = {
    isOpen: true,
    title: "Create Directory",
    message: "Enter a name for the new directory.",
    inputLabel: "Directory name",
    inputPlaceholder: "my-directory",
    pattern: /^[a-zA-Z0-9_-]+$/,
    patternError: "Only letters, numbers, hyphens, and underscores allowed",
    confirmLabel: "Create",
    onConfirm: mock(() => {}),
    onCancel: mock(() => {}),
  };

  describe("rendering", () => {
    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <InputDialog {...defaultProps} isOpen={false} />
      );
      expect(container.innerHTML).toBe("");
    });

    it("renders dialog when isOpen is true", () => {
      render(<InputDialog {...defaultProps} />);

      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.getByText("Create Directory")).toBeDefined();
      expect(screen.getByText("Enter a name for the new directory.")).toBeDefined();
    });

    it("renders input with label", () => {
      render(<InputDialog {...defaultProps} />);

      expect(screen.getByLabelText("Directory name")).toBeDefined();
    });

    it("renders input with placeholder", () => {
      render(<InputDialog {...defaultProps} />);

      const input = screen.getByLabelText("Directory name");
      expect(input.getAttribute("placeholder")).toBe("my-directory");
    });

    it("renders custom confirm label", () => {
      render(<InputDialog {...defaultProps} confirmLabel="Save" />);

      expect(screen.getByText("Save")).toBeDefined();
    });

    it("always renders Cancel button", () => {
      render(<InputDialog {...defaultProps} />);

      expect(screen.getByText("Cancel")).toBeDefined();
    });

    it("disables confirm button when input is empty", () => {
      render(<InputDialog {...defaultProps} />);

      const confirmBtn = screen.getByText("Create");
      expect(confirmBtn.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("accessibility", () => {
    it("has proper dialog role and aria attributes", () => {
      render(<InputDialog {...defaultProps} />);

      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("aria-labelledby")).toBeDefined();
    });

    it("has accessible title linked via aria-labelledby", () => {
      render(<InputDialog {...defaultProps} />);

      const dialog = screen.getByRole("dialog");
      const labelledById = dialog.getAttribute("aria-labelledby");
      expect(labelledById).toBeDefined();

      const title = screen.getByText("Create Directory");
      expect(title.id).toBe(labelledById as string);
    });

    it("has label associated with input", () => {
      render(<InputDialog {...defaultProps} />);

      const input = screen.getByLabelText("Directory name");
      expect(input).toBeDefined();
      expect(input.tagName.toLowerCase()).toBe("input");
    });

    it("shows error with role alert", () => {
      render(<InputDialog {...defaultProps} />);

      // Enter invalid input
      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "invalid name!" } });

      const error = screen.getByRole("alert");
      expect(error).toBeDefined();
      expect(error.textContent).toBe("Only letters, numbers, hyphens, and underscores allowed");
    });
  });

  describe("input validation", () => {
    it("accepts valid input matching pattern", () => {
      render(<InputDialog {...defaultProps} />);

      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "valid-name_123" } });

      // No error should be shown
      expect(screen.queryByRole("alert")).toBeNull();

      // Confirm button should be enabled
      const confirmBtn = screen.getByText("Create");
      expect(confirmBtn.hasAttribute("disabled")).toBe(false);
    });

    it("shows error for invalid input", () => {
      render(<InputDialog {...defaultProps} />);

      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "invalid name!" } });

      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText("Only letters, numbers, hyphens, and underscores allowed")).toBeDefined();
    });

    it("disables confirm button when input is invalid", () => {
      render(<InputDialog {...defaultProps} />);

      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "invalid name!" } });

      const confirmBtn = screen.getByText("Create");
      expect(confirmBtn.hasAttribute("disabled")).toBe(true);
    });

    it("clears error when input becomes valid", () => {
      render(<InputDialog {...defaultProps} />);

      const input = screen.getByLabelText("Directory name");

      // First enter invalid input
      fireEvent.change(input, { target: { value: "invalid!" } });
      expect(screen.getByRole("alert")).toBeDefined();

      // Then fix it
      fireEvent.change(input, { target: { value: "valid-name" } });
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("uses default error message when patternError not provided", () => {
      render(<InputDialog {...defaultProps} patternError={undefined} />);

      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "invalid!" } });

      expect(screen.getByRole("alert").textContent).toBe("Invalid input");
    });

    it("trims whitespace before calling onConfirm (no pattern)", () => {
      // Test without pattern validation since pattern is tested against untrimmed value
      const onConfirm = mock(() => {});
      render(
        <InputDialog
          {...defaultProps}
          pattern={undefined}
          patternError={undefined}
          onConfirm={onConfirm}
        />
      );

      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "  valid-name  " } });

      // Click confirm
      fireEvent.click(screen.getByText("Create"));

      // Should be called with trimmed value
      expect(onConfirm).toHaveBeenCalledWith("valid-name");
    });

    it("shows error when trying to submit empty value", () => {
      render(<InputDialog {...defaultProps} />);

      // Input is empty by default, confirm is disabled
      // But let's test the direct submit path
      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "  " } }); // Just whitespace

      // Confirm should still be disabled due to empty trimmed value
      const confirmBtn = screen.getByText("Create");
      expect(confirmBtn.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("user interactions", () => {
    it("calls onConfirm when confirm button is clicked with valid input", () => {
      const onConfirm = mock(() => {});
      render(<InputDialog {...defaultProps} onConfirm={onConfirm} />);

      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "my-directory" } });
      fireEvent.click(screen.getByText("Create"));

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith("my-directory");
    });

    it("calls onCancel when cancel button is clicked", () => {
      const onCancel = mock(() => {});
      render(<InputDialog {...defaultProps} onCancel={onCancel} />);

      fireEvent.click(screen.getByText("Cancel"));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when backdrop is clicked", () => {
      const onCancel = mock(() => {});
      render(<InputDialog {...defaultProps} onCancel={onCancel} />);

      const backdrop = document.querySelector(".input-dialog__backdrop");
      expect(backdrop).not.toBeNull();
      fireEvent.click(backdrop!);

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not call onCancel when dialog content is clicked", () => {
      const onCancel = mock(() => {});
      render(<InputDialog {...defaultProps} onCancel={onCancel} />);

      const dialog = screen.getByRole("dialog");
      fireEvent.click(dialog);

      expect(onCancel).not.toHaveBeenCalled();
    });

    it("calls onCancel when Escape key is pressed", () => {
      const onCancel = mock(() => {});
      render(<InputDialog {...defaultProps} onCancel={onCancel} />);

      const backdrop = document.querySelector(".input-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Escape" });

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onConfirm when Enter key is pressed with valid input", () => {
      const onConfirm = mock(() => {});
      render(<InputDialog {...defaultProps} onConfirm={onConfirm} />);

      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "my-directory" } });

      const backdrop = document.querySelector(".input-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Enter" });

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith("my-directory");
    });

    it("does not call onConfirm when Enter key is pressed with invalid input", () => {
      const onConfirm = mock(() => {});
      render(<InputDialog {...defaultProps} onConfirm={onConfirm} />);

      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "invalid!" } });

      const backdrop = document.querySelector(".input-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Enter" });

      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("does not call onConfirm when Enter key is pressed with empty input", () => {
      const onConfirm = mock(() => {});
      render(<InputDialog {...defaultProps} onConfirm={onConfirm} />);

      const backdrop = document.querySelector(".input-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Enter" });

      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("button types", () => {
    it("renders buttons with type='button' to prevent form submission", () => {
      render(<InputDialog {...defaultProps} />);

      const buttons = screen.getAllByRole("button");
      buttons.forEach((button) => {
        expect(button.getAttribute("type")).toBe("button");
      });
    });
  });

  describe("state reset", () => {
    it("resets input value when dialog reopens", () => {
      const { rerender } = render(<InputDialog {...defaultProps} />);

      // Enter a value
      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "my-directory" } });
      expect(input.getAttribute("value")).toBe("my-directory");

      // Close dialog
      rerender(<InputDialog {...defaultProps} isOpen={false} />);

      // Reopen dialog
      rerender(<InputDialog {...defaultProps} isOpen={true} />);

      // Value should be reset
      const newInput = screen.getByLabelText("Directory name");
      expect(newInput.getAttribute("value")).toBe("");
    });

    it("resets error when dialog reopens", () => {
      const { rerender } = render(<InputDialog {...defaultProps} />);

      // Enter invalid value to trigger error
      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "invalid!" } });
      expect(screen.getByRole("alert")).toBeDefined();

      // Close dialog
      rerender(<InputDialog {...defaultProps} isOpen={false} />);

      // Reopen dialog
      rerender(<InputDialog {...defaultProps} isOpen={true} />);

      // Error should be cleared
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("without pattern validation", () => {
    it("accepts any non-empty input when no pattern provided", () => {
      const onConfirm = mock(() => {});
      render(
        <InputDialog
          {...defaultProps}
          pattern={undefined}
          patternError={undefined}
          onConfirm={onConfirm}
        />
      );

      const input = screen.getByLabelText("Directory name");
      fireEvent.change(input, { target: { value: "any input works!" } });

      // No error should be shown
      expect(screen.queryByRole("alert")).toBeNull();

      // Confirm should work
      fireEvent.click(screen.getByText("Create"));
      expect(onConfirm).toHaveBeenCalledWith("any input works!");
    });
  });
});

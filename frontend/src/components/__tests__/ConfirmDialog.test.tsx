/**
 * Tests for ConfirmDialog component
 *
 * Tests rendering, accessibility, and user interactions.
 */

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConfirmDialog } from "../ConfirmDialog";

afterEach(() => {
  cleanup();
});

describe("ConfirmDialog", () => {
  const defaultProps = {
    isOpen: true,
    title: "Confirm Action",
    message: "Are you sure you want to proceed?",
    confirmLabel: "Confirm",
    onConfirm: mock(() => {}),
    onCancel: mock(() => {}),
  };

  describe("rendering", () => {
    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <ConfirmDialog {...defaultProps} isOpen={false} />
      );
      expect(container.innerHTML).toBe("");
    });

    it("renders dialog when isOpen is true", () => {
      render(<ConfirmDialog {...defaultProps} />);

      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.getByText("Confirm Action")).toBeDefined();
      expect(screen.getByText("Are you sure you want to proceed?")).toBeDefined();
    });

    it("renders custom confirm label", () => {
      render(<ConfirmDialog {...defaultProps} confirmLabel="Delete" />);

      expect(screen.getByText("Delete")).toBeDefined();
    });

    it("always renders Cancel button", () => {
      render(<ConfirmDialog {...defaultProps} />);

      expect(screen.getByText("Cancel")).toBeDefined();
    });
  });

  describe("accessibility", () => {
    it("has proper dialog role and aria attributes", () => {
      render(<ConfirmDialog {...defaultProps} />);

      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      // aria-labelledby should reference the title element (using React useId)
      expect(dialog.getAttribute("aria-labelledby")).toBeDefined();
    });

    it("has accessible title linked via aria-labelledby", () => {
      render(<ConfirmDialog {...defaultProps} />);

      const dialog = screen.getByRole("dialog");
      const labelledById = dialog.getAttribute("aria-labelledby");
      expect(labelledById).toBeDefined();
      expect(typeof labelledById).toBe("string");

      const title = screen.getByText("Confirm Action");
      // Title ID should match aria-labelledby
      expect(title.id).toBe(labelledById as string);
    });
  });

  describe("user interactions", () => {
    it("calls onConfirm when confirm button is clicked", () => {
      const onConfirm = mock(() => {});
      render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

      fireEvent.click(screen.getByText("Confirm"));

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when cancel button is clicked", () => {
      const onCancel = mock(() => {});
      render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

      fireEvent.click(screen.getByText("Cancel"));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when backdrop is clicked", () => {
      const onCancel = mock(() => {});
      const { container } = render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

      // Click on the backdrop (parent of the dialog)
      const backdrop = container.querySelector(".confirm-dialog__backdrop");
      expect(backdrop).not.toBeNull();
      fireEvent.click(backdrop!);

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not call onCancel when dialog content is clicked", () => {
      const onCancel = mock(() => {});
      render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

      // Click on the dialog content (not the backdrop)
      const dialog = screen.getByRole("dialog");
      fireEvent.click(dialog);

      expect(onCancel).not.toHaveBeenCalled();
    });

    it("calls onCancel when Escape key is pressed", () => {
      const onCancel = mock(() => {});
      const { container } = render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

      // Escape key handler is on the backdrop
      const backdrop = container.querySelector(".confirm-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Escape" });

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not call onCancel for other keys", () => {
      const onCancel = mock(() => {});
      const { container } = render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

      const backdrop = container.querySelector(".confirm-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Enter" });

      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe("button types", () => {
    it("renders buttons with type='button' to prevent form submission", () => {
      render(<ConfirmDialog {...defaultProps} />);

      const buttons = screen.getAllByRole("button");
      buttons.forEach((button) => {
        expect(button.getAttribute("type")).toBe("button");
      });
    });
  });
});

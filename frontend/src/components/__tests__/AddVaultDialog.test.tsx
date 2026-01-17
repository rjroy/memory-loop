/**
 * AddVaultDialog Component Tests
 *
 * Tests for the vault creation dialog including:
 * - Rendering states (open/closed)
 * - Input handling and validation
 * - Form submission
 * - Cancel behavior
 * - Loading and error states
 * - Keyboard interactions
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AddVaultDialog } from "../AddVaultDialog";

describe("AddVaultDialog", () => {
  const mockOnConfirm = mock(() => {});
  const mockOnCancel = mock(() => {});

  beforeEach(() => {
    mockOnConfirm.mockClear();
    mockOnCancel.mockClear();
  });

  afterEach(() => {
    cleanup();
    // Clean up any portal elements that might have been left behind
    const portals = document.querySelectorAll(".add-vault-dialog__backdrop");
    portals.forEach((p) => p.remove());
  });

  describe("rendering", () => {
    it("renders nothing when closed", () => {
      const { container } = render(
        <AddVaultDialog
          isOpen={false}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(container.innerHTML).toBe("");
    });

    it("renders dialog when open", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.getByText("Add Vault")).toBeDefined();
    });

    it("renders title and description", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByText("Add Vault")).toBeDefined();
      expect(screen.getByText(/Enter a name for your new vault/)).toBeDefined();
    });

    it("renders input field with label", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByLabelText("Vault Name")).toBeDefined();
      expect(screen.getByPlaceholderText("My New Vault")).toBeDefined();
    });

    it("renders Cancel and Create buttons", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByText("Cancel")).toBeDefined();
      expect(screen.getByText("Create")).toBeDefined();
    });

    it("has proper accessibility attributes", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("aria-labelledby")).toBeDefined();
    });
  });

  describe("input handling", () => {
    it("updates input value on change", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const input = screen.getByLabelText<HTMLInputElement>("Vault Name");
      fireEvent.change(input, { target: { value: "My Test Vault" } });

      expect(input.value).toBe("My Test Vault");
    });

    it("resets input when dialog opens", async () => {
      const { rerender } = render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const input = screen.getByLabelText<HTMLInputElement>("Vault Name");
      fireEvent.change(input, { target: { value: "Some Value" } });
      expect(input.value).toBe("Some Value");

      // Close and reopen
      rerender(
        <AddVaultDialog
          isOpen={false}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      rerender(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      await waitFor(() => {
        const newInput = screen.getByLabelText<HTMLInputElement>("Vault Name");
        expect(newInput.value).toBe("");
      });
    });
  });

  describe("form submission", () => {
    it("calls onConfirm with trimmed title when Create is clicked", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const input = screen.getByLabelText("Vault Name");
      fireEvent.change(input, { target: { value: "  My Vault  " } });

      const createButton = screen.getByText("Create");
      fireEvent.click(createButton);

      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
      expect(mockOnConfirm).toHaveBeenCalledWith("My Vault");
    });

    it("does not call onConfirm when title is empty", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const createButton = screen.getByText("Create");
      fireEvent.click(createButton);

      expect(mockOnConfirm).not.toHaveBeenCalled();
    });

    it("does not call onConfirm when title is only whitespace", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const input = screen.getByLabelText("Vault Name");
      fireEvent.change(input, { target: { value: "   " } });

      const createButton = screen.getByText("Create");
      fireEvent.click(createButton);

      expect(mockOnConfirm).not.toHaveBeenCalled();
    });

    it("disables Create button when title is empty", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const createButton = screen.getByText<HTMLButtonElement>("Create");
      expect(createButton.disabled).toBe(true);
    });

    it("enables Create button when title has content", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const input = screen.getByLabelText("Vault Name");
      fireEvent.change(input, { target: { value: "My Vault" } });

      const createButton = screen.getByText<HTMLButtonElement>("Create");
      expect(createButton.disabled).toBe(false);
    });
  });

  describe("cancel behavior", () => {
    it("calls onCancel when Cancel button is clicked", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const cancelButton = screen.getByText("Cancel");
      fireEvent.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when backdrop is clicked", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const backdrop = document.querySelector(".add-vault-dialog__backdrop");
      expect(backdrop).toBeDefined();
      fireEvent.click(backdrop!);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it("does not call onCancel when dialog content is clicked", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const dialog = screen.getByRole("dialog");
      fireEvent.click(dialog);

      expect(mockOnCancel).not.toHaveBeenCalled();
    });
  });

  describe("loading state", () => {
    it("shows Creating... text when isCreating is true", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          isCreating={true}
        />
      );

      expect(screen.getByText("Creating...")).toBeDefined();
    });

    it("disables Create button when isCreating", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          isCreating={true}
        />
      );

      const input = screen.getByLabelText("Vault Name");
      fireEvent.change(input, { target: { value: "My Vault" } });

      const createButton = screen.getByText("Creating...").closest("button") as HTMLButtonElement;
      expect(createButton.disabled).toBe(true);
    });

    it("disables Cancel button when isCreating", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          isCreating={true}
        />
      );

      const cancelButton = screen.getByText<HTMLButtonElement>("Cancel");
      expect(cancelButton.disabled).toBe(true);
    });

    it("disables input when isCreating", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          isCreating={true}
        />
      );

      const input = screen.getByLabelText<HTMLInputElement>("Vault Name");
      expect(input.disabled).toBe(true);
    });

    it("does not call onCancel when backdrop is clicked during creation", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          isCreating={true}
        />
      );

      const backdrop = document.querySelector(".add-vault-dialog__backdrop");
      fireEvent.click(backdrop!);

      expect(mockOnCancel).not.toHaveBeenCalled();
    });

    it("does not call onCancel when Cancel button is clicked during creation", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          isCreating={true}
        />
      );

      const cancelButton = screen.getByText("Cancel");
      fireEvent.click(cancelButton);

      expect(mockOnCancel).not.toHaveBeenCalled();
    });
  });

  describe("error state", () => {
    it("displays error message when createError is set", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          createError="Failed to create vault"
        />
      );

      const errorElement = screen.getByRole("alert");
      expect(errorElement.textContent).toBe("Failed to create vault");
    });

    it("does not display error element when createError is null", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          createError={null}
        />
      );

      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("allows retry after error", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          createError="Failed to create vault"
        />
      );

      const input = screen.getByLabelText("Vault Name");
      fireEvent.change(input, { target: { value: "Retry Vault" } });

      const createButton = screen.getByText<HTMLButtonElement>("Create");
      expect(createButton.disabled).toBe(false);

      fireEvent.click(createButton);
      expect(mockOnConfirm).toHaveBeenCalledWith("Retry Vault");
    });
  });

  describe("keyboard interactions", () => {
    it("submits form when Enter is pressed with valid title", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const input = screen.getByLabelText("Vault Name");
      fireEvent.change(input, { target: { value: "Enter Vault" } });

      const backdrop = document.querySelector(".add-vault-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Enter" });

      expect(mockOnConfirm).toHaveBeenCalledWith("Enter Vault");
    });

    it("does not submit form when Enter is pressed with empty title", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const backdrop = document.querySelector(".add-vault-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Enter" });

      expect(mockOnConfirm).not.toHaveBeenCalled();
    });

    it("cancels dialog when Escape is pressed", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const backdrop = document.querySelector(".add-vault-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Escape" });

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it("does not cancel on Escape when isCreating", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          isCreating={true}
        />
      );

      const backdrop = document.querySelector(".add-vault-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Escape" });

      expect(mockOnCancel).not.toHaveBeenCalled();
    });

    it("does not submit on Enter when isCreating", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          isCreating={true}
        />
      );

      // Input is disabled but we can still test the key handler
      const backdrop = document.querySelector(".add-vault-dialog__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Enter" });

      expect(mockOnConfirm).not.toHaveBeenCalled();
    });
  });

  describe("button styling", () => {
    it("applies loading class to Create button when isCreating", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          isCreating={true}
        />
      );

      const createButton = screen.getByText("Creating...").closest("button");
      expect(createButton?.className).toContain("add-vault-dialog__btn--loading");
    });

    it("has confirm styling on Create button", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const createButton = screen.getByText("Create");
      expect(createButton.className).toContain("add-vault-dialog__btn--confirm");
    });

    it("has cancel styling on Cancel button", () => {
      render(
        <AddVaultDialog
          isOpen={true}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const cancelButton = screen.getByText("Cancel");
      expect(cancelButton.className).toContain("add-vault-dialog__btn--cancel");
    });
  });
});

/**
 * Tests for ConfigEditorDialog component
 *
 * Tests rendering, field population, slider interactions, badge management,
 * change detection, and save/cancel behavior.
 */

import { describe, it, expect, afterEach, mock, beforeEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  ConfigEditorDialog,
  type EditableVaultConfig,
  type ConfigEditorDialogProps,
} from "../ConfigEditorDialog";

afterEach(() => {
  cleanup();
});

describe("ConfigEditorDialog", () => {
  const defaultConfig: EditableVaultConfig = {
    title: "Test Vault",
    subtitle: "Test subtitle",
    discussionModel: "sonnet",
    promptsPerGeneration: 5,
    maxPoolSize: 50,
    quotesPerWeek: 2,
    recentCaptures: 5,
    recentDiscussions: 5,
    badges: [{ text: "Test", color: "purple" }],
  };

  const defaultProps: ConfigEditorDialogProps = {
    isOpen: true,
    initialConfig: defaultConfig,
    onSave: mock(() => {}),
    onCancel: mock(() => {}),
  };

  beforeEach(() => {
    // Reset mocks before each test
    (defaultProps.onSave as ReturnType<typeof mock>).mockClear?.();
    (defaultProps.onCancel as ReturnType<typeof mock>).mockClear?.();
  });

  describe("basic rendering", () => {
    it("does not render when isOpen is false", () => {
      const { container } = render(
        <ConfigEditorDialog {...defaultProps} isOpen={false} />
      );
      expect(container.innerHTML).toBe("");
    });

    it("renders dialog with title 'Vault Settings' when isOpen is true", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeDefined();
      expect(screen.getByText("Vault Settings")).toBeDefined();
    });

    it("shows Save and Cancel buttons", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      expect(screen.getByText("Save")).toBeDefined();
      expect(screen.getByText("Cancel")).toBeDefined();
    });

    it("has proper dialog role and aria attributes", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("aria-labelledby")).toBeDefined();
    });
  });

  describe("field population from initialConfig", () => {
    it("title input shows value from initialConfig.title", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const titleInput = screen.getByLabelText<HTMLInputElement>("Vault Title");
      expect(titleInput.value).toBe("Test Vault");
    });

    it("subtitle input shows value from initialConfig.subtitle", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const subtitleInput = screen.getByLabelText<HTMLInputElement>("Subtitle");
      expect(subtitleInput.value).toBe("Test subtitle");
    });

    it("discussion model dropdown shows value from initialConfig.discussionModel", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const modelSelect = screen.getByLabelText<HTMLSelectElement>("AI Model");
      expect(modelSelect.value).toBe("sonnet");
    });

    it("promptsPerGeneration slider shows value from initialConfig", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText<HTMLInputElement>(
        "Prompts per Generation"
      );
      expect(slider.value).toBe("5");
    });

    it("maxPoolSize slider shows value from initialConfig", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText<HTMLInputElement>("Prompt Pool Size");
      expect(slider.value).toBe("50");
    });

    it("quotesPerWeek slider shows value from initialConfig", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText<HTMLInputElement>("Quotes per Week");
      expect(slider.value).toBe("2");
    });

    it("recentCaptures slider shows value from initialConfig", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText<HTMLInputElement>(
        "Recent Captures to Show"
      );
      expect(slider.value).toBe("5");
    });

    it("recentDiscussions slider shows value from initialConfig", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText<HTMLInputElement>(
        "Recent Discussions to Show"
      );
      expect(slider.value).toBe("5");
    });

    it("handles undefined optional fields gracefully", () => {
      const sparseConfig: EditableVaultConfig = {};

      render(
        <ConfigEditorDialog
          {...defaultProps}
          initialConfig={sparseConfig}
        />
      );

      const titleInput = screen.getByLabelText<HTMLInputElement>("Vault Title");
      expect(titleInput.value).toBe("");

      const subtitleInput = screen.getByLabelText<HTMLInputElement>("Subtitle");
      expect(subtitleInput.value).toBe("");
    });
  });

  describe("slider interactions", () => {
    it("promptsPerGeneration slider value display updates when slider is moved", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText<HTMLInputElement>(
        "Prompts per Generation"
      );

      // Change value to 10
      fireEvent.change(slider, { target: { value: "10" } });

      // Find the value display span (sibling to slider in slider-row)
      const valueDisplay = slider
        .closest(".config-editor__slider-row")
        ?.querySelector(".config-editor__slider-value");
      expect(valueDisplay?.textContent).toBe("10");
    });

    it("maxPoolSize slider value display updates when slider is moved", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText<HTMLInputElement>("Prompt Pool Size");

      fireEvent.change(slider, { target: { value: "100" } });

      const valueDisplay = slider
        .closest(".config-editor__slider-row")
        ?.querySelector(".config-editor__slider-value");
      expect(valueDisplay?.textContent).toBe("100");
    });

    it("quotesPerWeek slider value display updates when slider is moved", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText<HTMLInputElement>("Quotes per Week");

      fireEvent.change(slider, { target: { value: "5" } });

      const valueDisplay = slider
        .closest(".config-editor__slider-row")
        ?.querySelector(".config-editor__slider-value");
      expect(valueDisplay?.textContent).toBe("5");
    });

    it("recentCaptures slider value display updates when slider is moved", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText<HTMLInputElement>(
        "Recent Captures to Show"
      );

      fireEvent.change(slider, { target: { value: "15" } });

      const valueDisplay = slider
        .closest(".config-editor__slider-row")
        ?.querySelector(".config-editor__slider-value");
      expect(valueDisplay?.textContent).toBe("15");
    });

    it("recentDiscussions slider value display updates when slider is moved", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText<HTMLInputElement>(
        "Recent Discussions to Show"
      );

      fireEvent.change(slider, { target: { value: "12" } });

      const valueDisplay = slider
        .closest(".config-editor__slider-row")
        ?.querySelector(".config-editor__slider-value");
      expect(valueDisplay?.textContent).toBe("12");
    });
  });

  describe("badge editor", () => {
    it("displays existing badges from initialConfig", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const badge = screen.getByText("Test");
      expect(badge).toBeDefined();
      expect(badge.closest(".badge-editor__chip")).toBeDefined();
    });

    it("displays multiple badges from initialConfig", () => {
      const configWithMultipleBadges: EditableVaultConfig = {
        ...defaultConfig,
        badges: [
          { text: "Work", color: "blue" },
          { text: "Personal", color: "green" },
          { text: "Important", color: "red" },
        ],
      };

      render(
        <ConfigEditorDialog
          {...defaultProps}
          initialConfig={configWithMultipleBadges}
        />
      );

      expect(screen.getByText("Work")).toBeDefined();
      expect(screen.getByText("Personal")).toBeDefined();
      expect(screen.getByText("Important")).toBeDefined();
    });

    it("can add a new badge", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Click "Add badge" button
      const addButton = screen.getByText("Add badge");
      fireEvent.click(addButton);

      // Enter badge text
      const textInput = screen.getByPlaceholderText("Badge text...");
      fireEvent.change(textInput, { target: { value: "New Badge" } });

      // Click confirm add
      const confirmButton = screen.getByText("Add");
      fireEvent.click(confirmButton);

      // New badge should appear
      expect(screen.getByText("New Badge")).toBeDefined();
    });

    it("add badge button disabled when at 5 badge limit", () => {
      const configWithMaxBadges: EditableVaultConfig = {
        ...defaultConfig,
        badges: [
          { text: "One", color: "blue" },
          { text: "Two", color: "green" },
          { text: "Three", color: "red" },
          { text: "Four", color: "purple" },
          { text: "Five", color: "orange" },
        ],
      };

      render(
        <ConfigEditorDialog
          {...defaultProps}
          initialConfig={configWithMaxBadges}
        />
      );

      const addButton = screen.getByText<HTMLButtonElement>("Add badge");
      expect(addButton.disabled).toBe(true);
    });

    it("can remove a badge", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Find and click the remove button for the "Test" badge
      const removeButton = screen.getByLabelText("Remove Test badge");
      fireEvent.click(removeButton);

      // Badge should be removed
      expect(screen.queryByText("Test")).toBeNull();
    });

    it("enforces 20 character limit on badge text", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Click "Add badge" button
      fireEvent.click(screen.getByText("Add badge"));

      // Enter text that exceeds 20 characters
      const textInput = screen.getByPlaceholderText<HTMLInputElement>(
        "Badge text..."
      );
      fireEvent.change(textInput, {
        target: { value: "This is a very long badge text that should be truncated" },
      });

      // Input should have maxLength of 20 and value should be limited
      expect(textInput.maxLength).toBe(20);
      // The component enforces this at the onChange level
      expect(textInput.value.length).toBeLessThanOrEqual(20);
    });

    it("can cancel adding a badge", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Click "Add badge" button
      fireEvent.click(screen.getByText("Add badge"));

      // The add form should appear
      expect(screen.getByPlaceholderText("Badge text...")).toBeDefined();

      // Click cancel
      const cancelButton = screen
        .getByText("Cancel", { selector: ".badge-editor__cancel-btn" });
      fireEvent.click(cancelButton);

      // Add form should be hidden, "Add badge" button should reappear
      expect(screen.getByText("Add badge")).toBeDefined();
      expect(screen.queryByPlaceholderText("Badge text...")).toBeNull();
    });

    it("can select badge color before adding", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Click "Add badge" button
      fireEvent.click(screen.getByText("Add badge"));

      // Select a different color
      const blueColorButton = screen.getByLabelText("Select blue color");
      fireEvent.click(blueColorButton);

      // Enter badge text and add
      fireEvent.change(screen.getByPlaceholderText("Badge text..."), {
        target: { value: "Blue Badge" },
      });
      fireEvent.click(screen.getByText("Add"));

      // The new badge should exist (color verification is style-based)
      expect(screen.getByText("Blue Badge")).toBeDefined();
    });

    it("add button disabled when badge text is empty", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Click "Add badge" button
      fireEvent.click(screen.getByText("Add badge"));

      // Add button should be disabled with empty text
      const addButton = screen.getByText<HTMLButtonElement>("Add");
      expect(addButton.disabled).toBe(true);
    });

    it("supports Enter key to confirm add", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Click "Add badge" button
      fireEvent.click(screen.getByText("Add badge"));

      // Enter badge text
      const textInput = screen.getByPlaceholderText("Badge text...");
      fireEvent.change(textInput, { target: { value: "Enter Badge" } });

      // Press Enter
      fireEvent.keyDown(textInput, { key: "Enter" });

      // Badge should be added
      expect(screen.getByText("Enter Badge")).toBeDefined();
    });

    it("supports Escape key to cancel add", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Click "Add badge" button
      fireEvent.click(screen.getByText("Add badge"));

      // Enter badge text
      const textInput = screen.getByPlaceholderText("Badge text...");
      fireEvent.change(textInput, { target: { value: "Escape Badge" } });

      // Press Escape
      fireEvent.keyDown(textInput, { key: "Escape" });

      // Add form should be hidden
      expect(screen.queryByPlaceholderText("Badge text...")).toBeNull();
      expect(screen.queryByText("Escape Badge")).toBeNull();
    });
  });

  describe("change detection and cancel", () => {
    it("save button disabled when no changes made", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const saveButton = screen.getByText<HTMLButtonElement>("Save");
      expect(saveButton.disabled).toBe(true);
    });

    it("save button enabled when title changes", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const titleInput = screen.getByLabelText("Vault Title");
      fireEvent.change(titleInput, { target: { value: "New Title" } });

      const saveButton = screen.getByText<HTMLButtonElement>("Save");
      expect(saveButton.disabled).toBe(false);
    });

    it("save button enabled when subtitle changes", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const subtitleInput = screen.getByLabelText("Subtitle");
      fireEvent.change(subtitleInput, { target: { value: "New Subtitle" } });

      const saveButton = screen.getByText<HTMLButtonElement>("Save");
      expect(saveButton.disabled).toBe(false);
    });

    it("save button enabled when discussion model changes", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const modelSelect = screen.getByLabelText("AI Model");
      fireEvent.change(modelSelect, { target: { value: "opus" } });

      const saveButton = screen.getByText<HTMLButtonElement>("Save");
      expect(saveButton.disabled).toBe(false);
    });

    it("save button enabled when slider values change", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const slider = screen.getByLabelText("Prompts per Generation");
      fireEvent.change(slider, { target: { value: "10" } });

      const saveButton = screen.getByText<HTMLButtonElement>("Save");
      expect(saveButton.disabled).toBe(false);
    });

    it("save button enabled when badges change", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Remove a badge
      const removeButton = screen.getByLabelText("Remove Test badge");
      fireEvent.click(removeButton);

      const saveButton = screen.getByText<HTMLButtonElement>("Save");
      expect(saveButton.disabled).toBe(false);
    });

    it("cancel without changes calls onCancel directly", () => {
      const onCancel = mock(() => {});
      render(<ConfigEditorDialog {...defaultProps} onCancel={onCancel} />);

      // Click cancel button (footer button, not badge cancel)
      const cancelButton = screen.getByText("Cancel", {
        selector: ".config-editor__btn--cancel",
      });
      fireEvent.click(cancelButton);

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("cancel with changes shows confirmation dialog", () => {
      const onCancel = mock(() => {});
      render(<ConfigEditorDialog {...defaultProps} onCancel={onCancel} />);

      // Make a change
      const titleInput = screen.getByLabelText("Vault Title");
      fireEvent.change(titleInput, { target: { value: "Changed" } });

      // Click cancel
      const cancelButton = screen.getByText("Cancel", {
        selector: ".config-editor__btn--cancel",
      });
      fireEvent.click(cancelButton);

      // Confirmation dialog should appear
      expect(screen.getByText("Discard Changes?")).toBeDefined();
      expect(
        screen.getByText(
          "You have unsaved changes. Are you sure you want to discard them?"
        )
      ).toBeDefined();

      // onCancel should not have been called yet
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("confirming discard calls onCancel", () => {
      const onCancel = mock(() => {});
      render(<ConfigEditorDialog {...defaultProps} onCancel={onCancel} />);

      // Make a change
      fireEvent.change(screen.getByLabelText("Vault Title"), {
        target: { value: "Changed" },
      });

      // Click cancel
      fireEvent.click(
        screen.getByText("Cancel", {
          selector: ".config-editor__btn--cancel",
        })
      );

      // Click discard in confirmation dialog
      fireEvent.click(screen.getByText("Discard"));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("canceling discard keeps dialog open", () => {
      const onCancel = mock(() => {});
      render(<ConfigEditorDialog {...defaultProps} onCancel={onCancel} />);

      // Make a change
      fireEvent.change(screen.getByLabelText("Vault Title"), {
        target: { value: "Changed" },
      });

      // Click cancel
      fireEvent.click(
        screen.getByText("Cancel", {
          selector: ".config-editor__btn--cancel",
        })
      );

      // Click Cancel in confirmation dialog (to keep editing)
      // Find the cancel button in the confirm dialog (rendered via portal)
      const confirmDialogBackdrop = document.querySelector(
        ".confirm-dialog__backdrop"
      );
      const confirmCancelButton = confirmDialogBackdrop?.querySelector(
        ".confirm-dialog__btn--cancel"
      );
      fireEvent.click(confirmCancelButton!);

      // onCancel should not have been called
      expect(onCancel).not.toHaveBeenCalled();

      // Main dialog should still be open with the change
      expect(screen.getByRole("dialog")).toBeDefined();
      expect(
        screen.getByLabelText<HTMLInputElement>("Vault Title").value
      ).toBe("Changed");
    });

    it("backdrop click with changes shows confirmation dialog", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Make a change
      fireEvent.change(screen.getByLabelText("Vault Title"), {
        target: { value: "Changed" },
      });

      // Click backdrop
      const backdrop = document.querySelector(".config-editor__backdrop");
      fireEvent.click(backdrop!);

      // Confirmation dialog should appear
      expect(screen.getByText("Discard Changes?")).toBeDefined();
    });

    it("Escape key with changes shows confirmation dialog", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Make a change
      fireEvent.change(screen.getByLabelText("Vault Title"), {
        target: { value: "Changed" },
      });

      // Press Escape on backdrop
      const backdrop = document.querySelector(".config-editor__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Escape" });

      // Confirmation dialog should appear
      expect(screen.getByText("Discard Changes?")).toBeDefined();
    });

    it("close button with changes shows confirmation dialog", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      // Make a change
      fireEvent.change(screen.getByLabelText("Vault Title"), {
        target: { value: "Changed" },
      });

      // Click close button (X)
      const closeButton = screen.getByLabelText("Close");
      fireEvent.click(closeButton);

      // Confirmation dialog should appear
      expect(screen.getByText("Discard Changes?")).toBeDefined();
    });
  });

  describe("save functionality", () => {
    it("clicking save calls onSave with current form state", () => {
      const onSave = mock(() => {});
      render(<ConfigEditorDialog {...defaultProps} onSave={onSave} />);

      // Make changes
      fireEvent.change(screen.getByLabelText("Vault Title"), {
        target: { value: "Updated Title" },
      });
      fireEvent.change(screen.getByLabelText("Prompts per Generation"), {
        target: { value: "10" },
      });

      // Click save
      fireEvent.click(screen.getByText("Save"));

      expect(onSave).toHaveBeenCalledTimes(1);
      // Access mock calls properly for bun:test
      const calls = (onSave as ReturnType<typeof mock>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const savedConfig = calls[0][0] as EditableVaultConfig;
      expect(savedConfig.title).toBe("Updated Title");
      expect(savedConfig.promptsPerGeneration).toBe(10);
      // Other values should be preserved
      expect(savedConfig.subtitle).toBe("Test subtitle");
      expect(savedConfig.discussionModel).toBe("sonnet");
    });
  });

  describe("loading state (isSaving)", () => {
    it("shows 'Saving...' when isSaving is true", () => {
      render(
        <ConfigEditorDialog
          {...defaultProps}
          isSaving={true}
        />
      );

      expect(screen.getByText("Saving...")).toBeDefined();
    });

    it("save button disabled when isSaving is true", () => {
      // Need to have changes to normally enable save button
      const configForSaving = { ...defaultConfig, title: "Different" };
      render(
        <ConfigEditorDialog
          {...defaultProps}
          initialConfig={configForSaving}
          isSaving={true}
        />
      );

      // Make a change to enable save
      fireEvent.change(screen.getByLabelText("Vault Title"), {
        target: { value: "Changed" },
      });

      const saveButton = screen.getByText<HTMLButtonElement>("Saving...");
      expect(saveButton.disabled).toBe(true);
    });

    it("cancel button disabled when isSaving is true", () => {
      render(
        <ConfigEditorDialog
          {...defaultProps}
          isSaving={true}
        />
      );

      const cancelButton = screen.getByText<HTMLButtonElement>("Cancel", {
        selector: ".config-editor__btn--cancel",
      });
      expect(cancelButton.disabled).toBe(true);
    });

    it("close button disabled when isSaving is true", () => {
      render(
        <ConfigEditorDialog
          {...defaultProps}
          isSaving={true}
        />
      );

      const closeButton = screen.getByLabelText<HTMLButtonElement>("Close");
      expect(closeButton.disabled).toBe(true);
    });

    it("save button has loading class when isSaving is true", () => {
      render(
        <ConfigEditorDialog
          {...defaultProps}
          isSaving={true}
        />
      );

      const saveButton = screen.getByText("Saving...");
      expect(saveButton.className).toContain("config-editor__btn--loading");
    });
  });

  describe("error state (saveError)", () => {
    it("shows error message when saveError is set", () => {
      render(
        <ConfigEditorDialog
          {...defaultProps}
          saveError="Failed to save configuration"
        />
      );

      const errorMessage = screen.getByRole("alert");
      expect(errorMessage).toBeDefined();
      expect(errorMessage.textContent).toBe("Failed to save configuration");
    });

    it("error has proper alert role for accessibility", () => {
      render(
        <ConfigEditorDialog
          {...defaultProps}
          saveError="Network error occurred"
        />
      );

      const errorElement = screen.getByRole("alert");
      expect(errorElement).toBeDefined();
    });

    it("does not show error when saveError is null", () => {
      render(
        <ConfigEditorDialog
          {...defaultProps}
          saveError={null}
        />
      );

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("form reset on reopen", () => {
    it("resets form to initialConfig when dialog reopens", () => {
      const { rerender } = render(
        <ConfigEditorDialog {...defaultProps} />
      );

      // Make a change
      fireEvent.change(screen.getByLabelText("Vault Title"), {
        target: { value: "Changed Title" },
      });

      // Close dialog
      rerender(<ConfigEditorDialog {...defaultProps} isOpen={false} />);

      // Reopen dialog
      rerender(<ConfigEditorDialog {...defaultProps} isOpen={true} />);

      // Form should be reset to initial values
      const titleInput = screen.getByLabelText<HTMLInputElement>("Vault Title");
      expect(titleInput.value).toBe("Test Vault");
    });
  });

  describe("dropdown interactions", () => {
    it("discussion model can be changed to opus", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const modelSelect = screen.getByLabelText<HTMLSelectElement>("AI Model");
      fireEvent.change(modelSelect, { target: { value: "opus" } });

      expect(modelSelect.value).toBe("opus");
    });

    it("discussion model can be changed to haiku", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      const modelSelect = screen.getByLabelText<HTMLSelectElement>("AI Model");
      fireEvent.change(modelSelect, { target: { value: "haiku" } });

      expect(modelSelect.value).toBe("haiku");
    });

    it("displays all model options", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      expect(screen.getByText("Opus (Most capable)")).toBeDefined();
      expect(screen.getByText("Sonnet (Balanced)")).toBeDefined();
      expect(screen.getByText("Haiku (Fastest)")).toBeDefined();
    });
  });

  describe("section organization", () => {
    it("renders Identity section", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      expect(screen.getByText("Identity")).toBeDefined();
      expect(
        screen.getByText("Customize how this vault appears in Memory Loop.")
      ).toBeDefined();
    });

    it("renders Discussion section", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      expect(screen.getByText("Discussion")).toBeDefined();
      expect(
        screen.getByText("Configure AI model and conversation history.")
      ).toBeDefined();
    });

    it("renders Inspiration section", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      expect(screen.getByText("Inspiration")).toBeDefined();
      expect(
        screen.getByText(
          "Control contextual prompts and quotes on the home screen."
        )
      ).toBeDefined();
    });

    it("renders Recent Activity section", () => {
      render(<ConfigEditorDialog {...defaultProps} />);

      expect(screen.getByText("Recent Activity")).toBeDefined();
      expect(
        screen.getByText("Configure how many recent captures to display.")
      ).toBeDefined();
    });
  });
});

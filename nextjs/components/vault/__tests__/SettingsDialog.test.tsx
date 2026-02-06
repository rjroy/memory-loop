/**
 * SettingsDialog Component Tests
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SettingsDialog } from "../SettingsDialog";

describe("SettingsDialog", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when closed", () => {
    it("does not render when isOpen is false", () => {
      render(<SettingsDialog isOpen={false} onClose={() => {}} />);

      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("when open", () => {
    it("renders the dialog", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      expect(screen.getByRole("dialog")).not.toBeNull();
    });

    it("renders the title", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      expect(screen.getByText("Memory Settings")).not.toBeNull();
    });

    it("renders tab navigation", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      expect(screen.getByRole("tablist")).not.toBeNull();
      expect(screen.getAllByRole("tab")).toHaveLength(3);
    });

    it("renders Memory tab", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      expect(screen.getByRole("tab", { name: /memory/i })).not.toBeNull();
    });

    it("renders Extraction Prompt tab", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      expect(screen.getByRole("tab", { name: /extraction prompt/i })).not.toBeNull();
    });

    it("renders Card Generator tab", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      expect(screen.getByRole("tab", { name: /card generator/i })).not.toBeNull();
    });

    it("renders close buttons", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      // Close button in header (icon with aria-label)
      expect(screen.getByLabelText("Close")).not.toBeNull();
      // Close buttons (header icon + footer button)
      const closeButtons = screen.getAllByRole("button", { name: /close/i });
      expect(closeButtons.length).toBe(2);
    });
  });

  describe("tab switching", () => {
    it("starts with Memory tab active by default", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      const memoryTab = screen.getByRole("tab", { name: /memory/i });
      expect(memoryTab.getAttribute("aria-selected")).toBe("true");
    });

    it("can start with Prompt tab active", () => {
      render(<SettingsDialog isOpen={true} initialTab="prompt" onClose={() => {}} />);

      const promptTab = screen.getByRole("tab", { name: /extraction prompt/i });
      expect(promptTab.getAttribute("aria-selected")).toBe("true");
    });

    it("switches to Prompt tab when clicked", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      const promptTab = screen.getByRole("tab", { name: /extraction prompt/i });
      fireEvent.click(promptTab);

      expect(promptTab.getAttribute("aria-selected")).toBe("true");
    });

    it("switches back to Memory tab when clicked", () => {
      render(<SettingsDialog isOpen={true} initialTab="prompt" onClose={() => {}} />);

      const memoryTab = screen.getByRole("tab", { name: /memory/i });
      fireEvent.click(memoryTab);

      expect(memoryTab.getAttribute("aria-selected")).toBe("true");
    });
  });

  describe("tab panels", () => {
    it("shows Memory panel when Memory tab is active", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      const memoryPanel = screen.getByRole("tabpanel");
      expect(memoryPanel.getAttribute("hidden")).toBeNull();
    });

    it("hides other panels when Memory tab is active", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      // The hidden panels should have the hidden attribute (Prompt and Card Generator)
      const hiddenPanels = document.querySelectorAll('.settings-dialog__panel[hidden]');
      expect(hiddenPanels.length).toBe(2);
    });
  });

  describe("custom content", () => {
    it("renders custom memory editor content", () => {
      render(
        <SettingsDialog
          isOpen={true}
          onClose={() => {}}
          memoryEditorContent={<div data-testid="custom-memory">Custom Memory Editor</div>}
        />
      );

      expect(screen.getByTestId("custom-memory")).not.toBeNull();
    });

    it("renders custom prompt editor content", () => {
      render(
        <SettingsDialog
          isOpen={true}
          initialTab="prompt"
          onClose={() => {}}
          promptEditorContent={<div data-testid="custom-prompt">Custom Prompt Editor</div>}
        />
      );

      expect(screen.getByTestId("custom-prompt")).not.toBeNull();
    });
  });

  describe("closing behavior", () => {
    it("calls onClose when close button is clicked", () => {
      let closeCalled = false;
      render(<SettingsDialog isOpen={true} onClose={() => { closeCalled = true; }} />);

      const closeButton = screen.getByLabelText("Close");
      fireEvent.click(closeButton);

      expect(closeCalled).toBe(true);
    });

    it("calls onClose when footer Close button is clicked", () => {
      let closeCalled = false;
      render(<SettingsDialog isOpen={true} onClose={() => { closeCalled = true; }} />);

      // Get the Close button in the footer (not the header close icon)
      const closeButtons = screen.getAllByRole("button", { name: /close/i });
      const footerCloseButton = closeButtons[closeButtons.length - 1];
      fireEvent.click(footerCloseButton);

      expect(closeCalled).toBe(true);
    });

    it("calls onClose when backdrop is clicked", () => {
      let closeCalled = false;
      render(<SettingsDialog isOpen={true} onClose={() => { closeCalled = true; }} />);

      // Get the backdrop element
      const backdrop = document.querySelector(".settings-dialog__backdrop");
      if (backdrop) {
        fireEvent.click(backdrop);
      }

      expect(closeCalled).toBe(true);
    });

    it("calls onClose when Escape is pressed", () => {
      let closeCalled = false;
      render(<SettingsDialog isOpen={true} onClose={() => { closeCalled = true; }} />);

      const backdrop = document.querySelector(".settings-dialog__backdrop");
      if (backdrop) {
        fireEvent.keyDown(backdrop, { key: "Escape" });
      }

      expect(closeCalled).toBe(true);
    });
  });

  describe("accessibility", () => {
    it("has proper ARIA attributes on dialog", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("aria-labelledby")).not.toBeNull();
    });

    it("has proper ARIA attributes on tabs", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      const tabs = screen.getAllByRole("tab");
      tabs.forEach((tab) => {
        expect(tab.getAttribute("aria-controls")).not.toBeNull();
      });
    });

    it("has proper ARIA attributes on tablist", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      const tablist = screen.getByRole("tablist");
      expect(tablist.getAttribute("aria-label")).toBe("Settings sections");
    });
  });

  describe("keyboard navigation", () => {
    it("switches tabs with arrow keys", () => {
      render(<SettingsDialog isOpen={true} onClose={() => {}} />);

      const tablist = screen.getByRole("tablist");
      const memoryTab = screen.getByRole("tab", { name: /memory/i });
      const promptTab = screen.getByRole("tab", { name: /extraction prompt/i });
      const cardsTab = screen.getByRole("tab", { name: /card generator/i });

      // Initially Memory is active
      expect(memoryTab.getAttribute("aria-selected")).toBe("true");

      // Press ArrowRight to switch to Prompt
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
      expect(promptTab.getAttribute("aria-selected")).toBe("true");

      // Press ArrowRight to switch to Card Generator
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
      expect(cardsTab.getAttribute("aria-selected")).toBe("true");

      // Press ArrowRight to wrap back to Memory
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
      expect(memoryTab.getAttribute("aria-selected")).toBe("true");

      // Press ArrowLeft to wrap to Card Generator
      fireEvent.keyDown(tablist, { key: "ArrowLeft" });
      expect(cardsTab.getAttribute("aria-selected")).toBe("true");
    });
  });
});

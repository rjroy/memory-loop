/**
 * Tests for PairWritingToolbar component
 *
 * Tests rendering, button states, and user interactions.
 *
 * @see .sdd/specs/memory-loop/2026-01-20-pair-writing-mode.md REQ-F-14, REQ-F-23, REQ-F-29
 */

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PairWritingToolbar } from "../PairWritingToolbar";

afterEach(() => {
  cleanup();
});

describe("PairWritingToolbar", () => {
  const defaultProps = {
    hasUnsavedChanges: false,
    hasSnapshot: false,
    isSaving: false,
    onSnapshot: mock(() => {}),
    onSave: mock(() => {}),
    onExit: mock(() => {}),
    filePath: "notes/test-file.md",
  };

  describe("rendering", () => {
    it("renders toolbar with all buttons", () => {
      render(<PairWritingToolbar {...defaultProps} />);

      expect(screen.getByRole("toolbar")).toBeDefined();
      expect(screen.getByTitle(/snapshot/i)).toBeDefined();
      expect(screen.getByTitle(/save/i)).toBeDefined();
      expect(screen.getByTitle(/exit/i)).toBeDefined();
    });

    it("displays file path", () => {
      render(<PairWritingToolbar {...defaultProps} filePath="path/to/document.md" />);

      expect(screen.getByText("path/to/document.md")).toBeDefined();
    });

    it("shows unsaved indicator when hasUnsavedChanges is true", () => {
      render(<PairWritingToolbar {...defaultProps} hasUnsavedChanges={true} />);

      expect(screen.getByLabelText("Unsaved changes")).toBeDefined();
    });

    it("does not show unsaved indicator when hasUnsavedChanges is false", () => {
      render(<PairWritingToolbar {...defaultProps} hasUnsavedChanges={false} />);

      expect(screen.queryByLabelText("Unsaved changes")).toBeNull();
    });
  });

  describe("snapshot button (REQ-F-23)", () => {
    it("calls onSnapshot when clicked", () => {
      const onSnapshot = mock(() => {});
      render(<PairWritingToolbar {...defaultProps} onSnapshot={onSnapshot} />);

      fireEvent.click(screen.getByTitle(/snapshot/i));

      expect(onSnapshot).toHaveBeenCalledTimes(1);
    });

    it("has aria-pressed false when no snapshot exists", () => {
      render(<PairWritingToolbar {...defaultProps} hasSnapshot={false} />);

      const snapshotBtn = screen.getByTitle(/take snapshot/i);
      expect(snapshotBtn.getAttribute("aria-pressed")).toBe("false");
    });

    it("has aria-pressed true when snapshot exists", () => {
      render(<PairWritingToolbar {...defaultProps} hasSnapshot={true} />);

      const snapshotBtn = screen.getByTitle(/update snapshot/i);
      expect(snapshotBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("has different title when snapshot exists", () => {
      const { rerender } = render(<PairWritingToolbar {...defaultProps} hasSnapshot={false} />);
      expect(screen.getByTitle("Take snapshot for comparison")).toBeDefined();

      rerender(<PairWritingToolbar {...defaultProps} hasSnapshot={true} />);
      expect(screen.getByTitle("Update snapshot (replaces previous)")).toBeDefined();
    });
  });

  describe("save button (REQ-F-29)", () => {
    it("calls onSave when clicked", () => {
      const onSave = mock(() => {});
      render(<PairWritingToolbar {...defaultProps} onSave={onSave} hasUnsavedChanges={true} />);

      fireEvent.click(screen.getByTitle(/save changes/i));

      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("is disabled when no unsaved changes", () => {
      render(<PairWritingToolbar {...defaultProps} hasUnsavedChanges={false} />);

      const saveBtn = screen.getByTitle(/no unsaved changes/i);
      expect(saveBtn.hasAttribute("disabled")).toBe(true);
    });

    it("is disabled when saving", () => {
      render(<PairWritingToolbar {...defaultProps} hasUnsavedChanges={true} isSaving={true} />);

      // Find button that's in saving state
      const buttons = screen.getAllByRole("button");
      const saveBtn = buttons.find(btn => btn.textContent?.includes("Saving"));
      expect(saveBtn).toBeDefined();
      expect(saveBtn?.hasAttribute("disabled")).toBe(true);
    });

    it("shows spinner when saving", () => {
      render(<PairWritingToolbar {...defaultProps} hasUnsavedChanges={true} isSaving={true} />);

      // Check for spinner element
      const spinner = document.querySelector(".pair-writing-toolbar__spinner");
      expect(spinner).not.toBeNull();
    });
  });

  describe("exit button (REQ-F-14)", () => {
    it("calls onExit when clicked", () => {
      const onExit = mock(() => {});
      render(<PairWritingToolbar {...defaultProps} onExit={onExit} />);

      fireEvent.click(screen.getByTitle(/exit/i));

      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it("is always enabled", () => {
      render(<PairWritingToolbar {...defaultProps} hasUnsavedChanges={true} isSaving={true} />);

      const exitBtn = screen.getByTitle(/exit/i);
      expect(exitBtn.hasAttribute("disabled")).toBe(false);
    });
  });

  describe("accessibility", () => {
    it("has toolbar role", () => {
      render(<PairWritingToolbar {...defaultProps} />);

      expect(screen.getByRole("toolbar")).toBeDefined();
    });

    it("has aria-label for toolbar", () => {
      render(<PairWritingToolbar {...defaultProps} />);

      const toolbar = screen.getByRole("toolbar");
      expect(toolbar.getAttribute("aria-label")).toBe("Pair Writing toolbar");
    });

    it("all buttons have type='button'", () => {
      render(<PairWritingToolbar {...defaultProps} />);

      const buttons = screen.getAllByRole("button");
      buttons.forEach((button) => {
        expect(button.getAttribute("type")).toBe("button");
      });
    });
  });
});

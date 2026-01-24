/**
 * Tests for MemoryEditor Component
 *
 * Tests rendering, loading, editing, saving, and size validation.
 * Memory is user-global, not vault-scoped.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryEditor } from "../MemoryEditor";

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

describe("MemoryEditor", () => {
  describe("rendering", () => {
    it("shows loading state initially", () => {
      render(<MemoryEditor />);

      expect(screen.getByText("Loading memory file...")).toBeTruthy();
    });

    it("renders memory file label", () => {
      render(<MemoryEditor />);

      expect(screen.getByText("Memory File")).toBeTruthy();
    });

    it("shows file path", () => {
      render(<MemoryEditor />);

      expect(screen.getByText("~/.claude/rules/memory.md")).toBeTruthy();
    });

    it("renders save and reset buttons", () => {
      render(<MemoryEditor />);

      expect(screen.getByText("Save")).toBeTruthy();
      expect(screen.getByText("Reset")).toBeTruthy();
    });
  });

  describe("size indicator", () => {
    it("shows current size and max size", () => {
      render(<MemoryEditor />);

      // Initially shows 0 B / 50.0 KB
      expect(screen.getByText("0 B")).toBeTruthy();
      expect(screen.getByText("50.0 KB")).toBeTruthy();
    });
  });

  describe("button states", () => {
    it("disables save and reset buttons when no changes", async () => {
      render(<MemoryEditor />);

      // Wait for loading to finish (will fail to load, but buttons will be visible)
      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      const saveButton = screen.getByText("Save");
      const resetButton = screen.getByText("Reset");

      // Both should be disabled when there are no changes
      expect(saveButton.hasAttribute("disabled")).toBe(true);
      expect(resetButton.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("textarea", () => {
    it("renders textarea after loading completes", async () => {
      render(<MemoryEditor />);

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      // Textarea should now be present
      const textarea = screen.getByRole("textbox");
      expect(textarea).toBeTruthy();
    });

    it("has placeholder text", async () => {
      render(<MemoryEditor />);

      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      const textarea = screen.getByRole("textbox");
      expect(textarea.getAttribute("placeholder")).toContain("Memory");
    });

    it("updates size indicator when content changes", async () => {
      render(<MemoryEditor />);

      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Hello World" } });

      // Size should update (11 bytes)
      expect(screen.getByText("11 B")).toBeTruthy();
    });

    it("enables save button when content changes", async () => {
      render(<MemoryEditor />);

      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      const textarea = screen.getByRole("textbox");
      const saveButton = screen.getByText("Save");

      // Initially disabled
      expect(saveButton.hasAttribute("disabled")).toBe(true);

      // Type something
      fireEvent.change(textarea, { target: { value: "New content" } });

      // Should now be enabled
      expect(saveButton.hasAttribute("disabled")).toBe(false);
    });

    it("enables reset button when content changes", async () => {
      render(<MemoryEditor />);

      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      const textarea = screen.getByRole("textbox");
      const resetButton = screen.getByText("Reset");

      // Initially disabled
      expect(resetButton.hasAttribute("disabled")).toBe(true);

      // Type something
      fireEvent.change(textarea, { target: { value: "New content" } });

      // Should now be enabled
      expect(resetButton.hasAttribute("disabled")).toBe(false);
    });
  });

  describe("reset functionality", () => {
    it("resets content to original when reset is clicked", async () => {
      render(<MemoryEditor />);

      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      const resetButton = screen.getByText("Reset");

      // Type something
      fireEvent.change(textarea, { target: { value: "New content" } });
      expect(textarea.value).toBe("New content");

      // Click reset
      fireEvent.click(resetButton);

      // Should be back to original (empty since no mock)
      expect(textarea.value).toBe("");
    });
  });

  describe("size limits", () => {
    it("shows warning when content exceeds 50KB limit", async () => {
      render(<MemoryEditor />);

      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      const textarea = screen.getByRole("textbox");

      // Create content over 50KB (51 * 1024 bytes)
      const largeContent = "x".repeat(51 * 1024);
      fireEvent.change(textarea, { target: { value: largeContent } });

      // Should show warning
      expect(
        screen.getByText("Content exceeds 50KB limit. Reduce content before saving.")
      ).toBeTruthy();
    });

    it("disables save button when over limit", async () => {
      render(<MemoryEditor />);

      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      const textarea = screen.getByRole("textbox");
      const saveButton = screen.getByText("Save");

      // Create content over 50KB
      const largeContent = "x".repeat(51 * 1024);
      fireEvent.change(textarea, { target: { value: largeContent } });

      // Save should be disabled
      expect(saveButton.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("new file indicator", () => {
    it("shows 'New' badge when file does not exist", async () => {
      render(<MemoryEditor />);

      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      // Should show New badge (since no API response, fileExists defaults to false)
      expect(screen.getByText("New")).toBeTruthy();
    });
  });

  describe("accessibility", () => {
    it("has alert role on warning message", async () => {
      render(<MemoryEditor />);

      await waitFor(() => {
        expect(screen.queryByText("Loading memory file...")).toBeNull();
      });

      const textarea = screen.getByRole("textbox");

      // Create content over limit to trigger warning
      const largeContent = "x".repeat(51 * 1024);
      fireEvent.change(textarea, { target: { value: largeContent } });

      // Verify warning text appears
      expect(
        screen.getByText("Content exceeds 50KB limit. Reduce content before saving.")
      ).toBeTruthy();

      // Warning should have alert role
      const alerts = screen.getAllByRole("alert");
      expect(alerts.length).toBeGreaterThan(0);
    });
  });
});

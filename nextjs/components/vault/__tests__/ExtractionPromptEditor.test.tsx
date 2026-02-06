/**
 * ExtractionPromptEditor Component Tests
 *
 * Tests the REST-based extraction prompt editor component.
 */

import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ExtractionPromptEditor } from "../ExtractionPromptEditor";

describe("ExtractionPromptEditor", () => {
  // Store original fetch
  let originalFetch: typeof global.fetch;

  // Mock fetch responses
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: "Default prompt content",
            isOverride: false,
          }),
      } as Response)
    );
    global.fetch = mockFetch;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  // Helper to set up fetch mock with specific response
  const setupFetchMock = (response: Record<string, unknown>) => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(response),
      } as Response)
    );
  };

  describe("initial state", () => {
    it("shows loading state initially", () => {
      // Don't resolve fetch immediately
      mockFetch.mockImplementation(() => new Promise(() => {}));
      render(<ExtractionPromptEditor />);

      expect(screen.getByText("Loading extraction prompt...")).not.toBeNull();
    });

    it("calls fetch to load prompt on mount", async () => {
      setupFetchMock({
        content: "Test prompt content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const calls = mockFetch.mock.calls;
      expect(calls[0][0]).toBe("/api/config/extraction-prompt");
    });
  });

  describe("when content is loaded", () => {
    it("displays content in textarea", async () => {
      setupFetchMock({
        content: "Extract facts about the user...",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
        expect(textarea.value).toBe("Extract facts about the user...");
      });
    });

    it("shows Default badge when using default prompt", async () => {
      setupFetchMock({
        content: "Default prompt content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByText("Default")).not.toBeNull();
      });
    });

    it("shows Custom badge when using override", async () => {
      setupFetchMock({
        content: "Custom prompt content",
        isOverride: true,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByText("Custom")).not.toBeNull();
      });
    });

    it("shows correct path for default prompt", async () => {
      setupFetchMock({
        content: "Default prompt content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByText("Built-in default prompt")).not.toBeNull();
      });
    });

    it("shows correct path for override prompt", async () => {
      setupFetchMock({
        content: "Custom prompt content",
        isOverride: true,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByText("~/.config/memory-loop/durable-facts.md")).not.toBeNull();
      });
    });
  });

  describe("editing", () => {
    it("updates content when typing", async () => {
      setupFetchMock({
        content: "Initial content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).not.toBeNull();
      });

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "Updated content" } });

      expect(textarea.value).toBe("Updated content");
    });

    it("enables Save button when content changes", async () => {
      setupFetchMock({
        content: "Initial",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).not.toBeNull();
      });

      // Save button should be disabled initially
      const saveButton = screen.getByRole("button", { name: /save/i });
      expect(saveButton.hasAttribute("disabled")).toBe(true);

      // Edit content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "Changed" } });

      // Save button should be enabled
      expect(saveButton.hasAttribute("disabled")).toBe(false);
    });

    it("discards changes when Discard button is clicked", async () => {
      setupFetchMock({
        content: "Original content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).not.toBeNull();
      });

      // Edit content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "Changed content" } });
      expect(textarea.value).toBe("Changed content");

      // Click discard
      const discardButton = screen.getByRole("button", { name: /discard/i });
      fireEvent.click(discardButton);

      expect(textarea.value).toBe("Original content");
    });
  });

  describe("saving", () => {
    it("calls PUT endpoint when Save is clicked", async () => {
      setupFetchMock({
        content: "Initial",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).not.toBeNull();
      });

      // Clear initial fetch calls
      mockFetch.mockClear();

      // Set up response for save
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              isOverride: true,
            }),
        } as Response)
      );

      // Edit content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "New content" } });

      // Click save
      const saveButton = screen.getByRole("button", { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const calls = mockFetch.mock.calls;
      expect(calls[0][0]).toBe("/api/config/extraction-prompt");
      expect(calls[0][1]?.method).toBe("PUT");
    });

    it("shows 'Saving...' while save is in progress", async () => {
      setupFetchMock({
        content: "Initial",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).not.toBeNull();
      });

      // Make save hang
      mockFetch.mockImplementation(() => new Promise(() => {}));

      // Edit content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "New content" } });

      // Click save
      const saveButton = screen.getByRole("button", { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText("Saving...")).not.toBeNull();
      });
    });

    it("shows error on save failure", async () => {
      setupFetchMock({
        content: "Initial",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).not.toBeNull();
      });

      // Set up failure response
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: false,
              error: "Permission denied",
            }),
        } as Response)
      );

      // Edit and save
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "New content" } });
      const saveButton = screen.getByRole("button", { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByRole("alert")).not.toBeNull();
        expect(screen.getByText("Permission denied")).not.toBeNull();
      });
    });
  });

  describe("reset to default", () => {
    it("shows Reset to Default button when using override", async () => {
      setupFetchMock({
        content: "Custom prompt",
        isOverride: true,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /reset to default/i })).not.toBeNull();
      });
    });

    it("does not show Reset to Default button when using default", async () => {
      setupFetchMock({
        content: "Default prompt",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).not.toBeNull();
      });

      expect(screen.queryByRole("button", { name: /reset to default/i })).toBeNull();
    });

    it("calls DELETE endpoint when Reset is clicked", async () => {
      setupFetchMock({
        content: "Custom prompt",
        isOverride: true,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /reset to default/i })).not.toBeNull();
      });

      // Clear initial fetch
      mockFetch.mockClear();

      // Set up response for reset
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              content: "Default prompt content",
            }),
        } as Response)
      );

      // Click reset
      const resetButton = screen.getByRole("button", { name: /reset to default/i });
      fireEvent.click(resetButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const calls = mockFetch.mock.calls;
      expect(calls[0][0]).toBe("/api/config/extraction-prompt");
      expect(calls[0][1]?.method).toBe("DELETE");
    });

    it("shows 'Resetting...' while reset is in progress", async () => {
      setupFetchMock({
        content: "Custom prompt",
        isOverride: true,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /reset to default/i })).not.toBeNull();
      });

      // Make reset hang
      mockFetch.mockImplementation(() => new Promise(() => {}));

      // Click reset
      const resetButton = screen.getByRole("button", { name: /reset to default/i });
      fireEvent.click(resetButton);

      await waitFor(() => {
        expect(screen.getByText("Resetting...")).not.toBeNull();
      });
    });

    it("updates content after successful reset", async () => {
      setupFetchMock({
        content: "Custom prompt",
        isOverride: true,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /reset to default/i })).not.toBeNull();
      });

      // Set up response for reset
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              content: "Default prompt content",
            }),
        } as Response)
      );

      // Click reset
      const resetButton = screen.getByRole("button", { name: /reset to default/i });
      fireEvent.click(resetButton);

      await waitFor(() => {
        const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
        expect(textarea.value).toBe("Default prompt content");
      });
    });

    it("shows Default badge after successful reset", async () => {
      setupFetchMock({
        content: "Custom prompt",
        isOverride: true,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByText("Custom")).not.toBeNull();
      });

      // Set up response for reset
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              content: "Default prompt content",
            }),
        } as Response)
      );

      // Click reset
      const resetButton = screen.getByRole("button", { name: /reset to default/i });
      fireEvent.click(resetButton);

      await waitFor(() => {
        expect(screen.getByText("Default")).not.toBeNull();
      });
    });

    it("shows error on reset failure", async () => {
      setupFetchMock({
        content: "Custom prompt",
        isOverride: true,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /reset to default/i })).not.toBeNull();
      });

      // Set up failure response
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: false,
              error: "Failed to delete override",
            }),
        } as Response)
      );

      // Click reset
      const resetButton = screen.getByRole("button", { name: /reset to default/i });
      fireEvent.click(resetButton);

      await waitFor(() => {
        expect(screen.getByRole("alert")).not.toBeNull();
        expect(screen.getByText("Failed to delete override")).not.toBeNull();
      });
    });
  });

  describe("error handling", () => {
    it("shows error message on fetch failure", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        } as Response)
      );

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("alert")).not.toBeNull();
      });
    });
  });

  describe("extraction trigger", () => {
    it("shows Run Extraction button", async () => {
      setupFetchMock({
        content: "Prompt content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /run extraction/i })).not.toBeNull();
      });
    });

    it("calls trigger endpoint when Run Extraction is clicked", async () => {
      setupFetchMock({
        content: "Prompt content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /run extraction/i })).not.toBeNull();
      });

      // Clear initial fetch
      mockFetch.mockClear();

      // Set up response for trigger
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: "complete",
              message: "Processed 3 transcripts",
            }),
        } as Response)
      );

      // Click Run Extraction
      const runButton = screen.getByRole("button", { name: /run extraction/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const calls = mockFetch.mock.calls;
      expect(calls[0][0]).toBe("/api/config/extraction-prompt/trigger");
      expect(calls[0][1]?.method).toBe("POST");
    });

    it("shows 'Running...' while extraction is in progress", async () => {
      setupFetchMock({
        content: "Prompt content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /run extraction/i })).not.toBeNull();
      });

      // Make trigger hang
      mockFetch.mockImplementation(() => new Promise(() => {}));

      // Click Run Extraction
      const runButton = screen.getByRole("button", { name: /run extraction/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(screen.getByText("Running...")).not.toBeNull();
      });
    });

    it("disables Run Extraction button while running", async () => {
      setupFetchMock({
        content: "Prompt content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /run extraction/i })).not.toBeNull();
      });

      // Make trigger hang
      mockFetch.mockImplementation(() => new Promise(() => {}));

      // Click Run Extraction
      const runButton = screen.getByRole("button", { name: /run extraction/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /running/i }).hasAttribute("disabled")).toBe(
          true
        );
      });
    });

    it("shows completion message on success", async () => {
      setupFetchMock({
        content: "Prompt content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /run extraction/i })).not.toBeNull();
      });

      // Set up response for trigger
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: "complete",
              message: "Processed 3 transcript(s)",
              transcriptsProcessed: 3,
            }),
        } as Response)
      );

      // Click Run Extraction
      const runButton = screen.getByRole("button", { name: /run extraction/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(screen.getByText("Processed 3 transcript(s)")).not.toBeNull();
      });
    });

    it("shows error on extraction failure", async () => {
      setupFetchMock({
        content: "Prompt content",
        isOverride: false,
      });

      render(<ExtractionPromptEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /run extraction/i })).not.toBeNull();
      });

      // Set up failure response
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: "error",
              message: "Extraction failed",
              error: "No transcripts found",
            }),
        } as Response)
      );

      // Click Run Extraction
      const runButton = screen.getByRole("button", { name: /run extraction/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(screen.getByRole("alert")).not.toBeNull();
        expect(screen.getByText("No transcripts found")).not.toBeNull();
      });
    });

    it("button is disabled while loading prompt", () => {
      // Don't resolve fetch immediately
      mockFetch.mockImplementation(() => new Promise(() => {}));
      render(<ExtractionPromptEditor />);

      // During loading, button should be disabled
      const runButton = screen.getByRole("button", { name: /run extraction/i });
      expect(runButton.hasAttribute("disabled")).toBe(true);
    });
  });
});

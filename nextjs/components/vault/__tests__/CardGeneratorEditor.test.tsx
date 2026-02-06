/**
 * CardGeneratorEditor Component Tests
 *
 * Tests the REST-based card generator editor component.
 */

import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CardGeneratorEditor } from "../CardGeneratorEditor";

describe("CardGeneratorEditor", () => {
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
            requirements: "Default requirements",
            isOverride: false,
            weeklyByteLimit: 512000,
            weeklyBytesUsed: 0,
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
      render(<CardGeneratorEditor />);

      expect(screen.getByText("Loading configuration...")).not.toBeNull();
    });

    it("calls fetch to load config on mount", async () => {
      setupFetchMock({
        requirements: "Test requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const calls = mockFetch.mock.calls;
      expect(calls[0][0]).toBe("/api/config/card-generator");
    });
  });

  describe("when config is loaded", () => {
    it("displays requirements in textarea", async () => {
      setupFetchMock({
        requirements: "Focus on key facts...",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
        expect(textarea.value).toBe("Focus on key facts...");
      });
    });

    it("shows Default badge when using default requirements", async () => {
      setupFetchMock({
        requirements: "Default requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByText("Default")).not.toBeNull();
      });
    });

    it("shows Custom badge when using override", async () => {
      setupFetchMock({
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByText("Custom")).not.toBeNull();
      });
    });

    it("shows correct path for default requirements", async () => {
      setupFetchMock({
        requirements: "Default requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByText("Built-in default requirements")).not.toBeNull();
      });
    });

    it("shows correct path for override requirements", async () => {
      setupFetchMock({
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(
          screen.getByText("~/.config/memory-loop/card-generator-requirements.md")
        ).not.toBeNull();
      });
    });

    it("displays weekly byte limit value", async () => {
      setupFetchMock({
        requirements: "Requirements",
        isOverride: false,
        weeklyByteLimit: 1048576, // 1MB
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByText("1.0 MB")).not.toBeNull();
      });
    });

    it("displays usage percentage", async () => {
      setupFetchMock({
        requirements: "Requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 256000, // 50%
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByText(/50%/)).not.toBeNull();
      });
    });
  });

  describe("editing requirements", () => {
    it("updates content when typing", async () => {
      setupFetchMock({
        requirements: "Initial content",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).not.toBeNull();
      });

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "Updated content" } });

      expect(textarea.value).toBe("Updated content");
    });

    it("enables Save button when content changes", async () => {
      setupFetchMock({
        requirements: "Initial",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

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
        requirements: "Original content",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

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
        requirements: "Initial",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

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
              requirements: "New content",
              isOverride: true,
              weeklyByteLimit: 512000,
              weeklyBytesUsed: 0,
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
      expect(calls[0][0]).toBe("/api/config/card-generator");
      expect(calls[0][1]?.method).toBe("PUT");
    });

    it("shows 'Saving...' while save is in progress", async () => {
      setupFetchMock({
        requirements: "Initial",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

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
        requirements: "Initial",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

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
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /reset to default/i })).not.toBeNull();
      });
    });

    it("does not show Reset to Default button when using default", async () => {
      setupFetchMock({
        requirements: "Default requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).not.toBeNull();
      });

      expect(screen.queryByRole("button", { name: /reset to default/i })).toBeNull();
    });

    it("calls DELETE endpoint when Reset is clicked", async () => {
      setupFetchMock({
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

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
              content: "Default requirements content",
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
      expect(calls[0][0]).toBe("/api/config/card-generator/requirements");
      expect(calls[0][1]?.method).toBe("DELETE");
    });

    it("updates content after successful reset", async () => {
      setupFetchMock({
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

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
              content: "Default requirements content",
            }),
        } as Response)
      );

      // Click reset
      const resetButton = screen.getByRole("button", { name: /reset to default/i });
      fireEvent.click(resetButton);

      await waitFor(() => {
        const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
        expect(textarea.value).toBe("Default requirements content");
      });
    });
  });

  describe("generation trigger", () => {
    it("shows Run Generator button", async () => {
      setupFetchMock({
        requirements: "Requirements content",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /run generator/i })).not.toBeNull();
      });
    });

    it("calls trigger endpoint when Run Generator is clicked", async () => {
      setupFetchMock({
        requirements: "Requirements content",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /run generator/i })).not.toBeNull();
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
              message: "Processed 3 files",
            }),
        } as Response)
      );

      // Click Run Generator
      const runButton = screen.getByRole("button", { name: /run generator/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const calls = mockFetch.mock.calls;
      expect(calls[0][0]).toBe("/api/config/card-generator/trigger");
      expect(calls[0][1]?.method).toBe("POST");
    });

    it("shows 'Running...' while generation is in progress", async () => {
      setupFetchMock({
        requirements: "Requirements content",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /run generator/i })).not.toBeNull();
      });

      // Make trigger hang
      mockFetch.mockImplementation(() => new Promise(() => {}));

      // Click Run Generator
      const runButton = screen.getByRole("button", { name: /run generator/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(screen.getByText("Running...")).not.toBeNull();
      });
    });

    it("disables Run Generator when byte limit is reached", async () => {
      setupFetchMock({
        requirements: "Requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 512000, // 100% used
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        const runButton = screen.getByRole("button", { name: /run generator/i });
        expect(runButton.hasAttribute("disabled")).toBe(true);
      });
    });

    it("shows warning when byte limit is reached", async () => {
      setupFetchMock({
        requirements: "Requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 512000, // 100% used
      });

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByText(/weekly byte limit reached/i)).not.toBeNull();
      });
    });

    it("button is disabled while loading config", () => {
      // Don't resolve fetch immediately
      mockFetch.mockImplementation(() => new Promise(() => {}));
      render(<CardGeneratorEditor />);

      // During loading, button should be disabled
      const runButton = screen.getByRole("button", { name: /run generator/i });
      expect(runButton.hasAttribute("disabled")).toBe(true);
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

      render(<CardGeneratorEditor />);

      await waitFor(() => {
        expect(screen.getByRole("alert")).not.toBeNull();
      });
    });
  });
});

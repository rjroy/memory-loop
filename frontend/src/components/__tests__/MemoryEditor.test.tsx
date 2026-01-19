/**
 * MemoryEditor Component Tests
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ServerMessage, ClientMessage } from "@memory-loop/shared";
import { MemoryEditor } from "../MemoryEditor";

describe("MemoryEditor", () => {
  afterEach(() => {
    cleanup();
  });

  // Helper to create mock sendMessage
  const createMockSendMessage = () => {
    const messages: ClientMessage[] = [];
    return {
      sendMessage: (msg: ClientMessage) => {
        messages.push(msg);
      },
      messages,
    };
  };

  describe("initial state", () => {
    it("shows loading state initially", () => {
      const { sendMessage } = createMockSendMessage();
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={null} />);

      expect(screen.getByText("Loading memory file...")).not.toBeNull();
    });

    it("sends get_memory request on mount", () => {
      const { sendMessage, messages } = createMockSendMessage();
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={null} />);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: "get_memory" });
    });

    it("displays file path", () => {
      const { sendMessage } = createMockSendMessage();
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={null} />);

      expect(screen.getByText("~/.claude/rules/memory.md")).not.toBeNull();
    });
  });

  describe("when content is loaded", () => {
    it("displays content in textarea", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content: "# Test Memory\n\nSome content here",
        sizeBytes: 35,
        exists: true,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={message} />);

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      expect(textarea.value).toBe("# Test Memory\n\nSome content here");
    });

    it("shows size indicator", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content: "Test content",
        sizeBytes: 12,
        exists: true,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={message} />);

      // Should show the current size
      expect(screen.getByText("12 B")).not.toBeNull();
      // Should show the max size
      expect(screen.getByText("50.0 KB")).not.toBeNull();
    });

    it("shows 'New' badge when file does not exist", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content: "",
        sizeBytes: 0,
        exists: false,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText("New")).not.toBeNull();
    });
  });

  describe("editing", () => {
    it("updates content when typing", async () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content: "Initial content",
        sizeBytes: 15,
        exists: true,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={message} />);

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "Updated content" } });

      await waitFor(() => {
        expect(textarea.value).toBe("Updated content");
      });
    });

    it("enables Save button when content changes", async () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content: "Initial",
        sizeBytes: 7,
        exists: true,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={message} />);

      // Save button should be disabled initially
      const saveButton = screen.getByRole("button", { name: /save/i });
      expect(saveButton.hasAttribute("disabled")).toBe(true);

      // Edit content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "Changed" } });

      // Save button should be enabled
      await waitFor(() => {
        expect(saveButton.hasAttribute("disabled")).toBe(false);
      });
    });

    it("resets content when Reset button is clicked", async () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content: "Original content",
        sizeBytes: 16,
        exists: true,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={message} />);

      // Edit content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "Changed content" } });

      await waitFor(() => {
        expect(textarea.value).toBe("Changed content");
      });

      // Click reset
      const resetButton = screen.getByRole("button", { name: /reset/i });
      fireEvent.click(resetButton);

      await waitFor(() => {
        expect(textarea.value).toBe("Original content");
      });
    });
  });

  describe("saving", () => {
    it("sends save_memory message when Save is clicked", async () => {
      const { sendMessage, messages } = createMockSendMessage();
      const loadMessage: ServerMessage = {
        type: "memory_content",
        content: "Initial",
        sizeBytes: 7,
        exists: true,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

      // Clear initial get_memory message
      messages.length = 0;

      // Edit content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "New content" } });

      await waitFor(() => {
        const saveButton = screen.getByRole("button", { name: /save/i });
        expect(saveButton.hasAttribute("disabled")).toBe(false);
      });

      // Click save
      const saveButton = screen.getByRole("button", { name: /save/i });
      fireEvent.click(saveButton);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: "save_memory",
        content: "New content",
      });
    });

    it("shows 'Saving...' while save is in progress", async () => {
      const { sendMessage, messages } = createMockSendMessage();
      const loadMessage: ServerMessage = {
        type: "memory_content",
        content: "Initial",
        sizeBytes: 7,
        exists: true,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

      messages.length = 0;

      // Edit content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "New content" } });

      await waitFor(() => {
        const saveButton = screen.getByRole("button", { name: /save/i });
        expect(saveButton.hasAttribute("disabled")).toBe(false);
      });

      // Click save
      const saveButton = screen.getByRole("button", { name: /save/i });
      fireEvent.click(saveButton);

      expect(screen.getByText("Saving...")).not.toBeNull();
    });

    it("clears saving state on successful save", () => {
      const { sendMessage } = createMockSendMessage();
      // Render with saved message (simulates post-save state)
      const savedMessage: ServerMessage = {
        type: "memory_saved",
        success: true,
        sizeBytes: 11,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={savedMessage} />);

      // Should show "Save" button (not in saving state)
      const saveButton = screen.getByRole("button", { name: "Save" });
      expect(saveButton).not.toBeNull();
    });

    it("shows error on save failure", () => {
      const { sendMessage } = createMockSendMessage();
      const errorMessage: ServerMessage = {
        type: "memory_saved",
        success: false,
        error: "Permission denied",
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={errorMessage} />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Permission denied")).not.toBeNull();
    });
  });

  describe("size limits", () => {
    it("shows warning when approaching limit", () => {
      const { sendMessage } = createMockSendMessage();
      // Content at warning threshold (45KB)
      const largeContent = "x".repeat(45 * 1024);
      const message: ServerMessage = {
        type: "memory_content",
        content: largeContent,
        sizeBytes: 45 * 1024,
        exists: true,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={message} />);

      // The size indicator should have warning styling
      const sizeText = screen.getByText("45.0 KB");
      expect(sizeText.classList.contains("memory-editor__size-current--warning")).toBe(true);
    });

    it("shows error and warning when over limit", async () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content: "Initial",
        sizeBytes: 7,
        exists: true,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={message} />);

      // Type content that exceeds limit
      const overLimitContent = "x".repeat(51 * 1024);
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: overLimitContent } });

      // Should show warning message
      await waitFor(() => {
        expect(screen.getByText(/exceeds 50KB limit/i)).not.toBeNull();
      });
    });

    it("disables Save button when over limit", async () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content: "Initial",
        sizeBytes: 7,
        exists: true,
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={message} />);

      // Type content that exceeds limit
      const overLimitContent = "x".repeat(51 * 1024);
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: overLimitContent } });

      // Save button should be disabled
      await waitFor(() => {
        const saveButton = screen.getByRole("button", { name: /save/i });
        expect(saveButton.hasAttribute("disabled")).toBe(true);
      });
    });
  });

  describe("error handling", () => {
    it("shows error message on error response", () => {
      const { sendMessage } = createMockSendMessage();
      // Simulate error response
      const errorMessage: ServerMessage = {
        type: "error",
        code: "INTERNAL_ERROR",
        message: "Failed to read memory file",
      };
      render(<MemoryEditor sendMessage={sendMessage} lastMessage={errorMessage} />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Failed to read memory file")).not.toBeNull();
    });
  });
});

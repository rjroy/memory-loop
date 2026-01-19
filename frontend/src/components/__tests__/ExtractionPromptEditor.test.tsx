/**
 * ExtractionPromptEditor Component Tests
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ServerMessage, ClientMessage } from "@memory-loop/shared";
import { ExtractionPromptEditor } from "../ExtractionPromptEditor";

describe("ExtractionPromptEditor", () => {
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
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={null} />);

      expect(screen.getByText("Loading extraction prompt...")).not.toBeNull();
    });

    it("sends get_extraction_prompt request on mount", () => {
      const { sendMessage, messages } = createMockSendMessage();
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={null} />);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: "get_extraction_prompt" });
    });
  });

  describe("when content is loaded", () => {
    it("displays content in textarea", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Extract facts about the user...",
        isOverride: false,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={message} />);

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      expect(textarea.value).toBe("Extract facts about the user...");
    });

    it("shows Default badge when using default prompt", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Default prompt content",
        isOverride: false,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText("Default")).not.toBeNull();
    });

    it("shows Custom badge when using override", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Custom prompt content",
        isOverride: true,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText("Custom")).not.toBeNull();
    });

    it("shows correct path for default prompt", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Default prompt content",
        isOverride: false,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText("Built-in default prompt")).not.toBeNull();
    });

    it("shows correct path for override prompt", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Custom prompt content",
        isOverride: true,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText("~/.config/memory-loop/durable-facts.md")).not.toBeNull();
    });
  });

  describe("editing", () => {
    it("updates content when typing", async () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Initial content",
        isOverride: false,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={message} />);

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "Updated content" } });

      await waitFor(() => {
        expect(textarea.value).toBe("Updated content");
      });
    });

    it("enables Save button when content changes", async () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Initial",
        isOverride: false,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={message} />);

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

    it("discards changes when Discard button is clicked", async () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Original content",
        isOverride: false,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={message} />);

      // Edit content
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "Changed content" } });

      await waitFor(() => {
        expect(textarea.value).toBe("Changed content");
      });

      // Click discard
      const discardButton = screen.getByRole("button", { name: /discard/i });
      fireEvent.click(discardButton);

      await waitFor(() => {
        expect(textarea.value).toBe("Original content");
      });
    });
  });

  describe("saving", () => {
    it("sends save_extraction_prompt message when Save is clicked", async () => {
      const { sendMessage, messages } = createMockSendMessage();
      const loadMessage: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Initial",
        isOverride: false,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

      // Clear initial get_extraction_prompt message
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
        type: "save_extraction_prompt",
        content: "New content",
      });
    });

    it("shows 'Saving...' while save is in progress", async () => {
      const { sendMessage, messages } = createMockSendMessage();
      const loadMessage: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Initial",
        isOverride: false,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

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

    it("shows error on save failure", () => {
      const { sendMessage } = createMockSendMessage();
      const errorMessage: ServerMessage = {
        type: "extraction_prompt_saved",
        success: false,
        isOverride: false,
        error: "Permission denied",
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={errorMessage} />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Permission denied")).not.toBeNull();
    });
  });

  describe("reset to default", () => {
    it("shows Reset to Default button when using override", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Custom prompt",
        isOverride: true,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByRole("button", { name: /reset to default/i })).not.toBeNull();
    });

    it("does not show Reset to Default button when using default", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Default prompt",
        isOverride: false,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.queryByRole("button", { name: /reset to default/i })).toBeNull();
    });

    it("sends reset_extraction_prompt message when Reset is clicked", () => {
      const { sendMessage, messages } = createMockSendMessage();
      const loadMessage: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Custom prompt",
        isOverride: true,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

      // Clear initial message
      messages.length = 0;

      // Click reset
      const resetButton = screen.getByRole("button", { name: /reset to default/i });
      fireEvent.click(resetButton);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: "reset_extraction_prompt" });
    });

    it("shows 'Resetting...' while reset is in progress", () => {
      const { sendMessage, messages } = createMockSendMessage();
      const loadMessage: ServerMessage = {
        type: "extraction_prompt_content",
        content: "Custom prompt",
        isOverride: true,
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

      messages.length = 0;

      // Click reset
      const resetButton = screen.getByRole("button", { name: /reset to default/i });
      fireEvent.click(resetButton);

      expect(screen.getByText("Resetting...")).not.toBeNull();
    });

    it("updates content after successful reset", () => {
      const { sendMessage } = createMockSendMessage();
      const resetMessage: ServerMessage = {
        type: "extraction_prompt_reset",
        success: true,
        content: "Default prompt content",
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={resetMessage} />);

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      expect(textarea.value).toBe("Default prompt content");
    });

    it("shows Default badge after successful reset", () => {
      const { sendMessage } = createMockSendMessage();
      const resetMessage: ServerMessage = {
        type: "extraction_prompt_reset",
        success: true,
        content: "Default prompt content",
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={resetMessage} />);

      expect(screen.getByText("Default")).not.toBeNull();
    });

    it("shows error on reset failure", () => {
      const { sendMessage } = createMockSendMessage();
      const errorMessage: ServerMessage = {
        type: "extraction_prompt_reset",
        success: false,
        content: "",
        error: "Failed to delete override",
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={errorMessage} />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Failed to delete override")).not.toBeNull();
    });
  });

  describe("error handling", () => {
    it("shows error message on error response", () => {
      const { sendMessage } = createMockSendMessage();
      const errorMessage: ServerMessage = {
        type: "error",
        code: "INTERNAL_ERROR",
        message: "Failed to read extraction prompt",
      };
      render(<ExtractionPromptEditor sendMessage={sendMessage} lastMessage={errorMessage} />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Failed to read extraction prompt")).not.toBeNull();
    });
  });
});

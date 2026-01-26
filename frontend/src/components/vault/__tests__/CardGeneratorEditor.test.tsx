/**
 * CardGeneratorEditor Component Tests
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ServerMessage, ClientMessage } from "@memory-loop/shared";
import { CardGeneratorEditor } from "../CardGeneratorEditor";

describe("CardGeneratorEditor", () => {
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
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={null} />);

      expect(screen.getByText("Loading configuration...")).not.toBeNull();
    });

    it("sends get_card_generator_config request on mount", () => {
      const { sendMessage, messages } = createMockSendMessage();
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={null} />);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: "get_card_generator_config" });
    });
  });

  describe("when config is loaded", () => {
    it("displays requirements in textarea", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Focus on key facts...",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      expect(textarea.value).toBe("Focus on key facts...");
    });

    it("shows Default badge when using default requirements", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Default requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText("Default")).not.toBeNull();
    });

    it("shows Custom badge when using override", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText("Custom")).not.toBeNull();
    });

    it("shows correct path for default requirements", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Default requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText("Built-in default requirements")).not.toBeNull();
    });

    it("shows correct path for override requirements", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText("~/.config/memory-loop/card-generator-requirements.md")).not.toBeNull();
    });

    it("displays weekly byte limit value", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Requirements",
        isOverride: false,
        weeklyByteLimit: 1048576, // 1MB
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      // Look for the formatted byte value (1 MB)
      expect(screen.getByText("1.0 MB")).not.toBeNull();
    });

    it("displays usage percentage", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 256000, // 50%
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText(/50%/)).not.toBeNull();
    });
  });

  describe("editing requirements", () => {
    it("updates content when typing", async () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Initial content",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      fireEvent.change(textarea, { target: { value: "Updated content" } });

      await waitFor(() => {
        expect(textarea.value).toBe("Updated content");
      });
    });

    it("enables Save button when content changes", async () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Initial",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

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
        type: "card_generator_config_content",
        requirements: "Original content",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

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
    it("sends save_card_generator_requirements message when Save is clicked", async () => {
      const { sendMessage, messages } = createMockSendMessage();
      const loadMessage: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Initial",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

      // Clear initial get_card_generator_config message
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

      // Should send requirements save message
      expect(messages.some(m => m.type === "save_card_generator_requirements")).toBe(true);
    });

    it("shows 'Saving...' while save is in progress", async () => {
      const { sendMessage, messages } = createMockSendMessage();
      const loadMessage: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Initial",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

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
        type: "card_generator_requirements_saved",
        success: false,
        isOverride: false,
        error: "Permission denied",
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={errorMessage} />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Permission denied")).not.toBeNull();
    });
  });

  describe("reset to default", () => {
    it("shows Reset to Default button when using override", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByRole("button", { name: /reset to default/i })).not.toBeNull();
    });

    it("does not show Reset to Default button when using default", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Default requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.queryByRole("button", { name: /reset to default/i })).toBeNull();
    });

    it("sends reset_card_generator_requirements message when Reset is clicked", () => {
      const { sendMessage, messages } = createMockSendMessage();
      const loadMessage: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

      // Clear initial message
      messages.length = 0;

      // Click reset
      const resetButton = screen.getByRole("button", { name: /reset to default/i });
      fireEvent.click(resetButton);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: "reset_card_generator_requirements" });
    });

    it("updates content after successful reset", () => {
      const { sendMessage } = createMockSendMessage();
      // First load with override
      const loadMessage: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      const { rerender } = render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

      // Then send reset
      const resetMessage: ServerMessage = {
        type: "card_generator_requirements_reset",
        success: true,
        content: "Default requirements content",
      };
      rerender(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={resetMessage} />);

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      expect(textarea.value).toBe("Default requirements content");
    });

    it("shows Default badge after successful reset", () => {
      const { sendMessage } = createMockSendMessage();
      // First load with override
      const loadMessage: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Custom requirements",
        isOverride: true,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      const { rerender } = render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

      // Then send reset
      const resetMessage: ServerMessage = {
        type: "card_generator_requirements_reset",
        success: true,
        content: "Default requirements content",
      };
      rerender(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={resetMessage} />);

      expect(screen.getByText("Default")).not.toBeNull();
    });
  });

  describe("generation trigger", () => {
    it("shows Run Generator button", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Requirements content",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByRole("button", { name: /run generator/i })).not.toBeNull();
    });

    it("sends trigger_card_generation message when Run Generator is clicked", () => {
      const { sendMessage, messages } = createMockSendMessage();
      const loadMessage: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Requirements content",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 0,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={loadMessage} />);

      // Clear initial message
      messages.length = 0;

      // Click Run Generator
      const runButton = screen.getByRole("button", { name: /run generator/i });
      fireEvent.click(runButton);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: "trigger_card_generation" });
    });

    it("shows 'Running...' while generation is in progress", () => {
      const { sendMessage } = createMockSendMessage();
      const statusMessage: ServerMessage = {
        type: "card_generation_status",
        status: "running",
        message: "Starting card generation...",
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={statusMessage} />);

      expect(screen.getByText("Running...")).not.toBeNull();
    });

    it("disables Run Generator button while running", () => {
      const { sendMessage } = createMockSendMessage();
      const statusMessage: ServerMessage = {
        type: "card_generation_status",
        status: "running",
        message: "Processing files...",
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={statusMessage} />);

      const runButton = screen.getByRole("button", { name: /running/i });
      expect(runButton.hasAttribute("disabled")).toBe(true);
    });

    it("shows generation status message", () => {
      const { sendMessage } = createMockSendMessage();
      const statusMessage: ServerMessage = {
        type: "card_generation_status",
        status: "running",
        message: "Processing 5 files...",
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={statusMessage} />);

      expect(screen.getByRole("status")).not.toBeNull();
      expect(screen.getByText("Processing 5 files...")).not.toBeNull();
    });

    it("shows completion message on success", () => {
      const { sendMessage } = createMockSendMessage();
      const statusMessage: ServerMessage = {
        type: "card_generation_status",
        status: "complete",
        message: "Processed 3 files, created 10 cards",
        filesProcessed: 3,
        cardsCreated: 10,
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={statusMessage} />);

      expect(screen.getByText("Processed 3 files, created 10 cards")).not.toBeNull();
    });

    it("shows error on generation failure", () => {
      const { sendMessage } = createMockSendMessage();
      const statusMessage: ServerMessage = {
        type: "card_generation_status",
        status: "error",
        message: "Generation failed",
        error: "Weekly byte limit reached",
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={statusMessage} />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Weekly byte limit reached")).not.toBeNull();
    });

    it("disables Run Generator when byte limit is reached", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 512000, // 100% used
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      const runButton = screen.getByRole("button", { name: /run generator/i });
      expect(runButton.hasAttribute("disabled")).toBe(true);
    });

    it("shows warning when byte limit is reached", () => {
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "card_generator_config_content",
        requirements: "Requirements",
        isOverride: false,
        weeklyByteLimit: 512000,
        weeklyBytesUsed: 512000, // 100% used
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={message} />);

      expect(screen.getByText(/weekly byte limit reached/i)).not.toBeNull();
    });

    it("button is disabled while loading config", () => {
      const { sendMessage } = createMockSendMessage();
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={null} />);

      // During loading, button should be disabled
      const runButton = screen.getByRole("button", { name: /run generator/i });
      expect(runButton.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("shows error message on error response", () => {
      const { sendMessage } = createMockSendMessage();
      const errorMessage: ServerMessage = {
        type: "error",
        code: "INTERNAL_ERROR",
        message: "Failed to read card generator config",
      };
      render(<CardGeneratorEditor sendMessage={sendMessage} lastMessage={errorMessage} />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Failed to read card generator config")).not.toBeNull();
    });
  });
});

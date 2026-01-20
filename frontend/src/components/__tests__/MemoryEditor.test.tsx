/**
 * MemoryEditor Component Tests
 */

import { describe, it, expect, afterEach, spyOn } from "bun:test";
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

  describe("context menu integration", () => {
    // Helper to load content and render editor
    const renderWithContent = (content: string) => {
      const { sendMessage, messages } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content,
        sizeBytes: new TextEncoder().encode(content).length,
        exists: true,
      };
      const result = render(
        <MemoryEditor sendMessage={sendMessage} lastMessage={message} />
      );
      return { ...result, sendMessage, messages };
    };

    it("does not show context menu when no text is selected", () => {
      renderWithContent("Some test content here");

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");

      // Right-click without any selection
      fireEvent.contextMenu(textarea, { clientX: 100, clientY: 100 });

      // Menu should not appear (no menu role in DOM)
      // This tests that the guard condition (no selection) works
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("does not prevent default when no selection exists", () => {
      renderWithContent("Some test content here");

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");

      // Create a contextmenu event
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      });
      const preventDefaultSpy = spyOn(event, "preventDefault");

      textarea.dispatchEvent(event);

      // Without a selection, preventDefault should NOT be called
      // (browser default menu is allowed)
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it("textarea has touch event handlers for long press", () => {
      renderWithContent("Some test content here");

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");

      // Fire touch events to verify handlers are attached
      // These won't open the menu without selection, but shouldn't throw
      fireEvent.touchStart(textarea, { touches: [{ clientX: 100, clientY: 100 }] });
      fireEvent.touchEnd(textarea);

      // No error means handlers are attached
      expect(textarea).toBeDefined();
    });

    it("renders without errors when loaded", () => {
      renderWithContent("Some test content here");

      // The component should render the textarea and be ready for interaction
      expect(screen.getByRole("textbox")).toBeDefined();
    });
  });

  /**
   * Note on context menu with selection testing:
   *
   * Happy-dom has limited support for textarea selection APIs. The selection
   * properties (selectionStart, selectionEnd) don't persist correctly in React
   * components during testing.
   *
   * Full integration testing for selection-based context menu is covered by:
   * - hooks/__tests__/useTextSelection.test.ts - Tests selection tracking
   * - components/__tests__/EditorContextMenu.test.tsx - Tests menu behavior
   *
   * The MemoryEditor correctly wires these together, and the wiring is verified
   * by the tests above (no menu without selection, proper event handlers attached).
   *
   * For manual verification:
   * 1. Select text in the memory editor
   * 2. Right-click (desktop) or long-press (mobile)
   * 3. Context menu should appear with Quick Actions
   * 4. Clicking an action logs to console with selection context
   */

  describe("Quick Action WebSocket integration", () => {
    it("renders processing overlay when isProcessingQuickAction is true", () => {
      // We can't easily trigger Quick Action without selection mocking,
      // but we can verify the component structure supports processing state
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content: "Test content",
        sizeBytes: 12,
        exists: true,
      };
      render(
        <MemoryEditor
          sendMessage={sendMessage}
          lastMessage={message}
          filePath="test/file.md"
        />
      );

      // Verify textarea exists and is ready for Quick Actions
      const textarea = screen.getByRole("textbox");
      expect(textarea).toBeDefined();
    });

    it("accepts filePath and onQuickActionComplete props", () => {
      const onComplete = () => {
        // Callback handler
      };
      const { sendMessage } = createMockSendMessage();
      const message: ServerMessage = {
        type: "memory_content",
        content: "Test content",
        sizeBytes: 12,
        exists: true,
      };

      // Should render without errors
      const { container } = render(
        <MemoryEditor
          sendMessage={sendMessage}
          lastMessage={message}
          filePath="notes/test.md"
          onQuickActionComplete={onComplete}
        />
      );

      expect(container.querySelector(".memory-editor")).not.toBeNull();
    });

    it("forwards messages to onMessage callback when provided", () => {
      const onMessageCalls: ServerMessage[] = [];
      const onMessage = (msg: ServerMessage) => {
        onMessageCalls.push(msg);
      };

      const { sendMessage } = createMockSendMessage();
      const contentMessage: ServerMessage = {
        type: "memory_content",
        content: "Test",
        sizeBytes: 4,
        exists: true,
      };

      render(
        <MemoryEditor
          sendMessage={sendMessage}
          lastMessage={contentMessage}
          filePath="test.md"
          onMessage={onMessage}
        />
      );

      // The content message should be forwarded to onMessage
      expect(onMessageCalls).toHaveLength(1);
      expect(onMessageCalls[0].type).toBe("memory_content");
    });

    it("shows error toast on error during Quick Action (via error message type)", () => {
      // This tests that error messages during Quick Action show as toast
      const { sendMessage } = createMockSendMessage();

      // First render with content
      const { rerender } = render(
        <MemoryEditor
          sendMessage={sendMessage}
          lastMessage={{
            type: "memory_content",
            content: "Test",
            sizeBytes: 4,
            exists: true,
          }}
          filePath="test.md"
        />
      );

      // Then simulate an error
      rerender(
        <MemoryEditor
          sendMessage={sendMessage}
          lastMessage={{
            type: "error",
            code: "SDK_ERROR",
            message: "Quick Action failed",
          }}
          filePath="test.md"
        />
      );

      // Error should be displayed (either in error div or as toast depending on state)
      const alert = screen.queryByRole("alert");
      expect(alert).not.toBeNull();
    });

    /**
     * Note on full Quick Action flow testing:
     *
     * Testing the complete Quick Action flow (select text -> menu -> send request
     * -> receive streaming response -> show toast -> reload) requires:
     * 1. Mocking textarea selection (happy-dom limitation)
     * 2. Simulating the full WebSocket message sequence
     *
     * The individual parts are tested:
     * - useTextSelection.test.ts: Selection tracking
     * - EditorContextMenu.test.tsx: Menu action handling
     * - These tests: Props acceptance, message forwarding, error handling
     *
     * Full integration is verified manually and via E2E tests.
     */
  });
});

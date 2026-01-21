/**
 * Tests for PairWritingEditor component
 *
 * Tests cover:
 * - Initial rendering with props
 * - Content state management
 * - Context menu interactions (right-click, long-press)
 * - Quick Action flow (send message, processing state, response handling)
 * - Advisory Action delegation
 * - Toast notifications
 * - Error handling
 *
 * Uses dependency injection for ContextMenuComponent and ToastComponent to avoid
 * mock.module pollution between test files.
 *
 * @see .sdd/specs/memory-loop/2026-01-20-pair-writing-mode.md REQ-F-4, REQ-F-6, REQ-F-7, REQ-F-8, REQ-F-15
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ServerMessage, ClientMessage } from "@memory-loop/shared";
import { PairWritingEditor } from "../PairWritingEditor";
import type {
  EditorContextMenuProps,
  QuickActionType,
  AdvisoryActionType,
} from "../EditorContextMenu";
import type { ToastProps } from "../Toast";

// =============================================================================
// Mock Components - Injected via props (no mock.module)
// =============================================================================

// Track captured callbacks from MockContextMenu
let capturedOnAction: ((action: QuickActionType) => void) | null = null;
let capturedOnAdvisoryAction: ((action: AdvisoryActionType) => void) | null = null;

/**
 * Mock context menu component injected via props.
 * Matches EditorContextMenuProps signature for type compatibility.
 */
function MockContextMenu({
  isOpen,
  onAction,
  onAdvisoryAction,
  onDismiss,
  hasSnapshot,
}: EditorContextMenuProps) {
  capturedOnAction = onAction;
  capturedOnAdvisoryAction = onAdvisoryAction ?? null;
  return isOpen ? (
    <div data-testid="context-menu" data-has-snapshot={hasSnapshot}>
      <button data-testid="action-tighten" onClick={() => onAction("tighten")}>Tighten</button>
      <button data-testid="action-embellish" onClick={() => onAction("embellish")}>Embellish</button>
      <button data-testid="advisory-validate" onClick={() => onAdvisoryAction?.("validate")}>Validate</button>
      <button data-testid="menu-dismiss" onClick={onDismiss}>Dismiss</button>
    </div>
  ) : null;
}

/**
 * Mock toast component injected via props.
 * Matches ToastProps signature for type compatibility.
 */
function MockToast({ isVisible, message, variant }: ToastProps) {
  return isVisible ? (
    <div data-testid="toast" data-variant={variant}>
      {message}
    </div>
  ) : null;
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createDefaultProps() {
  return {
    initialContent: "# Test Document\n\nThis is test content.\n\nMore content here.",
    filePath: "notes/test-file.md",
    sendMessage: mock<(message: ClientMessage) => void>(() => {}),
    lastMessage: null as ServerMessage | null,
    onContentChange: mock<(content: string) => void>(() => {}),
    onQuickActionComplete: mock<(path: string) => void>(() => {}),
    onAdvisoryAction: mock(() => {}),
    hasSnapshot: false,
    // Inject mock components to avoid mock.module pollution
    ContextMenuComponent: MockContextMenu,
    ToastComponent: MockToast,
  };
}

/**
 * Gets the textarea element and casts to correct type.
 * getByRole returns HTMLElement but we know it's a textarea.
 */
function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox");
}

/**
 * Helper to simulate text selection in the textarea.
 * Sets selectionStart/End and dispatches a select event.
 */
function simulateTextSelection(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number
) {
  textarea.selectionStart = start;
  textarea.selectionEnd = end;
  fireEvent.select(textarea);
}

beforeEach(() => {
  capturedOnAction = null;
  capturedOnAdvisoryAction = null;
});

afterEach(() => {
  cleanup();
});

// =============================================================================
// Initial Rendering Tests
// =============================================================================

describe("PairWritingEditor - rendering", () => {
  it("renders with initial content", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    const textarea = getTextarea();
    expect(textarea).toBeDefined();
    expect(textarea.value).toBe(props.initialContent);
  });

  it("renders textarea with correct aria-label", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    const textarea = screen.getByLabelText("Document editor");
    expect(textarea).toBeDefined();
  });

  it("does not render Toast initially", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    expect(screen.queryByTestId("toast")).toBeNull();
  });

  it("does not render context menu initially", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    expect(screen.queryByTestId("context-menu")).toBeNull();
  });

  it("passes hasSnapshot to EditorContextMenu", () => {
    const props = createDefaultProps();
    props.hasSnapshot = true;

    render(<PairWritingEditor {...props} />);

    // Select text to enable context menu
    const textarea = getTextarea();
    simulateTextSelection(textarea, 0, 15); // Select "# Test Document"

    // Trigger context menu
    fireEvent.contextMenu(textarea);

    const menu = screen.getByTestId("context-menu");
    expect(menu.getAttribute("data-has-snapshot")).toBe("true");
  });
});

// =============================================================================
// Content Management Tests
// =============================================================================

describe("PairWritingEditor - content management", () => {
  it("updates content on textarea change", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "New content" } });

    expect(textarea.value).toBe("New content");
  });

  it("calls onContentChange when content changes", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "Updated content" } });

    expect(props.onContentChange).toHaveBeenCalledWith("Updated content");
  });

  it("updates content when initialContent prop changes", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} />);

    // Verify initial content
    let textarea = getTextarea();
    expect(textarea.value).toBe(props.initialContent);

    // Rerender with new initialContent
    rerender(<PairWritingEditor {...props} initialContent="Reloaded content" />);

    textarea = getTextarea();
    expect(textarea.value).toBe("Reloaded content");
  });
});

// =============================================================================
// Context Menu Tests
// =============================================================================

describe("PairWritingEditor - context menu", () => {
  it("opens context menu on right-click when text is selected", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    const textarea = getTextarea();

    // Select some text first
    simulateTextSelection(textarea, 0, 15); // Select "# Test Document"

    // Then right-click
    fireEvent.contextMenu(textarea);

    expect(screen.getByTestId("context-menu")).toBeDefined();
  });

  it("does not open context menu when no selection", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    const textarea = getTextarea();

    // No selection (cursor only)
    simulateTextSelection(textarea, 5, 5);

    fireEvent.contextMenu(textarea);

    expect(screen.queryByTestId("context-menu")).toBeNull();
  });

  it("closes context menu when dismissed", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Open menu
    const textarea = getTextarea();
    simulateTextSelection(textarea, 0, 15);
    fireEvent.contextMenu(textarea);
    expect(screen.getByTestId("context-menu")).toBeDefined();

    // Dismiss menu
    fireEvent.click(screen.getByTestId("menu-dismiss"));
    expect(screen.queryByTestId("context-menu")).toBeNull();
  });

  it("prevents default context menu behavior when selection exists", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    const textarea = getTextarea();
    simulateTextSelection(textarea, 0, 15);

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const preventDefaultSpy = spyOn(event, "preventDefault");

    textarea.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});

// =============================================================================
// Quick Action Flow Tests (REQ-F-4, REQ-F-7, REQ-F-8)
// =============================================================================

describe("PairWritingEditor - Quick Action flow", () => {
  it("sends quick_action_request when Quick Action selected (REQ-F-4)", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Open menu and trigger action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 17, 37); // Select "This is test content"
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    expect(props.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "quick_action_request",
        action: "tighten",
        selection: "This is test content",
        filePath: "notes/test-file.md",
      })
    );
  });

  it("shows processing state during Quick Action (REQ-F-7)", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Trigger Quick Action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    // Check processing state
    expect(screen.getByText("Applying changes...")).toBeDefined();
    expect(document.querySelector(".pair-writing-editor--processing")).not.toBeNull();
  });

  it("disables textarea during processing", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Trigger Quick Action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    expect(textarea.disabled).toBe(true);
  });

  it("closes context menu after Quick Action selection", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Open menu
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    expect(screen.getByTestId("context-menu")).toBeDefined();

    // Select action
    fireEvent.click(screen.getByTestId("action-tighten"));

    // Menu should be closed
    expect(screen.queryByTestId("context-menu")).toBeNull();
  });

  it("does not send message if no selection when action triggered", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Open menu with selection
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);

    // Clear selection before action
    simulateTextSelection(textarea, 5, 5); // No selection

    // Trigger action via captured callback
    if (capturedOnAction) {
      capturedOnAction("tighten");
    }

    expect(props.sendMessage).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Quick Action Response Handling Tests (REQ-F-6, REQ-F-8)
// =============================================================================

describe("PairWritingEditor - Quick Action response handling", () => {
  it("tracks message ID from response_start", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} />);

    // Trigger Quick Action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    // Simulate response_start
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{
          type: "response_start",
          messageId: "msg_123",
        }}
      />
    );

    // Processing should still be active
    expect(screen.getByText("Applying changes...")).toBeDefined();
  });

  it("accumulates response chunks", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} />);

    // Trigger Quick Action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    // Simulate response_start
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{
          type: "response_start",
          messageId: "msg_123",
        }}
      />
    );

    // Simulate response chunks
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{
          type: "response_chunk",
          messageId: "msg_123",
          content: "Tightened ",
        }}
      />
    );

    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{
          type: "response_chunk",
          messageId: "msg_123",
          content: "the text.",
        }}
      />
    );

    // Simulate response_end
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{
          type: "response_end",
          messageId: "msg_123",
        }}
      />
    );

    // Toast should show accumulated text
    const toast = screen.getByTestId("toast");
    expect(toast).toBeDefined();
    expect(toast.textContent).toBe("Tightened the text.");
  });

  it("shows success toast on response_end with confirmation (REQ-F-6)", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} />);

    // Trigger Quick Action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    // Simulate response flow
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_start", messageId: "msg_123" }}
      />
    );

    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_chunk", messageId: "msg_123", content: "Done!" }}
      />
    );

    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_end", messageId: "msg_123" }}
      />
    );

    const toast = screen.getByTestId("toast");
    expect(toast.getAttribute("data-variant")).toBe("success");
  });

  it("calls onQuickActionComplete on response_end (REQ-F-8)", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} />);

    // Trigger Quick Action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    // Simulate response flow
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_start", messageId: "msg_123" }}
      />
    );

    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_chunk", messageId: "msg_123", content: "OK" }}
      />
    );

    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_end", messageId: "msg_123" }}
      />
    );

    expect(props.onQuickActionComplete).toHaveBeenCalledWith("notes/test-file.md");
  });

  it("clears processing state on response_end", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} />);

    // Trigger Quick Action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    expect(textarea.disabled).toBe(true);

    // Simulate response flow
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_start", messageId: "msg_123" }}
      />
    );

    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_chunk", messageId: "msg_123", content: "OK" }}
      />
    );

    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_end", messageId: "msg_123" }}
      />
    );

    // Get fresh reference after rerender
    const textareaAfter = getTextarea();
    expect(textareaAfter.disabled).toBe(false);
    expect(document.querySelector(".pair-writing-editor--processing")).toBeNull();
  });

  it("does not show toast if confirmation is empty", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} />);

    // Trigger Quick Action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    // Simulate response with no chunks
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_start", messageId: "msg_123" }}
      />
    );

    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{ type: "response_end", messageId: "msg_123" }}
      />
    );

    expect(screen.queryByTestId("toast")).toBeNull();
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("PairWritingEditor - error handling", () => {
  it("clears processing state on error message", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} />);

    // Trigger Quick Action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    expect(textarea.disabled).toBe(true);

    // Simulate error
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{
          type: "error",
          code: "SDK_ERROR",
          message: "Something went wrong",
        }}
      />
    );

    const textareaAfter = getTextarea();
    expect(textareaAfter.disabled).toBe(false);
  });

  it("shows error toast on error message", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} />);

    // Trigger Quick Action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    // Simulate error
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{
          type: "error",
          code: "SDK_ERROR",
          message: "Connection lost",
        }}
      />
    );

    const toast = screen.getByTestId("toast");
    expect(toast).toBeDefined();
    expect(toast.textContent).toBe("Connection lost");
    expect(toast.getAttribute("data-variant")).toBe("error");
  });

  it("ignores messages when not processing Quick Action", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} />);

    // Simulate response without having triggered a Quick Action
    rerender(
      <PairWritingEditor
        {...props}
        lastMessage={{
          type: "response_chunk",
          messageId: "msg_123",
          content: "Random chunk",
        }}
      />
    );

    // Should not show toast or enter processing state
    expect(screen.queryByTestId("toast")).toBeNull();
    expect(document.querySelector(".pair-writing-editor--processing")).toBeNull();
  });
});

// =============================================================================
// Advisory Action Tests (REQ-F-15)
// =============================================================================

describe("PairWritingEditor - Advisory Actions (REQ-F-15)", () => {
  it("calls onAdvisoryAction with action and selection", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Open menu and trigger advisory action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 17, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("advisory-validate"));

    expect(props.onAdvisoryAction).toHaveBeenCalledWith(
      "validate",
      expect.objectContaining({
        text: "This is test content",
      })
    );
  });

  it("closes menu after Advisory Action selection", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Open menu
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    expect(screen.getByTestId("context-menu")).toBeDefined();

    // Select advisory action
    fireEvent.click(screen.getByTestId("advisory-validate"));

    expect(screen.queryByTestId("context-menu")).toBeNull();
  });

  it("does not call onAdvisoryAction if no selection", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Open menu with selection
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);

    // Clear selection before action
    simulateTextSelection(textarea, 5, 5);

    // Trigger advisory action via captured callback
    if (capturedOnAdvisoryAction) {
      capturedOnAdvisoryAction("validate");
    }

    expect(props.onAdvisoryAction).not.toHaveBeenCalled();
  });

  it("does not enter processing state for Advisory Actions", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Trigger advisory action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 18, 37);
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("advisory-validate"));

    // Should NOT show processing state (Advisory Actions are handled by parent)
    expect(document.querySelector(".pair-writing-editor--processing")).toBeNull();
    expect(screen.queryByText("Applying changes...")).toBeNull();
  });
});

// =============================================================================
// Quick Action Types Tests
// =============================================================================

describe("PairWritingEditor - Quick Action types", () => {
  const actions: Array<"tighten" | "embellish" | "correct" | "polish"> = [
    "tighten",
    "embellish",
    "correct",
    "polish",
  ];

  for (const action of actions) {
    it(`sends correct action type for ${action}`, () => {
      const props = createDefaultProps();
      render(<PairWritingEditor {...props} />);

      // Open menu and trigger action via captured callback
      const textarea = getTextarea();
      simulateTextSelection(textarea, 18, 37);
      fireEvent.contextMenu(textarea);

      if (capturedOnAction) {
        capturedOnAction(action);
      }

      expect(props.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "quick_action_request",
          action: action,
        })
      );
    });
  }
});

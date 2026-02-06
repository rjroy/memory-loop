/**
 * Tests for PairWritingEditor component
 *
 * Tests cover:
 * - Initial rendering with props
 * - Content state management
 * - Context menu interactions (right-click, openMenuTrigger prop)
 * - Quick Action flow (send message, processing state, response handling)
 * - Advisory Action delegation
 * - Error handling
 *
 * Uses dependency injection for ContextMenuComponent to avoid
 * mock.module pollution between test files.
 *
 * @see .sdd/specs/memory-loop/2026-01-20-pair-writing-mode.md REQ-F-4, REQ-F-7, REQ-F-8, REQ-F-15
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PairWritingEditor } from "../PairWritingEditor";
import type {
  EditorContextMenuProps,
  QuickActionType,
  AdvisoryActionType,
} from "../../shared/EditorContextMenu";
import type { SelectionContext } from "../../../hooks/useTextSelection";

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

// =============================================================================
// Test Fixtures
// =============================================================================

function createDefaultProps() {
  return {
    initialContent: "# Test Document\n\nThis is test content.\n\nMore content here.",
    filePath: "notes/test-file.md",
    onQuickAction: mock<(action: QuickActionType, selection: SelectionContext) => void>(() => {}),
    onContentChange: mock<(content: string) => void>(() => {}),
    onQuickActionComplete: mock<(path: string) => void>(() => {}),
    onAdvisoryAction: mock<(action: AdvisoryActionType, selection: SelectionContext) => void>(() => {}),
    hasSnapshot: false,
    // Inject mock component to avoid mock.module pollution
    ContextMenuComponent: MockContextMenu,
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

  it("opens context menu when openMenuTrigger prop increments (for toolbar Actions button)", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} openMenuTrigger={0} />);

    const textarea = getTextarea();

    // Select some text first
    simulateTextSelection(textarea, 0, 15);

    // Menu should not be open yet
    expect(screen.queryByTestId("context-menu")).toBeNull();

    // Increment the trigger to open menu
    rerender(<PairWritingEditor {...props} openMenuTrigger={1} />);

    expect(screen.getByTestId("context-menu")).toBeDefined();
  });

  it("does not open context menu via trigger when no selection exists", () => {
    const props = createDefaultProps();
    const { rerender } = render(<PairWritingEditor {...props} openMenuTrigger={0} />);

    const textarea = getTextarea();

    // No selection (cursor only)
    simulateTextSelection(textarea, 5, 5);

    // Increment the trigger
    rerender(<PairWritingEditor {...props} openMenuTrigger={1} />);

    // Menu should not open without selection
    expect(screen.queryByTestId("context-menu")).toBeNull();
  });
});

// =============================================================================
// Quick Action Flow Tests (REQ-F-4, REQ-F-7, REQ-F-8)
// =============================================================================

describe("PairWritingEditor - Quick Action flow", () => {
  it("calls onQuickAction when Quick Action selected (REQ-F-4)", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Open menu and trigger action
    const textarea = getTextarea();
    simulateTextSelection(textarea, 17, 37); // Select "This is test content"
    fireEvent.contextMenu(textarea);
    fireEvent.click(screen.getByTestId("action-tighten"));

    expect(props.onQuickAction).toHaveBeenCalledWith(
      "tighten",
      expect.objectContaining({
        text: "This is test content",
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

    expect(props.onQuickAction).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("PairWritingEditor - error handling", () => {
  it("does not enter processing state without Quick Action", () => {
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} />);

    // Without triggering a Quick Action, processing state should not be active
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
    it(`calls onQuickAction with correct action type for ${action}`, () => {
      const props = createDefaultProps();
      render(<PairWritingEditor {...props} />);

      // Open menu and trigger action via captured callback
      const textarea = getTextarea();
      simulateTextSelection(textarea, 18, 37);
      fireEvent.contextMenu(textarea);

      if (capturedOnAction) {
        capturedOnAction(action);
      }

      expect(props.onQuickAction).toHaveBeenCalledWith(
        action,
        expect.objectContaining({
          text: expect.any(String),
        })
      );
    });
  }
});

/**
 * Integration tests for vi mode in PairWritingEditor.
 *
 * Tests the full vi mode integration including:
 * - Gating on viModeEnabled prop and keyboard detection
 * - Mode indicator visibility
 * - Block cursor overlay rendering
 * - Command line for ex commands
 * - Interaction with Quick Actions (processing state blocks vi mode)
 *
 * These tests verify the wiring between:
 * - PairWritingEditor component
 * - useViMode hook
 * - useViCursor hook
 * - useHasKeyboard hook
 * - Vi UI components (ViCursor, ViModeIndicator, ViCommandLine)
 *
 * @see .lore/specs/vi-mode-pair-writing.md
 * @see .lore/work/vi-mode-pair-writing.md (Chunk 14)
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { ServerMessage, ClientMessage } from "@/lib/schemas";
import { PairWritingEditor } from "../PairWritingEditor";
import type { EditorContextMenuProps } from "../../shared/EditorContextMenu";

// =============================================================================
// Mock keyboard detection
// =============================================================================

// We need to mock the keyboard detection to control whether vi mode activates.
// The useHasKeyboard hook checks matchMedia and maxTouchPoints.

// Store original values to restore after tests
const originalMatchMedia = window.matchMedia;
const originalMaxTouchPoints = navigator.maxTouchPoints;

function setupKeyboardMock(hasKeyboard: boolean) {
  // Mock matchMedia to return hasKeyboard for "(pointer: fine)"
  window.matchMedia = (query: string): MediaQueryList => {
    if (query === "(pointer: fine)") {
      return {
        matches: hasKeyboard,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      };
    }
    return originalMatchMedia(query);
  };

  // Mock maxTouchPoints
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: hasKeyboard ? 0 : 5, // 0 = no touch, 5 = touch device
    configurable: true,
  });
}

function restoreKeyboardMock() {
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: originalMaxTouchPoints,
    configurable: true,
  });
}

// =============================================================================
// Mock Components
// =============================================================================

/**
 * Mock context menu component - required because PairWritingEditor expects it.
 */
function MockContextMenu({
  isOpen,
  onDismiss,
}: EditorContextMenuProps): React.ReactNode {
  return isOpen ? (
    <div data-testid="context-menu">
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  ) : null;
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createDefaultProps() {
  return {
    initialContent: "Hello world\nSecond line\nThird line",
    filePath: "notes/test.md",
    sendMessage: mock<(message: ClientMessage) => void>(() => {}),
    lastMessage: null as ServerMessage | null,
    onContentChange: mock<(content: string) => void>(() => {}),
    ContextMenuComponent: MockContextMenu,
    viModeEnabled: true,
    onSave: mock<() => void>(() => {}),
    onExit: mock<() => void>(() => {}),
    onQuitWithUnsaved: mock<() => void>(() => {}),
  };
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Document editor" });
}

// =============================================================================
// Setup/Teardown
// =============================================================================

beforeEach(() => {
  setupKeyboardMock(true); // Default: keyboard available
});

afterEach(() => {
  cleanup();
  restoreKeyboardMock();
});

// =============================================================================
// Vi Mode Gating Tests
// =============================================================================

describe("vi mode gating", () => {
  it("shows mode indicator when viModeEnabled is true and keyboard detected", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    // Mode indicator should be visible
    const indicator = screen.getByText("-- NORMAL --");
    expect(indicator).toBeDefined();
  });

  it("hides mode indicator when viModeEnabled is false", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={false} />);

    // Mode indicator should not be visible
    expect(screen.queryByText("-- NORMAL --")).toBeNull();
  });

  it("hides mode indicator when no keyboard detected", () => {
    setupKeyboardMock(false); // Touch-only device
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    // Mode indicator should not be visible (vi mode disabled)
    expect(screen.queryByText("-- NORMAL --")).toBeNull();
  });

  it("shows block cursor overlay in normal mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    // Block cursor should be visible in normal mode
    const cursor = screen.getByTestId("vi-cursor");
    expect(cursor).toBeDefined();
  });

  it("hides block cursor when vi mode disabled", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={false} />);

    // Block cursor should not exist
    expect(screen.queryByTestId("vi-cursor")).toBeNull();
  });
});

// =============================================================================
// Mode Transitions via Keys
// =============================================================================

describe("mode transitions", () => {
  it("transitions to insert mode when 'i' is pressed", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    // Start in normal mode
    expect(screen.getByText("-- NORMAL --")).toBeDefined();

    // Press 'i' to enter insert mode
    const textarea = getTextarea();
    act(() => {
      fireEvent.keyDown(textarea, { key: "i" });
    });

    // Should now show insert mode
    expect(screen.getByText("-- INSERT --")).toBeDefined();
  });

  it("returns to normal mode when Escape is pressed in insert mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Enter insert mode
    act(() => {
      fireEvent.keyDown(textarea, { key: "i" });
    });
    expect(screen.getByText("-- INSERT --")).toBeDefined();

    // Press Escape to return to normal mode
    act(() => {
      fireEvent.keyDown(textarea, { key: "Escape" });
    });
    expect(screen.getByText("-- NORMAL --")).toBeDefined();
  });

  it("hides block cursor in insert mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    // Cursor visible in normal mode
    expect(screen.getByTestId("vi-cursor")).toBeDefined();

    // Enter insert mode
    const textarea = getTextarea();
    act(() => {
      fireEvent.keyDown(textarea, { key: "i" });
    });

    // Cursor should be hidden in insert mode
    expect(screen.queryByTestId("vi-cursor")).toBeNull();
  });

  it("shows block cursor again after returning to normal mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Enter and exit insert mode
    act(() => {
      fireEvent.keyDown(textarea, { key: "i" });
    });
    expect(screen.queryByTestId("vi-cursor")).toBeNull();

    act(() => {
      fireEvent.keyDown(textarea, { key: "Escape" });
    });
    expect(screen.getByTestId("vi-cursor")).toBeDefined();
  });
});

// =============================================================================
// Command Mode Tests
// =============================================================================

describe("command mode", () => {
  it("enters command mode when ':' is pressed in normal mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();
    act(() => {
      fireEvent.keyDown(textarea, { key: ":" });
    });

    // Should show command mode indicator
    expect(screen.getByText(/-- COMMAND --/)).toBeDefined();
  });

  it("shows command line input in command mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();
    act(() => {
      fireEvent.keyDown(textarea, { key: ":" });
    });

    // Command line should be visible
    const commandLine = screen.getByTestId("vi-command-line");
    expect(commandLine).toBeDefined();
  });

  it("hides command line when not in command mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    // In normal mode, command line should not be visible
    expect(screen.queryByTestId("vi-command-line")).toBeNull();
  });

  it("returns to normal mode when Escape pressed in command mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Enter command mode
    act(() => {
      fireEvent.keyDown(textarea, { key: ":" });
    });
    expect(screen.getByTestId("vi-command-line")).toBeDefined();

    // Press Escape
    act(() => {
      fireEvent.keyDown(textarea, { key: "Escape" });
    });

    // Should be back in normal mode, command line hidden
    expect(screen.queryByTestId("vi-command-line")).toBeNull();
    expect(screen.getByText("-- NORMAL --")).toBeDefined();
  });
});

// =============================================================================
// Ex Command Callbacks
// =============================================================================

describe("ex command callbacks", () => {
  it("calls onSave when :w command is executed", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Enter command mode and type :w<Enter>
    // Each keypress needs separate act() because state must update between
    void act(() => fireEvent.keyDown(textarea, { key: ":" }));
    void act(() => fireEvent.keyDown(textarea, { key: "w" }));
    void act(() => fireEvent.keyDown(textarea, { key: "Enter" }));

    expect(props.onSave).toHaveBeenCalled();
  });

  it("calls onSave and onExit when :wq command is executed", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Enter command mode and type :wq<Enter>
    void act(() => fireEvent.keyDown(textarea, { key: ":" }));
    void act(() => fireEvent.keyDown(textarea, { key: "w" }));
    void act(() => fireEvent.keyDown(textarea, { key: "q" }));
    void act(() => fireEvent.keyDown(textarea, { key: "Enter" }));

    expect(props.onSave).toHaveBeenCalled();
    expect(props.onExit).toHaveBeenCalled();
  });

  it("calls onQuitWithUnsaved when :q command is executed", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Enter command mode and type :q<Enter>
    void act(() => fireEvent.keyDown(textarea, { key: ":" }));
    void act(() => fireEvent.keyDown(textarea, { key: "q" }));
    void act(() => fireEvent.keyDown(textarea, { key: "Enter" }));

    expect(props.onQuitWithUnsaved).toHaveBeenCalled();
  });

  it("calls onExit directly when :q! command is executed", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Enter command mode and type :q!<Enter>
    void act(() => fireEvent.keyDown(textarea, { key: ":" }));
    void act(() => fireEvent.keyDown(textarea, { key: "q" }));
    void act(() => fireEvent.keyDown(textarea, { key: "!" }));
    void act(() => fireEvent.keyDown(textarea, { key: "Enter" }));

    expect(props.onExit).toHaveBeenCalled();
  });
});

// =============================================================================
// Content Change Propagation
// =============================================================================

describe("content change propagation", () => {
  it("calls onContentChange when vi mode modifies content via 'o' command", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Position cursor on first line
    act(() => {
      textarea.setSelectionRange(5, 5);
      fireEvent.select(textarea);
    });

    // Press 'o' to open new line below
    act(() => {
      fireEvent.keyDown(textarea, { key: "o" });
    });

    // Content should have been updated with new line
    expect(props.onContentChange).toHaveBeenCalled();
  });

  it("calls onContentChange when vi mode deletes content via 'x' command", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Position cursor at start
    act(() => {
      textarea.setSelectionRange(0, 0);
      fireEvent.select(textarea);
    });

    // Press 'x' to delete character
    act(() => {
      fireEvent.keyDown(textarea, { key: "x" });
    });

    // Content should have been updated
    expect(props.onContentChange).toHaveBeenCalled();
  });
});

// =============================================================================
// CSS Class Application
// =============================================================================

describe("CSS class application", () => {
  it("adds vi-normal class to textarea in normal mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();
    expect(textarea.classList.contains("pair-writing-editor__textarea--vi-normal")).toBe(
      true
    );
  });

  it("removes vi-normal class in insert mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();
    act(() => {
      fireEvent.keyDown(textarea, { key: "i" });
    });

    expect(textarea.classList.contains("pair-writing-editor__textarea--vi-normal")).toBe(
      false
    );
  });

  it("adds vi-command class in command mode", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();
    act(() => {
      fireEvent.keyDown(textarea, { key: ":" });
    });

    expect(textarea.classList.contains("pair-writing-editor__textarea--vi-command")).toBe(
      true
    );
  });

  it("does not add vi classes when vi mode disabled", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={false} />);

    const textarea = getTextarea();
    expect(textarea.classList.contains("pair-writing-editor__textarea--vi-normal")).toBe(
      false
    );
    expect(textarea.classList.contains("pair-writing-editor__textarea--vi-command")).toBe(
      false
    );
  });
});

// =============================================================================
// Movement Commands Affect Cursor Position
// =============================================================================

describe("movement commands update cursor", () => {
  it("updates cursor position after movement command 'l'", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Start at position 0
    act(() => {
      textarea.setSelectionRange(0, 0);
      fireEvent.select(textarea);
    });

    // Move right with 'l'
    act(() => {
      fireEvent.keyDown(textarea, { key: "l" });
    });

    // Cursor should have moved
    expect(textarea.selectionStart).toBe(1);
  });

  it("updates cursor position after movement command 'h'", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Start at position 5
    act(() => {
      textarea.setSelectionRange(5, 5);
      fireEvent.select(textarea);
    });

    // Move left with 'h'
    act(() => {
      fireEvent.keyDown(textarea, { key: "h" });
    });

    // Cursor should have moved
    expect(textarea.selectionStart).toBe(4);
  });
});

// =============================================================================
// Normal Input When Vi Mode Disabled
// =============================================================================

describe("normal input when vi mode disabled", () => {
  it("allows normal typing when viModeEnabled is false", () => {
    setupKeyboardMock(true);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={false} />);

    const textarea = getTextarea();

    // Type characters - they should be inserted normally
    act(() => {
      fireEvent.change(textarea, { target: { value: "Hello world\nSecond line\nThird linex" } });
    });

    // Content should be updated
    expect(textarea.value).toBe("Hello world\nSecond line\nThird linex");
    expect(props.onContentChange).toHaveBeenCalledWith(
      "Hello world\nSecond line\nThird linex"
    );
  });

  it("allows normal typing when no keyboard detected", () => {
    setupKeyboardMock(false);
    const props = createDefaultProps();
    render(<PairWritingEditor {...props} viModeEnabled={true} />);

    const textarea = getTextarea();

    // Type characters - they should be inserted normally even with viModeEnabled
    act(() => {
      fireEvent.change(textarea, { target: { value: "Modified content" } });
    });

    expect(textarea.value).toBe("Modified content");
    expect(props.onContentChange).toHaveBeenCalledWith("Modified content");
  });
});

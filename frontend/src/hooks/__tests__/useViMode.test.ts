/**
 * useViMode Hook Tests
 *
 * Tests the vi mode state machine: mode transitions between normal, insert, and command.
 * Also tests movement commands (h, j, k, l, 0, $), delete commands (x, dd),
 * yank/put commands (yy, p, P), and undo.
 *
 * @see .lore/plans/vi-mode-pair-writing.md
 * @see REQ-4: Support three modes: Normal (default), Insert, and Command
 * @see REQ-6: Esc returns to Normal mode from Insert or Command mode
 * @see REQ-7: Movement: h (left), j (down), k (up), l (right)
 * @see REQ-8: Line movement: 0 (start of line), $ (end of line)
 * @see REQ-10: Delete: x (character), dd (line)
 * @see REQ-11: Yank/put: yy (copy line), p (paste after), P (paste before)
 * @see REQ-12: Undo: u undoes last edit operation
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import {
  useViMode,
  type UseViModeOptions,
  type UseViModeResult,
  getLineInfo,
  getLineCount,
  getLinePositions,
  moveCursor,
  executeExCommand,
  findNextWordStart,
  findPrevWordStart,
} from "../useViMode";

// =============================================================================
// Test Helpers
// =============================================================================

function createKeyEvent(
  key: string,
  options: Partial<React.KeyboardEvent<HTMLTextAreaElement>> = {}
): React.KeyboardEvent<HTMLTextAreaElement> {
  const prevented = { value: false };
  return {
    key,
    preventDefault: () => {
      prevented.value = true;
    },
    get defaultPrevented() {
      return prevented.value;
    },
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...options,
  } as React.KeyboardEvent<HTMLTextAreaElement>;
}

function createTextareaRef(
  ta: HTMLTextAreaElement
): React.RefObject<HTMLTextAreaElement> {
  return { current: ta } as React.RefObject<HTMLTextAreaElement>;
}

/**
 * Press a key and return the event. The result must be accessed fresh each call.
 */
function press(
  result: { current: UseViModeResult },
  key: string,
  options?: Partial<React.KeyboardEvent<HTMLTextAreaElement>>
): React.KeyboardEvent<HTMLTextAreaElement> {
  const event = createKeyEvent(key, options);
  act(() => result.current.handleKeyDown(event));
  return event;
}

// =============================================================================
// Shared Textarea Setup
// =============================================================================

interface TextareaSetup {
  textarea: HTMLTextAreaElement;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  getOptions: (onContentChange?: (content: string) => void) => UseViModeOptions;
  setCursor: (pos: number) => void;
}

function setupTextarea(): TextareaSetup {
  const textarea = document.createElement("textarea");
  document.body.appendChild(textarea);
  const textareaRef = createTextareaRef(textarea);

  return {
    textarea,
    textareaRef,
    getOptions: (onContentChange?: (content: string) => void) => ({
      enabled: true,
      textareaRef,
      onContentChange,
    }),
    setCursor: (pos: number) => {
      textarea.selectionStart = pos;
      textarea.selectionEnd = pos;
    },
  };
}

// =============================================================================
// useViMode Hook Tests
// =============================================================================

describe("useViMode", () => {
  const defaultOptions: UseViModeOptions = { enabled: true };

  describe("initial state", () => {
    it("starts with correct defaults", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      expect(result.current.mode).toBe("normal");
      expect(result.current.commandBuffer).toBe("");
      expect(result.current.pendingCount).toBeNull();
      expect(result.current.pendingOperator).toBeNull();
      expect(result.current.clipboard).toBeNull();
      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("mode transitions", () => {
    it.each(["i", "a", "A", "o", "O"])(
      "transitions to insert mode on '%s' key",
      (key) => {
        const { result } = renderHook(() => useViMode(defaultOptions));
        const event = press(result, key);

        expect(result.current.mode).toBe("insert");
        expect(event.defaultPrevented).toBe(true);
      }
    );

    it("transitions to command mode on ':' and clears on re-entry", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      press(result, ":");
      expect(result.current.mode).toBe("command");

      press(result, "w");
      expect(result.current.commandBuffer).toBe("w");

      press(result, "Escape");
      press(result, ":");
      expect(result.current.commandBuffer).toBe("");
    });

    it("Escape returns to normal from insert mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      press(result, "i");
      expect(result.current.mode).toBe("insert");

      const escEvent = press(result, "Escape");
      expect(result.current.mode).toBe("normal");
      expect(escEvent.defaultPrevented).toBe(true);
    });

    it("Escape returns to normal from command mode and clears buffer", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      press(result, ":");
      press(result, "w");
      press(result, "q");
      expect(result.current.commandBuffer).toBe("wq");

      press(result, "Escape");
      expect(result.current.mode).toBe("normal");
      expect(result.current.commandBuffer).toBe("");
    });

    it("Ctrl+C returns to normal from command mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      press(result, ":");
      press(result, "w");
      const ctrlCEvent = press(result, "c", { ctrlKey: true });

      expect(result.current.mode).toBe("normal");
      expect(result.current.commandBuffer).toBe("");
      expect(ctrlCEvent.defaultPrevented).toBe(true);
    });

    it("Enter in command mode returns to normal and clears buffer", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      press(result, ":");
      press(result, "w");
      const enterEvent = press(result, "Enter");

      expect(result.current.mode).toBe("normal");
      expect(result.current.commandBuffer).toBe("");
      expect(enterEvent.defaultPrevented).toBe(true);
    });

    it("cycles through all modes", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      expect(result.current.mode).toBe("normal");
      press(result, "i");
      expect(result.current.mode).toBe("insert");
      press(result, "Escape");
      expect(result.current.mode).toBe("normal");
      press(result, ":");
      expect(result.current.mode).toBe("command");
      press(result, "Escape");
      expect(result.current.mode).toBe("normal");
    });
  });

  describe("command buffer", () => {
    it("accumulates characters and handles backspace", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      press(result, ":");
      press(result, "w");
      press(result, "q");
      press(result, "!");
      expect(result.current.commandBuffer).toBe("wq!");

      press(result, "Backspace");
      expect(result.current.commandBuffer).toBe("wq");
    });

    it("prevents default for characters in command mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      press(result, ":");
      const wEvent = press(result, "w");

      expect(wEvent.defaultPrevented).toBe(true);
    });
  });

  describe("normal mode key blocking", () => {
    it("prevents default for letter keys", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));
      const event = press(result, "x");
      expect(event.defaultPrevented).toBe(true);
    });

    it.each([
      { name: "ctrl", opts: { ctrlKey: true } },
      { name: "meta", opts: { metaKey: true } },
    ])("allows keys with $name modifier through", ({ opts }) => {
      const { result } = renderHook(() => useViMode(defaultOptions));
      const event = press(result, "c", opts);
      expect(event.defaultPrevented).toBe(false);
    });

    it("allows multi-character keys (like Arrow keys) through", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));
      const event = press(result, "ArrowDown");
      expect(event.defaultPrevented).toBe(false);
    });

    it("allows other keys through in insert mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      press(result, "i");
      const letterEvent = press(result, "x");

      expect(result.current.mode).toBe("insert");
      expect(letterEvent.defaultPrevented).toBe(false);
    });
  });

  describe("enabled option", () => {
    it("does not change mode or prevent default when disabled", () => {
      const { result } = renderHook(() => useViMode({ enabled: false }));
      const event = press(result, "i");

      expect(result.current.mode).toBe("normal");
      expect(event.defaultPrevented).toBe(false);
    });

    it("handles dynamic enable/disable", () => {
      const { result, rerender } = renderHook(
        (props: UseViModeOptions) => useViMode(props),
        { initialProps: { enabled: true } }
      );

      press(result, "i");
      expect(result.current.mode).toBe("insert");

      rerender({ enabled: false });
      const escEvent = press(result, "Escape");

      expect(result.current.mode).toBe("insert");
      expect(escEvent.defaultPrevented).toBe(false);
    });
  });
});

// =============================================================================
// Cursor Manipulation Helper Tests
// =============================================================================

describe("cursor manipulation helpers", () => {
  describe("getLineInfo", () => {
    it.each([
      { text: "Hello, world!", pos: 7, expected: { lineNumber: 0, lineStart: 0, lineEnd: 13, column: 7 } },
      { text: "Hello, world!", pos: 0, expected: { lineNumber: 0, lineStart: 0, lineEnd: 13, column: 0 } },
      { text: "Hello, world!", pos: 13, expected: { lineNumber: 0, lineStart: 0, lineEnd: 13, column: 13 } },
      { text: "Line 1\nLine 2\nLine 3", pos: 3, expected: { lineNumber: 0, lineStart: 0, lineEnd: 6, column: 3 } },
      { text: "Line 1\nLine 2\nLine 3", pos: 10, expected: { lineNumber: 1, lineStart: 7, lineEnd: 13, column: 3 } },
      { text: "Line 1\nLine 2\nLine 3", pos: 17, expected: { lineNumber: 2, lineStart: 14, lineEnd: 20, column: 3 } },
      { text: "", pos: 0, expected: { lineNumber: 0, lineStart: 0, lineEnd: 0, column: 0 } },
      { text: "Line 1\nLine 2", pos: 7, expected: { lineNumber: 1, lineStart: 7, lineEnd: 13, column: 0 } },
      { text: "Line 1\n\nLine 3", pos: 7, expected: { lineNumber: 1, lineStart: 7, lineEnd: 7, column: 0 } },
    ])("returns correct info for $text at pos $pos", ({ text, pos, expected }) => {
      const info = getLineInfo(text, pos);
      expect(info.lineNumber).toBe(expected.lineNumber);
      expect(info.lineStart).toBe(expected.lineStart);
      expect(info.lineEnd).toBe(expected.lineEnd);
      expect(info.column).toBe(expected.column);
    });
  });

  describe("getLineCount", () => {
    it.each([
      { text: "", expected: 1 },
      { text: "Hello", expected: 1 },
      { text: "Hello\nWorld", expected: 2 },
      { text: "Line 1\nLine 2\nLine 3", expected: 3 },
      { text: "Hello\n", expected: 2 },
    ])("returns $expected for '$text'", ({ text, expected }) => {
      expect(getLineCount(text)).toBe(expected);
    });
  });

  describe("getLinePositions", () => {
    const text = "Line 1\nLine 2\nLine 3";

    it.each([
      { line: 0, expected: { lineStart: 0, lineEnd: 6 } },
      { line: 1, expected: { lineStart: 7, lineEnd: 13 } },
      { line: 2, expected: { lineStart: 14, lineEnd: 20 } },
    ])("returns correct positions for line $line", ({ line, expected }) => {
      const result = getLinePositions(text, line);
      expect(result).not.toBeNull();
      expect(result!.lineStart).toBe(expected.lineStart);
      expect(result!.lineEnd).toBe(expected.lineEnd);
    });

    it("returns null for non-existent line", () => {
      expect(getLinePositions(text, 5)).toBeNull();
    });

    it("handles empty line", () => {
      const result = getLinePositions("Line 1\n\nLine 3", 1);
      expect(result).not.toBeNull();
      expect(result!.lineStart).toBe(7);
      expect(result!.lineEnd).toBe(7);
    });
  });

  describe("moveCursor", () => {
    let textarea: HTMLTextAreaElement;

    beforeEach(() => {
      textarea = document.createElement("textarea");
      textarea.value = "Hello, world!";
      document.body.appendChild(textarea);
    });

    afterEach(() => {
      textarea.remove();
    });

    it.each([
      { pos: 5, expectedPos: 5 },
      { pos: -5, expectedPos: 0 },
      { pos: 100, expectedPos: 13 },
      { pos: 0, expectedPos: 0 },
      { pos: 13, expectedPos: 13 },
    ])("positions cursor at $expectedPos for input $pos", ({ pos, expectedPos }) => {
      moveCursor(textarea, pos);
      expect(textarea.selectionStart).toBe(expectedPos);
      expect(textarea.selectionEnd).toBe(expectedPos);
    });
  });
});

// =============================================================================
// executeExCommand Tests
// =============================================================================

describe("executeExCommand", () => {
  it.each([
    { cmd: "w", callsSave: true, callsExit: false, callsQuitUnsaved: false },
    { cmd: "wq", callsSave: true, callsExit: true, callsQuitUnsaved: false },
    { cmd: "x", callsSave: true, callsExit: true, callsQuitUnsaved: false },
    { cmd: "q", callsSave: false, callsExit: false, callsQuitUnsaved: true },
    { cmd: "q!", callsSave: false, callsExit: true, callsQuitUnsaved: false },
  ])(
    ":$cmd calls correct callbacks",
    ({ cmd, callsSave, callsExit, callsQuitUnsaved }) => {
      let saveCalled = false;
      let exitCalled = false;
      let quitUnsavedCalled = false;

      executeExCommand(cmd, {
        onSave: () => { saveCalled = true; },
        onExit: () => { exitCalled = true; },
        onQuitWithUnsaved: () => { quitUnsavedCalled = true; },
      });

      expect(saveCalled).toBe(callsSave);
      expect(exitCalled).toBe(callsExit);
      expect(quitUnsavedCalled).toBe(callsQuitUnsaved);
    }
  );

  it(":wq calls onSave before onExit", () => {
    const callOrder: string[] = [];
    executeExCommand("wq", {
      onSave: () => callOrder.push("save"),
      onExit: () => callOrder.push("exit"),
    });
    expect(callOrder).toEqual(["save", "exit"]);
  });

  it("trims whitespace from command", () => {
    let saveCalled = false;
    executeExCommand("  w  ", { onSave: () => { saveCalled = true; } });
    expect(saveCalled).toBe(true);
  });

  it("unknown/empty commands are no-ops", () => {
    let anyCalled = false;
    const callbacks = {
      onSave: () => { anyCalled = true; },
      onExit: () => { anyCalled = true; },
      onQuitWithUnsaved: () => { anyCalled = true; },
    };

    executeExCommand("foo", callbacks);
    executeExCommand("", callbacks);
    expect(anyCalled).toBe(false);
  });

  it("handles empty callbacks object without throwing", () => {
    expect(() => executeExCommand("w", {})).not.toThrow();
    expect(() => executeExCommand("wq", {})).not.toThrow();
    expect(() => executeExCommand("q", {})).not.toThrow();
    expect(() => executeExCommand("q!", {})).not.toThrow();
  });
});

// =============================================================================
// Movement Command Tests
// =============================================================================

describe("movement commands", () => {
  let textarea: HTMLTextAreaElement;
  let getOptions: (onContentChange?: (content: string) => void) => UseViModeOptions;
  let setCursor: (pos: number) => void;

  beforeEach(() => {
    const setup = setupTextarea();
    textarea = setup.textarea;
    getOptions = setup.getOptions;
    setCursor = setup.setCursor;
  });

  afterEach(() => {
    textarea.remove();
  });

  describe("h (move left)", () => {
    it.each([
      { start: 3, expected: 2 },
      { start: 0, expected: 0 },
      { start: 1, expected: 0 },
    ])("moves from $start to $expected", ({ start, expected }) => {
      textarea.value = "Hello";
      setCursor(start);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "h");

      expect(textarea.selectionStart).toBe(expected);
    });

    it("collapses selection when moving", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 1;
      textarea.selectionEnd = 4;

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "h");

      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(0);
    });
  });

  describe("l (move right)", () => {
    it.each([
      { start: 2, expected: 3 },
      { start: 5, expected: 5 },
      { start: 4, expected: 5 },
    ])("moves from $start to $expected", ({ start, expected }) => {
      textarea.value = "Hello";
      setCursor(start);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "l");

      expect(textarea.selectionStart).toBe(expected);
    });
  });

  describe("j (move down)", () => {
    it("moves cursor down one line maintaining column", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "j");

      expect(textarea.selectionStart).toBe(10);
    });

    it("clamps column when next line is shorter", () => {
      textarea.value = "Hello World\nHi";
      setCursor(8);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "j");

      expect(textarea.selectionStart).toBe(14);
    });

    it("stays on last line when already at last line", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(17);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "j");

      expect(textarea.selectionStart).toBe(17);
    });

    it("handles empty lines", () => {
      textarea.value = "Line 1\n\nLine 3";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "j");

      expect(textarea.selectionStart).toBe(7);
    });
  });

  describe("k (move up)", () => {
    it("moves cursor up one line maintaining column", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(10);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "k");

      expect(textarea.selectionStart).toBe(3);
    });

    it("clamps column when previous line is shorter", () => {
      textarea.value = "Hi\nHello World";
      setCursor(11);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "k");

      expect(textarea.selectionStart).toBe(2);
    });

    it("stays on first line when already at first line", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "k");

      expect(textarea.selectionStart).toBe(3);
    });
  });

  describe("0 (move to line start)", () => {
    it.each([
      { text: "Hello, world!", start: 7, expected: 0 },
      { text: "Hello, world!", start: 0, expected: 0 },
      { text: "Line 1\nLine 2\nLine 3", start: 10, expected: 7 },
      { text: "Line 1\n\nLine 3", start: 7, expected: 7 },
    ])("moves to line start from pos $start", ({ text, start, expected }) => {
      textarea.value = text;
      setCursor(start);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "0");

      expect(textarea.selectionStart).toBe(expected);
    });
  });

  describe("$ (move to line end)", () => {
    it.each([
      { text: "Hello, world!", start: 3, expected: 13 },
      { text: "Hello, world!", start: 13, expected: 13 },
      { text: "Line 1\nLine 2\nLine 3", start: 7, expected: 13 },
      { text: "Line 1\n\nLine 3", start: 7, expected: 7 },
      { text: "Line 1\nLine 2", start: 0, expected: 6 },
    ])("moves to line end from pos $start", ({ text, start, expected }) => {
      textarea.value = text;
      setCursor(start);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "$");

      expect(textarea.selectionStart).toBe(expected);
    });
  });

  describe("movement without textarea ref", () => {
    it.each(["h", "j", "k", "l"])(
      "'%s' does not crash when textareaRef is null",
      (key) => {
        const nullRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
        const { result } = renderHook(() =>
          useViMode({ enabled: true, textareaRef: nullRef })
        );

        const event = press(result, key);
        expect(event.defaultPrevented).toBe(true);
        expect(result.current.mode).toBe("normal");
      }
    );
  });

  describe("movement commands prevent default", () => {
    it.each(["h", "j", "k", "l", "0", "$"])("'%s' prevents default", (key) => {
      textarea.value = "Line 1\nLine 2";
      setCursor(5);

      const { result } = renderHook(() => useViMode(getOptions()));
      const event = press(result, key);

      expect(event.defaultPrevented).toBe(true);
    });
  });
});

// =============================================================================
// Insert Mode Entry Command Tests
// =============================================================================

describe("insert mode entry commands", () => {
  let textarea: HTMLTextAreaElement;
  let getOptions: (onContentChange?: (content: string) => void) => UseViModeOptions;
  let setCursor: (pos: number) => void;

  beforeEach(() => {
    const setup = setupTextarea();
    textarea = setup.textarea;
    getOptions = setup.getOptions;
    setCursor = setup.setCursor;
  });

  afterEach(() => {
    textarea.remove();
  });

  describe("'i' command (insert at cursor)", () => {
    it.each([
      { start: 2, expectedCursor: 2 },
      { start: 0, expectedCursor: 0 },
      { start: 5, expectedCursor: 5 },
    ])("enters insert mode without moving cursor from pos $start", ({ start, expectedCursor }) => {
      textarea.value = "Hello";
      setCursor(start);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "i");

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(expectedCursor);
    });
  });

  describe("'a' command (append after cursor)", () => {
    it.each([
      { start: 2, expected: 3 },
      { start: 2, textLen: 2, expected: 2 },
      { start: 0, expected: 1 },
    ])("moves cursor right and enters insert mode", ({ start, textLen, expected }) => {
      textarea.value = textLen === 2 ? "Hi" : "Hello";
      setCursor(start);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "a");

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(expected);
    });
  });

  describe("'A' command (append at end of line)", () => {
    it.each([
      { text: "Hello\nWorld", start: 2, expected: 5 },
      { text: "Hello", start: 2, expected: 5 },
      { text: "Hello\nWorld", start: 8, expected: 11 },
      { text: "Hello\n\nWorld", start: 6, expected: 6 },
    ])("moves cursor to end of line", ({ text, start, expected }) => {
      textarea.value = text;
      setCursor(start);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "A");

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(expected);
    });
  });

  describe("'o' command (open line below)", () => {
    it("inserts newline after current line and positions cursor", () => {
      textarea.value = "Hello\nWorld";
      setCursor(2);

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(getOptions((content) => { capturedContent = content; }))
      );

      press(result, "o");

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("Hello\n\nWorld");
      expect(textarea.selectionStart).toBe(6);
      expect(capturedContent).toBe("Hello\n\nWorld");
    });

    it("creates new last line", () => {
      textarea.value = "Hello";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "o");

      expect(textarea.value).toBe("Hello\n");
      expect(textarea.selectionStart).toBe(6);
    });

    it("works with empty text", () => {
      textarea.value = "";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "o");

      expect(textarea.value).toBe("\n");
      expect(textarea.selectionStart).toBe(1);
    });
  });

  describe("'O' command (open line above)", () => {
    it("inserts newline before current line and positions cursor", () => {
      textarea.value = "Hello\nWorld";
      setCursor(8);

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(getOptions((content) => { capturedContent = content; }))
      );

      press(result, "O");

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("Hello\n\nWorld");
      expect(textarea.selectionStart).toBe(6);
      expect(capturedContent).toBe("Hello\n\nWorld");
    });

    it("creates new first line", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "O");

      expect(textarea.value).toBe("\nHello");
      expect(textarea.selectionStart).toBe(0);
    });
  });

  describe("insert mode entry prevents default", () => {
    it.each(["i", "a", "A", "o", "O"])("'%s' prevents default", (key) => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      const event = press(result, key);

      expect(event.defaultPrevented).toBe(true);
    });
  });
});

// =============================================================================
// Undo Stack Tests
// =============================================================================

describe("undo stack", () => {
  let textarea: HTMLTextAreaElement;
  let getOptions: (onContentChange?: (content: string) => void) => UseViModeOptions;
  let setCursor: (pos: number) => void;

  beforeEach(() => {
    const setup = setupTextarea();
    textarea = setup.textarea;
    getOptions = setup.getOptions;
    setCursor = setup.setCursor;
  });

  afterEach(() => {
    textarea.remove();
  });

  describe("pushUndoState", () => {
    it("increases undo stack size when called", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      expect(result.current.undoStackSize).toBe(0);

      act(() => result.current.pushUndoState());
      expect(result.current.undoStackSize).toBe(1);
    });

    it.each(["i", "a", "A", "o", "O"])(
      "pushes state before entering insert mode via '%s'",
      (key) => {
        textarea.value = "Hello";
        setCursor(2);

        const { result } = renderHook(() => useViMode(getOptions()));
        press(result, key);

        expect(result.current.mode).toBe("insert");
        expect(result.current.undoStackSize).toBe(1);
      }
    );

    it("does not push state for movement commands", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "h");
      press(result, "l");

      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("'u' command (undo)", () => {
    it("prevents default and does nothing when stack is empty", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      const event = press(result, "u");

      expect(event.defaultPrevented).toBe(true);
      expect(textarea.value).toBe("Hello");
      expect(textarea.selectionStart).toBe(2);
    });

    it("restores content and cursor from undo stack", () => {
      textarea.value = "Original";
      setCursor(3);

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(getOptions((content) => { capturedContent = content; }))
      );

      act(() => result.current.pushUndoState());

      textarea.value = "Modified";
      setCursor(5);

      press(result, "u");

      expect(textarea.value).toBe("Original");
      expect(textarea.selectionStart).toBe(3);
      expect(capturedContent).toBe("Original");
    });

    it("supports multiple consecutive undos", () => {
      textarea.value = "State 1";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));

      act(() => result.current.pushUndoState());
      textarea.value = "State 2";
      setCursor(1);

      act(() => result.current.pushUndoState());
      textarea.value = "State 3";
      setCursor(2);

      press(result, "u");
      expect(textarea.value).toBe("State 2");

      press(result, "u");
      expect(textarea.value).toBe("State 1");

      press(result, "u");
      expect(textarea.value).toBe("State 1");
    });

    it("undoes 'o' command modifications", () => {
      textarea.value = "Hello";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "o");
      expect(textarea.value).toBe("Hello\n");

      press(result, "Escape");
      press(result, "u");
      expect(textarea.value).toBe("Hello");
    });

    it("batches insert mode changes into single undo entry", () => {
      textarea.value = "Hello";
      setCursor(5);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "a");
      expect(result.current.undoStackSize).toBe(1);

      textarea.value = "Hello World";
      setCursor(11);

      press(result, "Escape");
      expect(result.current.undoStackSize).toBe(1);

      press(result, "u");
      expect(textarea.value).toBe("Hello");
      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("undo stack depth limit", () => {
    it("limits stack to 100 entries", () => {
      textarea.value = "Test";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));

      for (let i = 0; i < 105; i++) {
        act(() => result.current.pushUndoState());
      }

      expect(result.current.undoStackSize).toBe(100);
    });
  });

  describe("undo without textarea", () => {
    it("does not crash when textareaRef is null", () => {
      const nullRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      act(() => result.current.pushUndoState());
      press(result, "u");

      expect(result.current.undoStackSize).toBe(0);
    });
  });
});

// =============================================================================
// Delete Command Tests
// =============================================================================

describe("delete commands", () => {
  let textarea: HTMLTextAreaElement;
  let getOptions: (onContentChange?: (content: string) => void) => UseViModeOptions;
  let setCursor: (pos: number) => void;

  beforeEach(() => {
    const setup = setupTextarea();
    textarea = setup.textarea;
    getOptions = setup.getOptions;
    setCursor = setup.setCursor;
  });

  afterEach(() => {
    textarea.remove();
  });

  describe("'x' command (delete character)", () => {
    it("deletes character at cursor and keeps cursor position", () => {
      textarea.value = "Hello";
      setCursor(2);

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(getOptions((content) => { capturedContent = content; }))
      );

      press(result, "x");

      expect(textarea.value).toBe("Helo");
      expect(textarea.selectionStart).toBe(2);
      expect(capturedContent).toBe("Helo");
    });

    it("does nothing at end of text or on empty text", () => {
      textarea.value = "Hello";
      setCursor(5);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "x");

      expect(textarea.value).toBe("Hello");

      textarea.value = "";
      setCursor(0);
      press(result, "x");
      expect(textarea.value).toBe("");
    });

    it("pushes to undo stack before delete (when there's something to delete)", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "x");

      expect(result.current.undoStackSize).toBe(1);

      textarea.value = "Test";
      setCursor(4);
      press(result, "x");
      expect(result.current.undoStackSize).toBe(1);
    });

    it("can be undone with 'u'", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "x");
      expect(textarea.value).toBe("Helo");

      press(result, "u");
      expect(textarea.value).toBe("Hello");
    });
  });

  describe("'dd' command (delete line)", () => {
    it("sets pending operator on first 'd' press", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");

      expect(result.current.pendingOperator).toBe("d");
      expect(textarea.value).toBe("Hello");
    });

    it("deletes line on 'dd' sequence", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(10);

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(getOptions((content) => { capturedContent = content; }))
      );

      press(result, "d");
      press(result, "d");

      expect(textarea.value).toBe("Line 1\nLine 3");
      expect(capturedContent).toBe("Line 1\nLine 3");
      expect(result.current.pendingOperator).toBeNull();
    });

    it("positions cursor correctly after delete", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(10);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "d");

      expect(textarea.selectionStart).toBe(7);
    });

    it("deletes last line and positions cursor at previous line start", () => {
      textarea.value = "Line 1\nLine 2";
      setCursor(10);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "d");

      expect(textarea.value).toBe("Line 1");
      expect(textarea.selectionStart).toBe(0);
    });

    it("deletes only line leaving empty document", () => {
      textarea.value = "Only line";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "d");

      expect(textarea.value).toBe("");
    });

    it("pushes to undo stack on execution (not on first 'd')", () => {
      textarea.value = "Line 1\nLine 2";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "d");
      expect(result.current.undoStackSize).toBe(0);

      press(result, "d");
      expect(result.current.undoStackSize).toBe(1);
    });

    it("clears pending operator when other key is pressed", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "d");
      expect(result.current.pendingOperator).toBe("d");

      press(result, "h");
      expect(result.current.pendingOperator).toBeNull();
    });

    it("clears pending operator on Escape", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "d");
      expect(result.current.pendingOperator).toBe("d");

      press(result, "Escape");
      expect(result.current.pendingOperator).toBeNull();
    });
  });

  describe("delete without textarea", () => {
    it("'x' does not crash when textareaRef is null", () => {
      const nullRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      press(result, "x");
      expect(result.current.mode).toBe("normal");
    });

    it("'dd' does not crash when textareaRef is null", () => {
      const nullRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      press(result, "d");
      press(result, "d");
      expect(result.current.mode).toBe("normal");
    });
  });
});

// =============================================================================
// Yank/Put Command Tests
// =============================================================================

describe("yank/put commands", () => {
  let textarea: HTMLTextAreaElement;
  let getOptions: (onContentChange?: (content: string) => void) => UseViModeOptions;
  let setCursor: (pos: number) => void;

  beforeEach(() => {
    const setup = setupTextarea();
    textarea = setup.textarea;
    getOptions = setup.getOptions;
    setCursor = setup.setCursor;
  });

  afterEach(() => {
    textarea.remove();
  });

  describe("'yy' command (yank line)", () => {
    it("sets pending operator on first 'y' and yanks on 'yy'", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(10);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "y");
      expect(result.current.pendingOperator).toBe("y");

      press(result, "y");
      expect(result.current.clipboard).toBe("Line 2");
      expect(result.current.pendingOperator).toBeNull();
      expect(textarea.value).toBe("Line 1\nLine 2\nLine 3");
    });

    it("clipboard persists across yanks (last wins)", () => {
      textarea.value = "Line A\nLine B\nLine C";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "y");
      press(result, "y");
      expect(result.current.clipboard).toBe("Line A");

      setCursor(10);
      press(result, "y");
      press(result, "y");
      expect(result.current.clipboard).toBe("Line B");
    });

    it("does not push to undo stack (non-destructive)", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "y");
      press(result, "y");

      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("'p' command (paste after)", () => {
    it("pastes clipboard content after current line", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(10);

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(getOptions((content) => { capturedContent = content; }))
      );

      press(result, "y");
      press(result, "y");
      setCursor(3);
      press(result, "p");

      expect(textarea.value).toBe("Line 1\nLine 2\nLine 2\nLine 3");
      expect(capturedContent).toBe("Line 1\nLine 2\nLine 2\nLine 3");
      expect(textarea.selectionStart).toBe(7);
    });

    it("does nothing with empty clipboard", () => {
      textarea.value = "Line 1\nLine 2";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      expect(result.current.clipboard).toBeNull();

      press(result, "p");
      expect(textarea.value).toBe("Line 1\nLine 2");
    });

    it("pushes to undo stack and can be undone", () => {
      textarea.value = "Original";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "y");
      press(result, "y");
      press(result, "p");
      expect(result.current.undoStackSize).toBe(1);
      expect(textarea.value).toBe("Original\nOriginal");

      press(result, "u");
      expect(textarea.value).toBe("Original");
    });
  });

  describe("'P' command (paste before)", () => {
    it("pastes clipboard content before current line", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(3);

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(getOptions((content) => { capturedContent = content; }))
      );

      press(result, "y");
      press(result, "y");
      setCursor(10);
      press(result, "P");

      expect(textarea.value).toBe("Line 1\nLine 1\nLine 2\nLine 3");
      expect(capturedContent).toBe("Line 1\nLine 1\nLine 2\nLine 3");
      expect(textarea.selectionStart).toBe(7);
    });

    it("does nothing with empty clipboard", () => {
      textarea.value = "Line 1\nLine 2";
      setCursor(10);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "P");

      expect(textarea.value).toBe("Line 1\nLine 2");
    });
  });

  describe("pending operator interaction", () => {
    it("'y' then 'd' starts delete operator", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "y");
      expect(result.current.pendingOperator).toBe("y");

      press(result, "d");
      expect(result.current.pendingOperator).toBe("d");
    });

    it("'d' then 'y' starts yank operator", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "d");
      press(result, "y");
      expect(result.current.pendingOperator).toBe("y");
    });
  });

  describe("yank/put without textarea", () => {
    it("'yy' does not crash when textareaRef is null", () => {
      const nullRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      press(result, "y");
      press(result, "y");
      expect(result.current.mode).toBe("normal");
    });

    it("'p' does not crash when textareaRef is null", () => {
      const nullRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      const event = press(result, "p");
      expect(event.defaultPrevented).toBe(true);
    });
  });
});

// =============================================================================
// Numeric Prefix Tests
// =============================================================================

describe("numeric prefixes", () => {
  let textarea: HTMLTextAreaElement;
  let getOptions: (onContentChange?: (content: string) => void) => UseViModeOptions;
  let setCursor: (pos: number) => void;

  beforeEach(() => {
    const setup = setupTextarea();
    textarea = setup.textarea;
    getOptions = setup.getOptions;
    setCursor = setup.setCursor;
  });

  afterEach(() => {
    textarea.remove();
  });

  describe("count accumulation", () => {
    it("accumulates digits", () => {
      const { result } = renderHook(() => useViMode(getOptions()));

      expect(result.current.pendingCount).toBeNull();

      press(result, "1");
      press(result, "2");
      press(result, "3");
      expect(result.current.pendingCount).toBe(123);
    });

    it("treats 0 as movement when no count pending, digit otherwise", () => {
      textarea.value = "Hello, world!";
      setCursor(7);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "0");
      expect(result.current.pendingCount).toBeNull();
      expect(textarea.selectionStart).toBe(0);

      setCursor(7);
      press(result, "1");
      press(result, "0");
      expect(result.current.pendingCount).toBe(10);
    });

    it("clears count on mode changes", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "5");
      expect(result.current.pendingCount).toBe(5);

      press(result, "i");
      expect(result.current.pendingCount).toBeNull();

      press(result, "Escape");
      press(result, "5");
      press(result, ":");
      expect(result.current.pendingCount).toBeNull();
    });
  });

  describe("movement with count", () => {
    it("5h moves left 5 characters", () => {
      textarea.value = "Hello, world!";
      setCursor(10);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "5");
      press(result, "h");

      expect(textarea.selectionStart).toBe(5);
      expect(result.current.pendingCount).toBeNull();
    });

    it("5l moves right 5 characters", () => {
      textarea.value = "Hello, world!";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "5");
      press(result, "l");

      expect(textarea.selectionStart).toBe(5);
    });

    it("3j moves down 3 lines", () => {
      textarea.value = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "3");
      press(result, "j");

      expect(textarea.selectionStart).toBe(24);
    });

    it("clamps movement at boundaries", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "9");
      press(result, "9");
      press(result, "h");

      expect(textarea.selectionStart).toBe(0);
    });
  });

  describe("delete with count", () => {
    it("3x deletes 3 characters", () => {
      textarea.value = "Hello, world!";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "3");
      press(result, "x");

      expect(textarea.value).toBe("lo, world!");
    });

    it("3dd deletes 3 lines", () => {
      textarea.value = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "3");
      press(result, "d");
      press(result, "d");

      expect(textarea.value).toBe("Line 4\nLine 5");
    });

    it("count clamps to available content", () => {
      textarea.value = "Hi";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "9");
      press(result, "9");
      press(result, "x");

      expect(textarea.value).toBe("");
    });
  });

  describe("yank with count", () => {
    it("3yy yanks 3 lines", () => {
      textarea.value = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "3");
      press(result, "y");
      press(result, "y");

      expect(result.current.clipboard).toBe("Line 1\nLine 2\nLine 3");
      expect(textarea.value).toBe("Line 1\nLine 2\nLine 3\nLine 4\nLine 5");
    });

    it("multi-line yank and paste works correctly", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "2");
      press(result, "y");
      press(result, "y");

      expect(result.current.clipboard).toBe("Line 1\nLine 2");

      setCursor(17);
      press(result, "p");

      expect(textarea.value).toBe("Line 1\nLine 2\nLine 3\nLine 1\nLine 2");
    });
  });

  describe("count persistence", () => {
    it("count persists across first operator key", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "2");
      press(result, "d");
      expect(result.current.pendingOperator).toBe("d");
      expect(result.current.pendingCount).toBe(2);

      press(result, "d");
      expect(result.current.pendingOperator).toBeNull();
      expect(result.current.pendingCount).toBeNull();
      expect(textarea.value).toBe("Line 3");
    });

    it("Escape clears pending count and operator", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "3");
      press(result, "d");
      expect(result.current.pendingCount).toBe(3);
      expect(result.current.pendingOperator).toBe("d");

      press(result, "Escape");
      expect(result.current.pendingCount).toBeNull();
      expect(result.current.pendingOperator).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles very large counts gracefully", () => {
      textarea.value = "Hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "9");
      press(result, "9");
      press(result, "9");
      press(result, "h");

      expect(textarea.selectionStart).toBe(0);
    });

    it("undo does not use count (just undoes once)", () => {
      textarea.value = "Hello";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));

      press(result, "x");
      expect(textarea.value).toBe("ello");

      press(result, "x");
      expect(textarea.value).toBe("llo");

      press(result, "2");
      press(result, "u");
      expect(textarea.value).toBe("ello");
    });
  });
});

// =============================================================================
// Ex Command Execution Tests
// =============================================================================

describe("ex command execution via hook", () => {
  it.each([
    { cmd: "w", expectSave: true, expectExit: false },
    { cmd: "wq", expectSave: true, expectExit: true },
    { cmd: "x", expectSave: true, expectExit: true },
    { cmd: "q", expectSave: false, expectExit: false, expectQuitUnsaved: true },
    { cmd: "q!", expectSave: false, expectExit: true },
  ])(":$cmd executes correctly via hook", ({ cmd, expectSave, expectExit, expectQuitUnsaved }) => {
    let saveCalled = false;
    let exitCalled = false;
    let quitUnsavedCalled = false;

    const options: UseViModeOptions = {
      enabled: true,
      onSave: () => { saveCalled = true; },
      onExit: () => { exitCalled = true; },
      onQuitWithUnsaved: () => { quitUnsavedCalled = true; },
    };

    const { result } = renderHook(() => useViMode(options));

    press(result, ":");
    for (const c of cmd) {
      press(result, c);
    }
    press(result, "Enter");

    expect(saveCalled).toBe(expectSave ?? false);
    expect(exitCalled).toBe(expectExit ?? false);
    expect(quitUnsavedCalled).toBe(expectQuitUnsaved ?? false);
    expect(result.current.mode).toBe("normal");
  });

  it("Escape cancels command without executing", () => {
    let saveCalled = false;
    const options: UseViModeOptions = {
      enabled: true,
      onSave: () => { saveCalled = true; },
    };

    const { result } = renderHook(() => useViMode(options));

    press(result, ":");
    press(result, "w");
    press(result, "Escape");

    expect(saveCalled).toBe(false);
    expect(result.current.mode).toBe("normal");
    expect(result.current.commandBuffer).toBe("");
  });

  it("callbacks are optional (no crash when undefined)", () => {
    const { result } = renderHook(() => useViMode({ enabled: true }));

    expect(() => {
      press(result, ":");
      press(result, "w");
      press(result, "Enter");
      press(result, ":");
      press(result, "w");
      press(result, "q");
      press(result, "Enter");
      press(result, ":");
      press(result, "q");
      press(result, "Enter");
      press(result, ":");
      press(result, "q");
      press(result, "!");
      press(result, "Enter");
    }).not.toThrow();
  });
});

// =============================================================================
// Word Boundary Helper Tests
// =============================================================================

describe("word boundary helpers", () => {
  describe("findNextWordStart", () => {
    it.each([
      { text: "hello world", pos: 0, expected: 6 },
      { text: "hello world", pos: 3, expected: 6 },
      { text: "hello world", pos: 5, expected: 6 },
      { text: "hello world", pos: 6, expected: 11 },
      { text: "hello world", pos: 11, expected: 11 },
    ])("finds next word from pos $pos in '$text'", ({ text, pos, expected }) => {
      expect(findNextWordStart(text, pos)).toBe(expected);
    });

    it("handles punctuation as separate words", () => {
      // "foo.bar" -> foo, ., bar are 3 words
      expect(findNextWordStart("foo.bar", 0)).toBe(3); // foo -> .
      expect(findNextWordStart("foo.bar", 3)).toBe(4); // . -> bar
      expect(findNextWordStart("foo.bar", 4)).toBe(7); // bar -> end
    });

    it("skips multiple spaces", () => {
      expect(findNextWordStart("hello   world", 0)).toBe(8);
      expect(findNextWordStart("hello   world", 5)).toBe(8);
    });

    it("handles newlines as whitespace", () => {
      expect(findNextWordStart("hello\nworld", 0)).toBe(6);
      expect(findNextWordStart("hello\nworld", 5)).toBe(6);
    });

    it("moves across lines", () => {
      expect(findNextWordStart("line1\nline2", 0)).toBe(6);
    });

    it("handles empty text", () => {
      expect(findNextWordStart("", 0)).toBe(0);
    });

    it("handles position at end of text", () => {
      expect(findNextWordStart("hello", 5)).toBe(5);
    });

    it("handles underscores as word characters", () => {
      expect(findNextWordStart("foo_bar baz", 0)).toBe(8);
    });

    it("handles numbers as word characters", () => {
      expect(findNextWordStart("foo123 bar", 0)).toBe(7);
    });
  });

  describe("findPrevWordStart", () => {
    it.each([
      { text: "hello world", pos: 11, expected: 6 },
      { text: "hello world", pos: 6, expected: 0 },
      { text: "hello world", pos: 8, expected: 6 },
      { text: "hello world", pos: 0, expected: 0 },
    ])("finds prev word from pos $pos in '$text'", ({ text, pos, expected }) => {
      expect(findPrevWordStart(text, pos)).toBe(expected);
    });

    it("handles punctuation as separate words", () => {
      expect(findPrevWordStart("foo.bar", 7)).toBe(4); // bar -> .
      expect(findPrevWordStart("foo.bar", 4)).toBe(3); // . -> foo
      expect(findPrevWordStart("foo.bar", 3)).toBe(0); // foo -> start
    });

    it("skips multiple spaces", () => {
      expect(findPrevWordStart("hello   world", 13)).toBe(8);
      expect(findPrevWordStart("hello   world", 8)).toBe(0);
    });

    it("handles newlines as whitespace", () => {
      expect(findPrevWordStart("hello\nworld", 11)).toBe(6);
      expect(findPrevWordStart("hello\nworld", 6)).toBe(0);
    });

    it("handles empty text", () => {
      expect(findPrevWordStart("", 0)).toBe(0);
    });

    it("handles position at start of text", () => {
      expect(findPrevWordStart("hello", 0)).toBe(0);
    });
  });
});

// =============================================================================
// Word Motion Command Tests
// =============================================================================

describe("word motion commands", () => {
  let textarea: HTMLTextAreaElement;
  let getOptions: (onContentChange?: (content: string) => void) => UseViModeOptions;
  let setCursor: (pos: number) => void;

  beforeEach(() => {
    const setup = setupTextarea();
    textarea = setup.textarea;
    getOptions = setup.getOptions;
    setCursor = setup.setCursor;
  });

  afterEach(() => {
    textarea.remove();
  });

  describe("'w' command (word forward)", () => {
    it("moves to start of next word", () => {
      textarea.value = "hello world";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "w");

      expect(textarea.selectionStart).toBe(6);
    });

    it("moves across punctuation", () => {
      textarea.value = "foo.bar";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "w");
      expect(textarea.selectionStart).toBe(3); // at .

      press(result, "w");
      expect(textarea.selectionStart).toBe(4); // at bar
    });

    it("moves across lines", () => {
      textarea.value = "hello\nworld";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "w");

      expect(textarea.selectionStart).toBe(6);
    });

    it("stops at end of text", () => {
      textarea.value = "hello";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "w");

      expect(textarea.selectionStart).toBe(5);
    });

    it("handles count (3w)", () => {
      textarea.value = "one two three four";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "3");
      press(result, "w");

      expect(textarea.selectionStart).toBe(14); // at "four"
    });
  });

  describe("'b' command (word backward)", () => {
    it("moves to start of previous word", () => {
      textarea.value = "hello world";
      setCursor(11);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "b");

      expect(textarea.selectionStart).toBe(6);
    });

    it("moves from within a word to start of that word", () => {
      textarea.value = "hello world";
      setCursor(8);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "b");

      expect(textarea.selectionStart).toBe(6);
    });

    it("moves across punctuation", () => {
      textarea.value = "foo.bar";
      setCursor(7);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "b");
      expect(textarea.selectionStart).toBe(4); // at bar start

      press(result, "b");
      expect(textarea.selectionStart).toBe(3); // at .

      press(result, "b");
      expect(textarea.selectionStart).toBe(0); // at foo
    });

    it("moves across lines", () => {
      textarea.value = "hello\nworld";
      setCursor(11);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "b");
      expect(textarea.selectionStart).toBe(6);

      press(result, "b");
      expect(textarea.selectionStart).toBe(0);
    });

    it("stops at start of text", () => {
      textarea.value = "hello";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "b");
      expect(textarea.selectionStart).toBe(0);

      press(result, "b");
      expect(textarea.selectionStart).toBe(0);
    });

    it("handles count (2b)", () => {
      textarea.value = "one two three four";
      setCursor(18);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "2");
      press(result, "b");

      expect(textarea.selectionStart).toBe(8); // at "three"
    });
  });
});

// =============================================================================
// Operator+Motion Command Tests
// =============================================================================

describe("operator+motion commands", () => {
  let textarea: HTMLTextAreaElement;
  let getOptions: (onContentChange?: (content: string) => void) => UseViModeOptions;
  let setCursor: (pos: number) => void;

  beforeEach(() => {
    const setup = setupTextarea();
    textarea = setup.textarea;
    getOptions = setup.getOptions;
    setCursor = setup.setCursor;
  });

  afterEach(() => {
    textarea.remove();
  });

  describe("'dw' command (delete word)", () => {
    it("deletes from cursor to start of next word", () => {
      textarea.value = "hello world";
      setCursor(0);

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(getOptions((content) => { capturedContent = content; }))
      );

      press(result, "d");
      expect(result.current.pendingOperator).toBe("d");

      press(result, "w");
      expect(textarea.value).toBe("world");
      expect(capturedContent).toBe("world");
      expect(result.current.pendingOperator).toBeNull();
    });

    it("deletes word including trailing space", () => {
      textarea.value = "one two three";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "w");

      expect(textarea.value).toBe("two three");
    });

    it("works with count (2dw)", () => {
      textarea.value = "one two three four";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "2");
      press(result, "d");
      press(result, "w");

      expect(textarea.value).toBe("three four");
    });

    it("at end of line, deletes to end", () => {
      textarea.value = "hello\nworld";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "w");

      expect(textarea.value).toBe("helworld");
    });

    it("pushes to undo stack", () => {
      textarea.value = "hello world";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "w");

      expect(result.current.undoStackSize).toBe(1);
    });

    it("can be undone", () => {
      textarea.value = "hello world";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "w");
      expect(textarea.value).toBe("world");

      press(result, "u");
      expect(textarea.value).toBe("hello world");
    });
  });

  describe("'yw' command (yank word)", () => {
    it("yanks from cursor to start of next word", () => {
      textarea.value = "hello world";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "y");
      press(result, "w");

      expect(result.current.clipboard).toBe("hello ");
      expect(textarea.value).toBe("hello world"); // unchanged
    });

    it("works with count (2yw)", () => {
      textarea.value = "one two three four";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "2");
      press(result, "y");
      press(result, "w");

      expect(result.current.clipboard).toBe("one two ");
    });

    it("does not push to undo stack", () => {
      textarea.value = "hello world";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "y");
      press(result, "w");

      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("'db' command (delete backward word)", () => {
    it("deletes from cursor back to start of previous word", () => {
      textarea.value = "hello world";
      setCursor(11);

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(getOptions((content) => { capturedContent = content; }))
      );

      press(result, "d");
      press(result, "b");

      expect(textarea.value).toBe("hello ");
      expect(capturedContent).toBe("hello ");
    });

    it("works with count (2db)", () => {
      textarea.value = "one two three";
      setCursor(13);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "2");
      press(result, "d");
      press(result, "b");

      expect(textarea.value).toBe("one ");
    });
  });

  describe("'yb' command (yank backward word)", () => {
    it("yanks from cursor back to start of previous word", () => {
      textarea.value = "hello world";
      setCursor(11);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "y");
      press(result, "b");

      expect(result.current.clipboard).toBe("world");
      expect(textarea.value).toBe("hello world"); // unchanged
    });
  });

  describe("'d$' command (delete to end of line)", () => {
    it("deletes from cursor to end of line", () => {
      textarea.value = "hello world\nline 2";
      setCursor(6);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "$");

      expect(textarea.value).toBe("hello \nline 2");
    });

    it("does nothing if already at end of line", () => {
      textarea.value = "hello\nworld";
      setCursor(5);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "$");

      expect(textarea.value).toBe("hello\nworld");
      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("'y$' command (yank to end of line)", () => {
    it("yanks from cursor to end of line", () => {
      textarea.value = "hello world\nline 2";
      setCursor(6);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "y");
      press(result, "$");

      expect(result.current.clipboard).toBe("world");
      expect(textarea.value).toBe("hello world\nline 2");
    });
  });

  describe("'d0' command (delete to start of line)", () => {
    it("deletes from cursor to start of line", () => {
      textarea.value = "hello world";
      setCursor(6);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "0");

      expect(textarea.value).toBe("world");
    });

    it("does nothing if already at start of line", () => {
      textarea.value = "hello world";
      setCursor(0);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "0");

      expect(textarea.value).toBe("hello world");
      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("'dh' and 'dl' commands", () => {
    it("dh deletes character to the left", () => {
      textarea.value = "hello";
      setCursor(3);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "h");

      expect(textarea.value).toBe("helo");
    });

    it("dl deletes character to the right", () => {
      textarea.value = "hello";
      setCursor(2);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "d");
      press(result, "l");

      expect(textarea.value).toBe("helo");
    });

    it("3dh deletes 3 characters to the left", () => {
      textarea.value = "hello";
      setCursor(5);

      const { result } = renderHook(() => useViMode(getOptions()));
      press(result, "3");
      press(result, "d");
      press(result, "h");

      expect(textarea.value).toBe("he");
    });
  });
});

// =============================================================================
// D Command Tests
// =============================================================================

describe("'D' command (delete to end of line)", () => {
  let textarea: HTMLTextAreaElement;
  let getOptions: (onContentChange?: (content: string) => void) => UseViModeOptions;
  let setCursor: (pos: number) => void;

  beforeEach(() => {
    const setup = setupTextarea();
    textarea = setup.textarea;
    getOptions = setup.getOptions;
    setCursor = setup.setCursor;
  });

  afterEach(() => {
    textarea.remove();
  });

  it("deletes from cursor to end of line", () => {
    textarea.value = "hello world";
    setCursor(6);

    let capturedContent = "";
    const { result } = renderHook(() =>
      useViMode(getOptions((content) => { capturedContent = content; }))
    );

    press(result, "D");

    expect(textarea.value).toBe("hello ");
    expect(capturedContent).toBe("hello ");
    expect(textarea.selectionStart).toBe(6);
  });

  it("preserves newline when deleting on multi-line text", () => {
    textarea.value = "hello world\nline 2";
    setCursor(6);

    const { result } = renderHook(() => useViMode(getOptions()));
    press(result, "D");

    expect(textarea.value).toBe("hello \nline 2");
  });

  it("does nothing if cursor is at end of line", () => {
    textarea.value = "hello\nworld";
    setCursor(5);

    const { result } = renderHook(() => useViMode(getOptions()));
    press(result, "D");

    expect(textarea.value).toBe("hello\nworld");
    expect(result.current.undoStackSize).toBe(0);
  });

  it("deletes entire content if single line and cursor at start", () => {
    textarea.value = "hello";
    setCursor(0);

    const { result } = renderHook(() => useViMode(getOptions()));
    press(result, "D");

    expect(textarea.value).toBe("");
  });

  it("pushes to undo stack", () => {
    textarea.value = "hello world";
    setCursor(6);

    const { result } = renderHook(() => useViMode(getOptions()));
    press(result, "D");

    expect(result.current.undoStackSize).toBe(1);
  });

  it("can be undone", () => {
    textarea.value = "hello world";
    setCursor(6);

    const { result } = renderHook(() => useViMode(getOptions()));
    press(result, "D");
    expect(textarea.value).toBe("hello ");

    press(result, "u");
    expect(textarea.value).toBe("hello world");
  });

  it("clears pending count", () => {
    textarea.value = "hello world";
    setCursor(0);

    const { result } = renderHook(() => useViMode(getOptions()));
    press(result, "3");
    expect(result.current.pendingCount).toBe(3);

    press(result, "D");
    expect(result.current.pendingCount).toBeNull();
  });

  it("prevents default", () => {
    textarea.value = "hello world";
    setCursor(6);

    const { result } = renderHook(() => useViMode(getOptions()));
    const event = press(result, "D");

    expect(event.defaultPrevented).toBe(true);
  });
});

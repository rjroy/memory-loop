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
  getLineInfo,
  getLineCount,
  getLinePositions,
  moveCursor,
  executeExCommand,
} from "../useViMode";

// Helper to create a mock KeyboardEvent
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

describe("useViMode", () => {
  const defaultOptions: UseViModeOptions = {
    enabled: true,
  };

  describe("initial state", () => {
    it("starts in normal mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      expect(result.current.mode).toBe("normal");
    });

    it("starts with empty command buffer", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      expect(result.current.commandBuffer).toBe("");
    });

    it("starts with null pending count", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      expect(result.current.pendingCount).toBeNull();
    });

    it("starts with null pending operator", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      expect(result.current.pendingOperator).toBeNull();
    });

    it("starts with null clipboard", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      expect(result.current.clipboard).toBeNull();
    });

    it("starts with empty undo stack", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("normal to insert mode transitions", () => {
    it("transitions to insert mode on 'i' key", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      const event = createKeyEvent("i");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(result.current.mode).toBe("insert");
      expect(event.defaultPrevented).toBe(true);
    });

    it("transitions to insert mode on 'a' key", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      const event = createKeyEvent("a");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(result.current.mode).toBe("insert");
    });

    it("transitions to insert mode on 'A' key", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      const event = createKeyEvent("A");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(result.current.mode).toBe("insert");
    });

    it("transitions to insert mode on 'o' key", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      const event = createKeyEvent("o");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(result.current.mode).toBe("insert");
    });

    it("transitions to insert mode on 'O' key", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      const event = createKeyEvent("O");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(result.current.mode).toBe("insert");
    });
  });

  describe("normal to command mode transitions", () => {
    it("transitions to command mode on ':' key", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      const event = createKeyEvent(":");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(result.current.mode).toBe("command");
      expect(event.defaultPrevented).toBe(true);
    });

    it("clears command buffer when entering command mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      // First enter command mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });

      // Type something
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });

      expect(result.current.commandBuffer).toBe("w");

      // Exit command mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });

      // Re-enter command mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });

      expect(result.current.commandBuffer).toBe("");
    });
  });

  describe("insert to normal mode transitions", () => {
    it("transitions to normal mode on Escape", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      // Enter insert mode first
      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });
      expect(result.current.mode).toBe("insert");

      // Press Escape
      const escapeEvent = createKeyEvent("Escape");
      act(() => {
        result.current.handleKeyDown(escapeEvent);
      });

      expect(result.current.mode).toBe("normal");
      expect(escapeEvent.defaultPrevented).toBe(true);
    });

    it("allows other keys through in insert mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      // Enter insert mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });

      // Regular keys should not be prevented in insert mode
      const letterEvent = createKeyEvent("x");
      act(() => {
        result.current.handleKeyDown(letterEvent);
      });

      expect(result.current.mode).toBe("insert"); // Still in insert mode
      expect(letterEvent.defaultPrevented).toBe(false); // Key allowed through
    });
  });

  describe("command to normal mode transitions", () => {
    it("transitions to normal mode on Escape", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      // Enter command mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      expect(result.current.mode).toBe("command");

      // Press Escape
      const escapeEvent = createKeyEvent("Escape");
      act(() => {
        result.current.handleKeyDown(escapeEvent);
      });

      expect(result.current.mode).toBe("normal");
      expect(escapeEvent.defaultPrevented).toBe(true);
    });

    it("clears command buffer on Escape", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      // Enter command mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });

      // Type something
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("q"));
      });

      expect(result.current.commandBuffer).toBe("wq");

      // Press Escape
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });

      expect(result.current.commandBuffer).toBe("");
    });

    it("transitions to normal mode on Ctrl+C", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      // Enter command mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      expect(result.current.mode).toBe("command");

      // Type something
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      expect(result.current.commandBuffer).toBe("w");

      // Press Ctrl+C (standard vi abort)
      const ctrlCEvent = createKeyEvent("c", { ctrlKey: true });
      act(() => {
        result.current.handleKeyDown(ctrlCEvent);
      });

      expect(result.current.mode).toBe("normal");
      expect(result.current.commandBuffer).toBe("");
      expect(ctrlCEvent.defaultPrevented).toBe(true);
    });

    it("transitions to normal mode on Enter", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      // Enter command mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });

      // Press Enter
      const enterEvent = createKeyEvent("Enter");
      act(() => {
        result.current.handleKeyDown(enterEvent);
      });

      expect(result.current.mode).toBe("normal");
      expect(enterEvent.defaultPrevented).toBe(true);
    });

    it("clears command buffer on Enter", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      // Enter command mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });

      // Type something
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });

      expect(result.current.commandBuffer).toBe("w");

      // Press Enter
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(result.current.commandBuffer).toBe("");
    });
  });

  describe("command buffer", () => {
    it("accumulates characters in command mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("q"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("!"));
      });

      expect(result.current.commandBuffer).toBe("wq!");
    });

    it("handles backspace in command buffer", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("q"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Backspace"));
      });

      expect(result.current.commandBuffer).toBe("w");
    });

    it("prevents default for characters in command mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });

      const wEvent = createKeyEvent("w");
      act(() => {
        result.current.handleKeyDown(wEvent);
      });

      expect(wEvent.defaultPrevented).toBe(true);
    });
  });

  describe("normal mode key blocking", () => {
    it("prevents default for letter keys in normal mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      const xEvent = createKeyEvent("x");
      act(() => {
        result.current.handleKeyDown(xEvent);
      });

      expect(xEvent.defaultPrevented).toBe(true);
    });

    it("allows keys with ctrl modifier through in normal mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      const ctrlCEvent = createKeyEvent("c", { ctrlKey: true });
      act(() => {
        result.current.handleKeyDown(ctrlCEvent);
      });

      expect(ctrlCEvent.defaultPrevented).toBe(false);
    });

    it("allows keys with meta modifier through in normal mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      const metaCEvent = createKeyEvent("c", { metaKey: true });
      act(() => {
        result.current.handleKeyDown(metaCEvent);
      });

      expect(metaCEvent.defaultPrevented).toBe(false);
    });

    it("allows multi-character keys (like Arrow keys) through in normal mode", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      const arrowEvent = createKeyEvent("ArrowDown");
      act(() => {
        result.current.handleKeyDown(arrowEvent);
      });

      expect(arrowEvent.defaultPrevented).toBe(false);
    });
  });

  describe("enabled option", () => {
    it("does not change mode when disabled", () => {
      const { result } = renderHook(() => useViMode({ enabled: false }));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });

      expect(result.current.mode).toBe("normal");
    });

    it("does not prevent default when disabled", () => {
      const { result } = renderHook(() => useViMode({ enabled: false }));

      const event = createKeyEvent("i");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(false);
    });

    it("handles dynamic enable/disable", () => {
      const { result, rerender } = renderHook(
        (props: UseViModeOptions) => useViMode(props),
        { initialProps: { enabled: true } }
      );

      // Enter insert mode while enabled
      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });
      expect(result.current.mode).toBe("insert");

      // Disable vi mode
      rerender({ enabled: false });

      // Escape should not work when disabled
      const escapeEvent = createKeyEvent("Escape");
      act(() => {
        result.current.handleKeyDown(escapeEvent);
      });

      // Still in insert mode because vi mode is disabled
      expect(result.current.mode).toBe("insert");
      expect(escapeEvent.defaultPrevented).toBe(false);
    });
  });

  describe("mode transition cycle", () => {
    it("can cycle through all modes", () => {
      const { result } = renderHook(() => useViMode(defaultOptions));

      // Start in normal
      expect(result.current.mode).toBe("normal");

      // Normal -> Insert
      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });
      expect(result.current.mode).toBe("insert");

      // Insert -> Normal
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });
      expect(result.current.mode).toBe("normal");

      // Normal -> Command
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      expect(result.current.mode).toBe("command");

      // Command -> Normal
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });
      expect(result.current.mode).toBe("normal");
    });
  });
});

/**
 * Helper function tests for cursor manipulation utilities.
 */
describe("cursor manipulation helpers", () => {
  describe("getLineInfo", () => {
    it("returns correct info for single line text", () => {
      const text = "Hello, world!";
      const info = getLineInfo(text, 7);

      expect(info.lineNumber).toBe(0);
      expect(info.lineStart).toBe(0);
      expect(info.lineEnd).toBe(13);
      expect(info.column).toBe(7);
    });

    it("returns correct info for cursor at start of text", () => {
      const text = "Hello, world!";
      const info = getLineInfo(text, 0);

      expect(info.lineNumber).toBe(0);
      expect(info.lineStart).toBe(0);
      expect(info.lineEnd).toBe(13);
      expect(info.column).toBe(0);
    });

    it("returns correct info for cursor at end of text", () => {
      const text = "Hello, world!";
      const info = getLineInfo(text, 13);

      expect(info.lineNumber).toBe(0);
      expect(info.lineStart).toBe(0);
      expect(info.lineEnd).toBe(13);
      expect(info.column).toBe(13);
    });

    it("returns correct info for multiline text - first line", () => {
      const text = "Line 1\nLine 2\nLine 3";
      const info = getLineInfo(text, 3); // In "Line 1"

      expect(info.lineNumber).toBe(0);
      expect(info.lineStart).toBe(0);
      expect(info.lineEnd).toBe(6);
      expect(info.column).toBe(3);
    });

    it("returns correct info for multiline text - second line", () => {
      const text = "Line 1\nLine 2\nLine 3";
      const info = getLineInfo(text, 10); // In "Line 2"

      expect(info.lineNumber).toBe(1);
      expect(info.lineStart).toBe(7);
      expect(info.lineEnd).toBe(13);
      expect(info.column).toBe(3);
    });

    it("returns correct info for multiline text - last line", () => {
      const text = "Line 1\nLine 2\nLine 3";
      const info = getLineInfo(text, 17); // In "Line 3"

      expect(info.lineNumber).toBe(2);
      expect(info.lineStart).toBe(14);
      expect(info.lineEnd).toBe(20);
      expect(info.column).toBe(3);
    });

    it("handles empty text", () => {
      const text = "";
      const info = getLineInfo(text, 0);

      expect(info.lineNumber).toBe(0);
      expect(info.lineStart).toBe(0);
      expect(info.lineEnd).toBe(0);
      expect(info.column).toBe(0);
    });

    it("handles cursor right after newline", () => {
      const text = "Line 1\nLine 2";
      const info = getLineInfo(text, 7); // Right after newline

      expect(info.lineNumber).toBe(1);
      expect(info.lineStart).toBe(7);
      expect(info.column).toBe(0);
    });

    it("handles empty line in middle", () => {
      const text = "Line 1\n\nLine 3";
      const info = getLineInfo(text, 7); // On empty line

      expect(info.lineNumber).toBe(1);
      expect(info.lineStart).toBe(7);
      expect(info.lineEnd).toBe(7);
      expect(info.column).toBe(0);
    });
  });

  describe("getLineCount", () => {
    it("returns 1 for empty string", () => {
      expect(getLineCount("")).toBe(1);
    });

    it("returns 1 for single line without newline", () => {
      expect(getLineCount("Hello")).toBe(1);
    });

    it("returns 2 for text with one newline", () => {
      expect(getLineCount("Hello\nWorld")).toBe(2);
    });

    it("returns 3 for text with two newlines", () => {
      expect(getLineCount("Line 1\nLine 2\nLine 3")).toBe(3);
    });

    it("counts trailing newline as additional line", () => {
      expect(getLineCount("Hello\n")).toBe(2);
    });
  });

  describe("getLinePositions", () => {
    it("returns correct positions for first line", () => {
      const text = "Line 1\nLine 2\nLine 3";
      const result = getLinePositions(text, 0);

      expect(result).not.toBeNull();
      expect(result!.lineStart).toBe(0);
      expect(result!.lineEnd).toBe(6);
    });

    it("returns correct positions for middle line", () => {
      const text = "Line 1\nLine 2\nLine 3";
      const result = getLinePositions(text, 1);

      expect(result).not.toBeNull();
      expect(result!.lineStart).toBe(7);
      expect(result!.lineEnd).toBe(13);
    });

    it("returns correct positions for last line", () => {
      const text = "Line 1\nLine 2\nLine 3";
      const result = getLinePositions(text, 2);

      expect(result).not.toBeNull();
      expect(result!.lineStart).toBe(14);
      expect(result!.lineEnd).toBe(20);
    });

    it("returns null for non-existent line", () => {
      const text = "Line 1\nLine 2";
      const result = getLinePositions(text, 5);

      expect(result).toBeNull();
    });

    it("handles single line text", () => {
      const text = "Hello";
      const result = getLinePositions(text, 0);

      expect(result).not.toBeNull();
      expect(result!.lineStart).toBe(0);
      expect(result!.lineEnd).toBe(5);
    });

    it("handles empty line", () => {
      const text = "Line 1\n\nLine 3";
      const result = getLinePositions(text, 1);

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

    it("sets selectionStart and selectionEnd to same value", () => {
      moveCursor(textarea, 5);

      expect(textarea.selectionStart).toBe(5);
      expect(textarea.selectionEnd).toBe(5);
    });

    it("clamps to 0 when position is negative", () => {
      moveCursor(textarea, -5);

      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(0);
    });

    it("clamps to text length when position exceeds length", () => {
      moveCursor(textarea, 100);

      expect(textarea.selectionStart).toBe(13);
      expect(textarea.selectionEnd).toBe(13);
    });

    it("handles position at start", () => {
      moveCursor(textarea, 0);

      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(0);
    });

    it("handles position at end", () => {
      moveCursor(textarea, 13);

      expect(textarea.selectionStart).toBe(13);
      expect(textarea.selectionEnd).toBe(13);
    });
  });
});

/**
 * Unit tests for executeExCommand function.
 *
 * @see REQ-15: :w saves file, remains in Pair Writing
 * @see REQ-16: :wq saves file and exits Pair Writing
 * @see REQ-17: :q exits if no unsaved changes; shows confirmation dialog if unsaved
 * @see REQ-18: :q! exits without saving (discards changes)
 */
describe("executeExCommand", () => {
  it(":w calls onSave callback only", () => {
    let saveCalled = false;
    let exitCalled = false;
    let quitWithUnsavedCalled = false;

    executeExCommand("w", {
      onSave: () => {
        saveCalled = true;
      },
      onExit: () => {
        exitCalled = true;
      },
      onQuitWithUnsaved: () => {
        quitWithUnsavedCalled = true;
      },
    });

    expect(saveCalled).toBe(true);
    expect(exitCalled).toBe(false);
    expect(quitWithUnsavedCalled).toBe(false);
  });

  it(":wq calls onSave then onExit", () => {
    const callOrder: string[] = [];

    executeExCommand("wq", {
      onSave: () => {
        callOrder.push("save");
      },
      onExit: () => {
        callOrder.push("exit");
      },
    });

    expect(callOrder).toEqual(["save", "exit"]);
  });

  it(":x is alias for :wq", () => {
    const callOrder: string[] = [];

    executeExCommand("x", {
      onSave: () => {
        callOrder.push("save");
      },
      onExit: () => {
        callOrder.push("exit");
      },
    });

    expect(callOrder).toEqual(["save", "exit"]);
  });

  it(":q calls onQuitWithUnsaved", () => {
    let quitWithUnsavedCalled = false;
    let exitCalled = false;

    executeExCommand("q", {
      onExit: () => {
        exitCalled = true;
      },
      onQuitWithUnsaved: () => {
        quitWithUnsavedCalled = true;
      },
    });

    expect(quitWithUnsavedCalled).toBe(true);
    expect(exitCalled).toBe(false);
  });

  it(":q! calls onExit directly (force quit)", () => {
    let exitCalled = false;
    let quitWithUnsavedCalled = false;

    executeExCommand("q!", {
      onExit: () => {
        exitCalled = true;
      },
      onQuitWithUnsaved: () => {
        quitWithUnsavedCalled = true;
      },
    });

    expect(exitCalled).toBe(true);
    expect(quitWithUnsavedCalled).toBe(false);
  });

  it("trims whitespace from command", () => {
    let saveCalled = false;

    executeExCommand("  w  ", {
      onSave: () => {
        saveCalled = true;
      },
    });

    expect(saveCalled).toBe(true);
  });

  it("unknown command is no-op", () => {
    let saveCalled = false;
    let exitCalled = false;
    let quitWithUnsavedCalled = false;

    executeExCommand("foo", {
      onSave: () => {
        saveCalled = true;
      },
      onExit: () => {
        exitCalled = true;
      },
      onQuitWithUnsaved: () => {
        quitWithUnsavedCalled = true;
      },
    });

    expect(saveCalled).toBe(false);
    expect(exitCalled).toBe(false);
    expect(quitWithUnsavedCalled).toBe(false);
  });

  it("empty command is no-op", () => {
    let saveCalled = false;

    executeExCommand("", {
      onSave: () => {
        saveCalled = true;
      },
    });

    expect(saveCalled).toBe(false);
  });

  it("handles empty callbacks object", () => {
    // Should not throw
    expect(() => executeExCommand("w", {})).not.toThrow();
    expect(() => executeExCommand("wq", {})).not.toThrow();
    expect(() => executeExCommand("q", {})).not.toThrow();
    expect(() => executeExCommand("q!", {})).not.toThrow();
  });
});

/**
 * Movement command tests.
 *
 * @see REQ-7: Movement: h (left), j (down), k (up), l (right)
 * @see REQ-8: Line movement: 0 (start of line), $ (end of line)
 */
describe("movement commands", () => {
  let textarea: HTMLTextAreaElement;
  let textareaRef: React.RefObject<HTMLTextAreaElement>;

  function createTextareaRef(ta: HTMLTextAreaElement) {
    return { current: ta } as React.RefObject<HTMLTextAreaElement>;
  }

  beforeEach(() => {
    textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textareaRef = createTextareaRef(textarea);
  });

  afterEach(() => {
    textarea.remove();
  });

  function getOptionsWithTextarea(): UseViModeOptions {
    return {
      enabled: true,
      textareaRef,
    };
  }

  describe("h (move left)", () => {
    it("moves cursor left one character", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(textarea.selectionStart).toBe(2);
      expect(textarea.selectionEnd).toBe(2);
    });

    it("stays at position 0 when already at start", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(0);
    });

    it("moves from position 1 to position 0", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 1;
      textarea.selectionEnd = 1;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(0);
    });

    it("collapses selection when moving", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 1;
      textarea.selectionEnd = 4; // Selection exists

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      // Moves based on selectionStart, collapses selection
      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(0);
    });
  });

  describe("l (move right)", () => {
    it("moves cursor right one character", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("l"));
      });

      expect(textarea.selectionStart).toBe(3);
      expect(textarea.selectionEnd).toBe(3);
    });

    it("stays at end when already at end", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("l"));
      });

      expect(textarea.selectionStart).toBe(5);
      expect(textarea.selectionEnd).toBe(5);
    });

    it("moves from second-to-last to last position", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 4;
      textarea.selectionEnd = 4;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("l"));
      });

      expect(textarea.selectionStart).toBe(5);
      expect(textarea.selectionEnd).toBe(5);
    });
  });

  describe("j (move down)", () => {
    it("moves cursor down one line", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 3; // "Lin|e 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("j"));
      });

      // Should be at position 10 ("Lin|e 2")
      expect(textarea.selectionStart).toBe(10);
      expect(textarea.selectionEnd).toBe(10);
    });

    it("maintains column position when moving down", () => {
      textarea.value = "Hello\nWorld";
      textarea.selectionStart = 2; // "He|llo"
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("j"));
      });

      // Should be at "Wo|rld" (position 8)
      expect(textarea.selectionStart).toBe(8);
      expect(textarea.selectionEnd).toBe(8);
    });

    it("clamps column when next line is shorter", () => {
      textarea.value = "Hello World\nHi";
      textarea.selectionStart = 8; // "Hello Wo|rld"
      textarea.selectionEnd = 8;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("j"));
      });

      // Next line only has 2 chars, should clamp to end (position 14 = 12 + 2)
      expect(textarea.selectionStart).toBe(14);
      expect(textarea.selectionEnd).toBe(14);
    });

    it("stays on last line when already at last line", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 17; // "Lin|e 3"
      textarea.selectionEnd = 17;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("j"));
      });

      // Should stay at same position
      expect(textarea.selectionStart).toBe(17);
      expect(textarea.selectionEnd).toBe(17);
    });

    it("works with single line text (stays in place)", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("j"));
      });

      expect(textarea.selectionStart).toBe(3);
      expect(textarea.selectionEnd).toBe(3);
    });

    it("handles empty lines", () => {
      textarea.value = "Line 1\n\nLine 3";
      textarea.selectionStart = 3; // "Lin|e 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("j"));
      });

      // Should go to empty line, column clamped to 0 (position 7)
      expect(textarea.selectionStart).toBe(7);
      expect(textarea.selectionEnd).toBe(7);
    });
  });

  describe("k (move up)", () => {
    it("moves cursor up one line", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 10; // "Lin|e 2"
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("k"));
      });

      // Should be at position 3 ("Lin|e 1")
      expect(textarea.selectionStart).toBe(3);
      expect(textarea.selectionEnd).toBe(3);
    });

    it("maintains column position when moving up", () => {
      textarea.value = "Hello\nWorld";
      textarea.selectionStart = 8; // "Wo|rld"
      textarea.selectionEnd = 8;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("k"));
      });

      // Should be at "He|llo" (position 2)
      expect(textarea.selectionStart).toBe(2);
      expect(textarea.selectionEnd).toBe(2);
    });

    it("clamps column when previous line is shorter", () => {
      textarea.value = "Hi\nHello World";
      textarea.selectionStart = 11; // "Hello Wo|rld"
      textarea.selectionEnd = 11;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("k"));
      });

      // Previous line only has 2 chars, should clamp to end (position 2)
      expect(textarea.selectionStart).toBe(2);
      expect(textarea.selectionEnd).toBe(2);
    });

    it("stays on first line when already at first line", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 3; // "Lin|e 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("k"));
      });

      // Should stay at same position
      expect(textarea.selectionStart).toBe(3);
      expect(textarea.selectionEnd).toBe(3);
    });

    it("works with single line text (stays in place)", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("k"));
      });

      expect(textarea.selectionStart).toBe(3);
      expect(textarea.selectionEnd).toBe(3);
    });

    it("handles empty lines", () => {
      textarea.value = "Line 1\n\nLine 3";
      textarea.selectionStart = 8; // "L|ine 3"
      textarea.selectionEnd = 8;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("k"));
      });

      // Should go to empty line, column clamped to 0 (position 7)
      expect(textarea.selectionStart).toBe(7);
      expect(textarea.selectionEnd).toBe(7);
    });
  });

  describe("0 (move to line start)", () => {
    it("moves cursor to start of current line", () => {
      textarea.value = "Hello, world!";
      textarea.selectionStart = 7;
      textarea.selectionEnd = 7;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("0"));
      });

      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(0);
    });

    it("stays at start when already at start", () => {
      textarea.value = "Hello, world!";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("0"));
      });

      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(0);
    });

    it("works on second line of multiline text", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 10; // "Lin|e 2"
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("0"));
      });

      expect(textarea.selectionStart).toBe(7); // Start of "Line 2"
      expect(textarea.selectionEnd).toBe(7);
    });

    it("works on empty line", () => {
      textarea.value = "Line 1\n\nLine 3";
      textarea.selectionStart = 7; // On the empty line
      textarea.selectionEnd = 7;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("0"));
      });

      expect(textarea.selectionStart).toBe(7);
      expect(textarea.selectionEnd).toBe(7);
    });

    it("works from end of line", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("0"));
      });

      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(0);
    });
  });

  describe("$ (move to line end)", () => {
    it("moves cursor to end of current line", () => {
      textarea.value = "Hello, world!";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("$"));
      });

      expect(textarea.selectionStart).toBe(13);
      expect(textarea.selectionEnd).toBe(13);
    });

    it("stays at end when already at end", () => {
      textarea.value = "Hello, world!";
      textarea.selectionStart = 13;
      textarea.selectionEnd = 13;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("$"));
      });

      expect(textarea.selectionStart).toBe(13);
      expect(textarea.selectionEnd).toBe(13);
    });

    it("works on middle line of multiline text", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 7; // "L|ine 2"
      textarea.selectionEnd = 7;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("$"));
      });

      expect(textarea.selectionStart).toBe(13); // End of "Line 2" (before newline)
      expect(textarea.selectionEnd).toBe(13);
    });

    it("works on empty line", () => {
      textarea.value = "Line 1\n\nLine 3";
      textarea.selectionStart = 7; // On the empty line
      textarea.selectionEnd = 7;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("$"));
      });

      expect(textarea.selectionStart).toBe(7);
      expect(textarea.selectionEnd).toBe(7);
    });

    it("works from start of line", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("$"));
      });

      expect(textarea.selectionStart).toBe(5);
      expect(textarea.selectionEnd).toBe(5);
    });

    it("does not include newline character", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("$"));
      });

      // Should be at position 6 (end of "Line 1"), not 7 (the newline)
      expect(textarea.selectionStart).toBe(6);
      expect(textarea.selectionEnd).toBe(6);
    });
  });

  describe("movement without textarea ref", () => {
    it("does not crash when textareaRef is not provided", () => {
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: undefined })
      );

      const event = createKeyEvent("h");
      act(() => {
        result.current.handleKeyDown(event);
      });

      // Should prevent default but not crash
      expect(event.defaultPrevented).toBe(true);
      expect(result.current.mode).toBe("normal");
    });

    it("does not crash when textareaRef.current is null", () => {
      const nullRef = {
        current: null,
      } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      const event = createKeyEvent("j");
      act(() => {
        result.current.handleKeyDown(event);
      });

      // Should prevent default but not crash
      expect(event.defaultPrevented).toBe(true);
      expect(result.current.mode).toBe("normal");
    });
  });

  describe("movement commands prevent default", () => {
    it("h prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("h");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("j prevents default", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("j");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("k prevents default", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("k");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("l prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("l");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("0 prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("0");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("$ prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("$");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });
  });
});

/**
 * Insert mode entry command tests.
 *
 * @see REQ-9: Insert mode entry: i (before cursor), a (after cursor),
 *             A (end of line), o (new line below), O (new line above)
 */
describe("insert mode entry commands", () => {
  let textarea: HTMLTextAreaElement;
  let textareaRef: React.RefObject<HTMLTextAreaElement>;

  function createTextareaRef(ta: HTMLTextAreaElement) {
    return { current: ta } as React.RefObject<HTMLTextAreaElement>;
  }

  beforeEach(() => {
    textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textareaRef = createTextareaRef(textarea);
  });

  afterEach(() => {
    textarea.remove();
  });

  function getOptionsWithTextarea(
    onContentChange?: (content: string) => void
  ): UseViModeOptions {
    return {
      enabled: true,
      textareaRef,
      onContentChange,
    };
  }

  describe("'i' command (insert at cursor)", () => {
    it("enters insert mode without moving cursor", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(2); // Cursor unchanged
      expect(textarea.selectionEnd).toBe(2);
    });

    it("works at start of text", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(0);
    });

    it("works at end of text", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(5);
    });

    it("works with empty text", () => {
      textarea.value = "";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(0);
    });
  });

  describe("'a' command (append after cursor)", () => {
    it("moves cursor right one position and enters insert mode", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("a"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(3); // Moved right
      expect(textarea.selectionEnd).toBe(3);
    });

    it("positions at end when already at end", () => {
      textarea.value = "Hi";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("a"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(2); // Stays at end (clamped)
    });

    it("works at start of text", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("a"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(1); // Moved to after first char
    });

    it("works with empty text", () => {
      textarea.value = "";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("a"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(0); // Stays at 0 (clamped)
    });
  });

  describe("'A' command (append at end of line)", () => {
    it("moves cursor to end of current line", () => {
      textarea.value = "Hello\nWorld";
      textarea.selectionStart = 2; // "He|llo"
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("A"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(5); // End of "Hello"
      expect(textarea.selectionEnd).toBe(5);
    });

    it("stays at end of single line text", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("A"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(5);
    });

    it("handles second line", () => {
      textarea.value = "Hello\nWorld";
      textarea.selectionStart = 8; // "Wo|rld"
      textarea.selectionEnd = 8;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("A"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(11); // End of "World"
    });

    it("positions at start of empty line", () => {
      textarea.value = "Hello\n\nWorld";
      textarea.selectionStart = 6; // Empty line
      textarea.selectionEnd = 6;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("A"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(6); // Same position (empty line)
    });

    it("works when already at end of line", () => {
      textarea.value = "Hello\nWorld";
      textarea.selectionStart = 5; // Already at end of "Hello"
      textarea.selectionEnd = 5;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("A"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.selectionStart).toBe(5); // Stays at end
    });
  });

  describe("'o' command (open line below)", () => {
    it("inserts newline after current line and positions cursor", () => {
      textarea.value = "Hello\nWorld";
      textarea.selectionStart = 2; // "He|llo"
      textarea.selectionEnd = 2;

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(
          getOptionsWithTextarea((content) => {
            capturedContent = content;
          })
        )
      );

      act(() => {
        result.current.handleKeyDown(createKeyEvent("o"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("Hello\n\nWorld"); // Newline inserted
      expect(textarea.selectionStart).toBe(6); // Cursor on new blank line
      expect(capturedContent).toBe("Hello\n\nWorld");
    });

    it("creates new last line", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("o"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("Hello\n");
      expect(textarea.selectionStart).toBe(6); // After newline
    });

    it("works with cursor at end of line", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 6; // End of "Line 1"
      textarea.selectionEnd = 6;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("o"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("Line 1\n\nLine 2");
      expect(textarea.selectionStart).toBe(7);
    });

    it("works on last line of multi-line text", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 10; // "Lin|e 2"
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("o"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("Line 1\nLine 2\n");
      expect(textarea.selectionStart).toBe(14); // After final newline
    });

    it("works with empty text", () => {
      textarea.value = "";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("o"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("\n");
      expect(textarea.selectionStart).toBe(1);
    });
  });

  describe("'O' command (open line above)", () => {
    it("inserts newline before current line and positions cursor", () => {
      textarea.value = "Hello\nWorld";
      textarea.selectionStart = 8; // "Wo|rld"
      textarea.selectionEnd = 8;

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(
          getOptionsWithTextarea((content) => {
            capturedContent = content;
          })
        )
      );

      act(() => {
        result.current.handleKeyDown(createKeyEvent("O"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("Hello\n\nWorld"); // Newline inserted before "World"
      expect(textarea.selectionStart).toBe(6); // Cursor on new blank line
      expect(capturedContent).toBe("Hello\n\nWorld");
    });

    it("creates new first line", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("O"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("\nHello");
      expect(textarea.selectionStart).toBe(0); // At start of new blank line
    });

    it("works when on first line of multi-line text", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 3; // "Lin|e 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("O"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("\nLine 1\nLine 2");
      expect(textarea.selectionStart).toBe(0);
    });

    it("works when cursor at start of line", () => {
      textarea.value = "Hello\nWorld";
      textarea.selectionStart = 6; // Start of "World"
      textarea.selectionEnd = 6;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("O"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("Hello\n\nWorld");
      expect(textarea.selectionStart).toBe(6); // On new blank line
    });

    it("works with empty text", () => {
      textarea.value = "";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("O"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("\n");
      expect(textarea.selectionStart).toBe(0);
    });

    it("handles middle line correctly", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 10; // "Lin|e 2"
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("O"));
      });

      expect(result.current.mode).toBe("insert");
      expect(textarea.value).toBe("Line 1\n\nLine 2\nLine 3");
      expect(textarea.selectionStart).toBe(7); // On new blank line
    });
  });

  describe("insert mode entry prevents default", () => {
    it("'i' prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("i");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("'a' prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("a");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("'A' prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("A");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("'o' prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("o");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("'O' prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("O");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });
  });
});

/**
 * Undo stack tests.
 *
 * @see REQ-12: Undo: u undoes last edit operation (maintains internal undo stack)
 * @see TD-9: Undo stack implementation in .lore/plans/vi-mode-pair-writing.md
 */
describe("undo stack", () => {
  let textarea: HTMLTextAreaElement;
  let textareaRef: React.RefObject<HTMLTextAreaElement>;

  function createTextareaRef(ta: HTMLTextAreaElement) {
    return { current: ta } as React.RefObject<HTMLTextAreaElement>;
  }

  beforeEach(() => {
    textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textareaRef = createTextareaRef(textarea);
  });

  afterEach(() => {
    textarea.remove();
  });

  function getOptionsWithTextarea(
    onContentChange?: (content: string) => void
  ): UseViModeOptions {
    return {
      enabled: true,
      textareaRef,
      onContentChange,
    };
  }

  describe("pushUndoState", () => {
    it("increases undo stack size when called", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      expect(result.current.undoStackSize).toBe(0);

      act(() => {
        result.current.pushUndoState();
      });

      expect(result.current.undoStackSize).toBe(1);
    });

    it("pushes state before entering insert mode via 'i'", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      expect(result.current.undoStackSize).toBe(0);

      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });

      expect(result.current.mode).toBe("insert");
      expect(result.current.undoStackSize).toBe(1);
    });

    it("pushes state before entering insert mode via 'a'", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("a"));
      });

      expect(result.current.mode).toBe("insert");
      expect(result.current.undoStackSize).toBe(1);
    });

    it("pushes state before entering insert mode via 'A'", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("A"));
      });

      expect(result.current.mode).toBe("insert");
      expect(result.current.undoStackSize).toBe(1);
    });

    it("pushes state before 'o' command (which modifies content)", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("o"));
      });

      expect(result.current.mode).toBe("insert");
      expect(result.current.undoStackSize).toBe(1);
    });

    it("pushes state before 'O' command (which modifies content)", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("O"));
      });

      expect(result.current.mode).toBe("insert");
      expect(result.current.undoStackSize).toBe(1);
    });

    it("does not push state for movement commands", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(result.current.undoStackSize).toBe(0);

      act(() => {
        result.current.handleKeyDown(createKeyEvent("l"));
      });

      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("'u' command (undo)", () => {
    it("prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("u");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("does nothing when undo stack is empty", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      // Content and cursor should be unchanged
      expect(textarea.value).toBe("Hello");
      expect(textarea.selectionStart).toBe(2);
      expect(result.current.undoStackSize).toBe(0);
    });

    it("restores content from undo stack", () => {
      textarea.value = "Original";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(
          getOptionsWithTextarea((content) => {
            capturedContent = content;
          })
        )
      );

      // Push the original state to undo stack
      act(() => {
        result.current.pushUndoState();
      });

      // Simulate an edit (in real usage, this would be insert mode changes)
      textarea.value = "Modified";
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;

      // Now undo
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("Original");
      expect(capturedContent).toBe("Original");
    });

    it("restores cursor position from undo stack", () => {
      textarea.value = "Hello World";
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Push state with cursor at position 5
      act(() => {
        result.current.pushUndoState();
      });

      // Move cursor
      textarea.selectionStart = 8;
      textarea.selectionEnd = 8;

      // Undo should restore cursor to position 5
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.selectionStart).toBe(5);
      expect(textarea.selectionEnd).toBe(5);
    });

    it("decreases undo stack size when undo is performed", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Push two states
      act(() => {
        result.current.pushUndoState();
      });
      act(() => {
        result.current.pushUndoState();
      });

      expect(result.current.undoStackSize).toBe(2);

      // Undo once
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(result.current.undoStackSize).toBe(1);

      // Undo again
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(result.current.undoStackSize).toBe(0);
    });

    it("supports multiple consecutive undos", () => {
      textarea.value = "State 1";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Push State 1
      act(() => {
        result.current.pushUndoState();
      });

      // Change to State 2
      textarea.value = "State 2";
      textarea.selectionStart = 1;
      textarea.selectionEnd = 1;

      // Push State 2
      act(() => {
        result.current.pushUndoState();
      });

      // Change to State 3
      textarea.value = "State 3";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      // First undo: back to State 2
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("State 2");
      expect(textarea.selectionStart).toBe(1);

      // Second undo: back to State 1
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("State 1");
      expect(textarea.selectionStart).toBe(0);

      // Third undo: stack is empty, no change
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("State 1");
      expect(textarea.selectionStart).toBe(0);
    });

    it("undoes 'o' command modifications", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Enter insert mode via 'o' (this pushes undo state first)
      act(() => {
        result.current.handleKeyDown(createKeyEvent("o"));
      });

      expect(textarea.value).toBe("Hello\n");
      expect(result.current.mode).toBe("insert");

      // Exit insert mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });

      expect(result.current.mode).toBe("normal");

      // Undo should restore original content
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("Hello");
      expect(textarea.selectionStart).toBe(3);
    });

    it("undoes 'O' command modifications", () => {
      textarea.value = "World";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Enter insert mode via 'O' (this pushes undo state first)
      act(() => {
        result.current.handleKeyDown(createKeyEvent("O"));
      });

      expect(textarea.value).toBe("\nWorld");
      expect(result.current.mode).toBe("insert");

      // Exit insert mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });

      // Undo should restore original content
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("World");
      expect(textarea.selectionStart).toBe(2);
    });

    it("batches insert mode changes into single undo entry", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Enter insert mode (pushes undo state)
      act(() => {
        result.current.handleKeyDown(createKeyEvent("a"));
      });

      expect(result.current.undoStackSize).toBe(1);

      // Simulate typing multiple characters in insert mode
      // (In real usage, the browser handles this, we just simulate the result)
      textarea.value = "Hello World";
      textarea.selectionStart = 11;
      textarea.selectionEnd = 11;

      // Exit insert mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });

      // Stack size should still be 1 (no new entries during insert mode)
      expect(result.current.undoStackSize).toBe(1);

      // Single undo should restore the entire insert mode session
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("Hello");
      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("undo stack depth limit", () => {
    it("limits stack to 100 entries", () => {
      textarea.value = "Test";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Push 105 states
      for (let i = 0; i < 105; i++) {
        act(() => {
          result.current.pushUndoState();
        });
      }

      // Stack should be capped at 100
      expect(result.current.undoStackSize).toBe(100);
    });

    it("removes oldest entries when limit exceeded", () => {
      textarea.value = "Entry 0";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Push first state (Entry 0)
      act(() => {
        result.current.pushUndoState();
      });

      // Push 100 more states (101 total, limit is 100)
      for (let i = 1; i <= 100; i++) {
        textarea.value = `Entry ${i}`;
        textarea.selectionStart = i;
        textarea.selectionEnd = i;
        act(() => {
          result.current.pushUndoState();
        });
      }

      // Set to final state
      textarea.value = "Final";
      textarea.selectionStart = 101;
      textarea.selectionEnd = 101;

      // Stack should have 100 entries, oldest (Entry 0) should be removed
      expect(result.current.undoStackSize).toBe(100);

      // Undo 100 times - should get to "Entry 1" (Entry 0 was removed)
      for (let i = 0; i < 100; i++) {
        act(() => {
          result.current.handleKeyDown(createKeyEvent("u"));
        });
      }

      // After 100 undos, we should be at the oldest remaining entry
      // The oldest entry is "Entry 1" (Entry 0 was removed when we exceeded 100)
      expect(textarea.value).toBe("Entry 1");
      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("undo without textarea", () => {
    it("does not crash when textareaRef is not provided", () => {
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: undefined })
      );

      // Push should not crash
      act(() => {
        result.current.pushUndoState();
      });

      // Undo should not crash
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(result.current.undoStackSize).toBe(0);
    });

    it("does not crash when textareaRef.current is null", () => {
      const nullRef = {
        current: null,
      } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      // Push should not crash
      act(() => {
        result.current.pushUndoState();
      });

      // Undo should not crash
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(result.current.undoStackSize).toBe(0);
    });
  });
});

/**
 * Delete command tests.
 *
 * @see REQ-10: Delete: x (character), dd (line)
 */
describe("delete commands", () => {
  let textarea: HTMLTextAreaElement;
  let textareaRef: React.RefObject<HTMLTextAreaElement>;

  function createTextareaRef(ta: HTMLTextAreaElement) {
    return { current: ta } as React.RefObject<HTMLTextAreaElement>;
  }

  beforeEach(() => {
    textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textareaRef = createTextareaRef(textarea);
  });

  afterEach(() => {
    textarea.remove();
  });

  function getOptionsWithTextarea(
    onContentChange?: (content: string) => void
  ): UseViModeOptions {
    return {
      enabled: true,
      textareaRef,
      onContentChange,
    };
  }

  describe("'x' command (delete character)", () => {
    it("deletes the character at cursor position", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(
          getOptionsWithTextarea((content) => {
            capturedContent = content;
          })
        )
      );

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(textarea.value).toBe("Helo");
      expect(capturedContent).toBe("Helo");
    });

    it("prevents default", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("x");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("keeps cursor at same position after delete", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(textarea.selectionStart).toBe(2);
      expect(textarea.selectionEnd).toBe(2);
    });

    it("clamps cursor when deleting last character", () => {
      textarea.value = "Hi";
      textarea.selectionStart = 1;
      textarea.selectionEnd = 1;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(textarea.value).toBe("H");
      expect(textarea.selectionStart).toBe(1); // Clamped to end
    });

    it("does nothing when cursor is at end of text", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(textarea.value).toBe("Hello");
      expect(textarea.selectionStart).toBe(5);
    });

    it("does nothing on empty text", () => {
      textarea.value = "";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(textarea.value).toBe("");
    });

    it("pushes to undo stack before delete", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      expect(result.current.undoStackSize).toBe(0);

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(result.current.undoStackSize).toBe(1);
    });

    it("does not push to undo stack when nothing to delete", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 5; // At end
      textarea.selectionEnd = 5;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(result.current.undoStackSize).toBe(0);
    });

    it("can be undone with 'u'", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(textarea.value).toBe("Helo");

      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("Hello");
      expect(textarea.selectionStart).toBe(2);
    });

    it("deletes newline character when cursor is on it", () => {
      textarea.value = "Hello\nWorld";
      textarea.selectionStart = 5; // On the newline
      textarea.selectionEnd = 5;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(textarea.value).toBe("HelloWorld");
    });

    it("deletes first character when at position 0", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(textarea.value).toBe("ello");
      expect(textarea.selectionStart).toBe(0);
    });
  });

  describe("'dd' command (delete line)", () => {
    it("sets pending operator on first 'd' press", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(result.current.pendingOperator).toBe("d");
      expect(textarea.value).toBe("Hello"); // No change yet
    });

    it("prevents default on 'd' press", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("d");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("deletes line on 'dd' sequence", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 10; // In "Line 2"
      textarea.selectionEnd = 10;

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(
          getOptionsWithTextarea((content) => {
            capturedContent = content;
          })
        )
      );

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(textarea.value).toBe("Line 1\nLine 3");
      expect(capturedContent).toBe("Line 1\nLine 3");
    });

    it("clears pending operator after dd execution", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(result.current.pendingOperator).toBeNull();
    });

    it("positions cursor at start of next line after delete", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 10; // In "Line 2"
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      // Cursor should be at start of what was "Line 3" (now at position 7)
      expect(textarea.selectionStart).toBe(7);
    });

    it("deletes last line and positions cursor at previous line", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 10; // In "Line 2"
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(textarea.value).toBe("Line 1");
      // Cursor should be at start of Line 1
      expect(textarea.selectionStart).toBe(0);
    });

    it("deletes only line leaving empty document", () => {
      textarea.value = "Only line";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(textarea.value).toBe("");
      expect(textarea.selectionStart).toBe(0);
    });

    it("deletes first line of multi-line text", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 3; // In "Line 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(textarea.value).toBe("Line 2\nLine 3");
      expect(textarea.selectionStart).toBe(0);
    });

    it("deletes empty line", () => {
      textarea.value = "Line 1\n\nLine 3";
      textarea.selectionStart = 7; // On empty line
      textarea.selectionEnd = 7;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(textarea.value).toBe("Line 1\nLine 3");
    });

    it("does nothing on empty document", () => {
      textarea.value = "";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(textarea.value).toBe("");
    });

    it("pushes to undo stack before delete", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      expect(result.current.undoStackSize).toBe(0);

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      // First 'd' should not push undo state yet
      expect(result.current.undoStackSize).toBe(0);

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      // Second 'd' (execution) should push undo state
      expect(result.current.undoStackSize).toBe(1);
    });

    it("does not push undo state on empty document", () => {
      textarea.value = "";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(result.current.undoStackSize).toBe(0);
    });

    it("can be undone with 'u'", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 10; // In "Line 2"
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(textarea.value).toBe("Line 1\nLine 3");

      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("Line 1\nLine 2\nLine 3");
      expect(textarea.selectionStart).toBe(10);
    });

    it("clears pending operator when other key is pressed", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(result.current.pendingOperator).toBe("d");

      // Press a different key
      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(result.current.pendingOperator).toBeNull();
    });

    it("clears pending operator on insert mode entry", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(result.current.pendingOperator).toBe("d");

      // Enter insert mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });

      expect(result.current.pendingOperator).toBeNull();
      expect(result.current.mode).toBe("insert");
    });

    it("clears pending operator on Escape in Normal mode", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Press 'd' to set pending operator
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(result.current.pendingOperator).toBe("d");
      expect(result.current.mode).toBe("normal");

      // Press Escape in normal mode to cancel
      const escEvent = createKeyEvent("Escape");
      act(() => {
        result.current.handleKeyDown(escEvent);
      });

      expect(result.current.pendingOperator).toBeNull();
      expect(result.current.mode).toBe("normal"); // Still in normal mode
      expect(escEvent.defaultPrevented).toBe(true);
    });

    it("clears pending 'y' operator on Escape in Normal mode", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Press 'y' to set pending operator
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.pendingOperator).toBe("y");

      // Press Escape to cancel
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });

      expect(result.current.pendingOperator).toBeNull();
    });

    it("clears pending count on Escape in Normal mode", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Press '5' to set pending count
      act(() => {
        result.current.handleKeyDown(createKeyEvent("5"));
      });

      expect(result.current.pendingCount).toBe(5);

      // Press Escape to cancel
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });

      expect(result.current.pendingCount).toBeNull();
    });

    it("clears both pending count and operator on Escape in Normal mode", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Type "3d" (count + operator pending)
      act(() => {
        result.current.handleKeyDown(createKeyEvent("3"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(result.current.pendingCount).toBe(3);
      expect(result.current.pendingOperator).toBe("d");

      // Press Escape to cancel both
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });

      expect(result.current.pendingCount).toBeNull();
      expect(result.current.pendingOperator).toBeNull();
    });
  });

  describe("delete without textarea", () => {
    it("'x' does not crash when textareaRef is null", () => {
      const nullRef = {
        current: null,
      } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      const event = createKeyEvent("x");
      act(() => {
        result.current.handleKeyDown(event);
      });

      // Should prevent default but not crash
      expect(event.defaultPrevented).toBe(true);
    });

    it("'dd' does not crash when textareaRef is null", () => {
      const nullRef = {
        current: null,
      } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      // Should not crash
      expect(result.current.mode).toBe("normal");
    });
  });
});

/**
 * Yank/Put command tests.
 *
 * @see REQ-11: Yank/put: yy (copy line), p (paste after), P (paste before)
 * @see REQ-20: Yank/put operations use internal clipboard (separate from system)
 * @see REQ-21: Clipboard persists within Pair Writing session
 */
describe("yank/put commands", () => {
  let textarea: HTMLTextAreaElement;
  let textareaRef: React.RefObject<HTMLTextAreaElement>;

  function createTextareaRef(ta: HTMLTextAreaElement) {
    return { current: ta } as React.RefObject<HTMLTextAreaElement>;
  }

  beforeEach(() => {
    textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textareaRef = createTextareaRef(textarea);
  });

  afterEach(() => {
    textarea.remove();
  });

  function getOptionsWithTextarea(
    onContentChange?: (content: string) => void
  ): UseViModeOptions {
    return {
      enabled: true,
      textareaRef,
      onContentChange,
    };
  }

  describe("'yy' command (yank line)", () => {
    it("sets pending operator on first 'y' press", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.pendingOperator).toBe("y");
      expect(textarea.value).toBe("Hello"); // No change
    });

    it("prevents default on 'y' press", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("y");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("yanks line to clipboard on 'yy' sequence", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 10; // In "Line 2"
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.clipboard).toBe("Line 2");
      expect(textarea.value).toBe("Line 1\nLine 2\nLine 3"); // No change to text
    });

    it("clears pending operator after yy execution", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.pendingOperator).toBeNull();
    });

    it("yanks empty line", () => {
      textarea.value = "Line 1\n\nLine 3";
      textarea.selectionStart = 7; // On empty line
      textarea.selectionEnd = 7;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.clipboard).toBe("");
    });

    it("yanks first line", () => {
      textarea.value = "First\nSecond";
      textarea.selectionStart = 2; // In "First"
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.clipboard).toBe("First");
    });

    it("yanks last line", () => {
      textarea.value = "First\nLast";
      textarea.selectionStart = 8; // In "Last"
      textarea.selectionEnd = 8;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.clipboard).toBe("Last");
    });

    it("clipboard persists across multiple yanks (last yank wins)", () => {
      textarea.value = "Line A\nLine B\nLine C";
      textarea.selectionStart = 3; // In "Line A"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Yank Line A
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.clipboard).toBe("Line A");

      // Move to Line B and yank
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.clipboard).toBe("Line B");
    });

    it("does not push to undo stack (yank is non-destructive)", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.undoStackSize).toBe(0);
    });
  });

  describe("'p' command (paste after)", () => {
    it("pastes clipboard content after current line", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 3; // In "Line 1"
      textarea.selectionEnd = 3;

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(
          getOptionsWithTextarea((content) => {
            capturedContent = content;
          })
        )
      );

      // First yank Line 2
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      // Move back to Line 1 and paste after
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("p"));
      });

      expect(textarea.value).toBe("Line 1\nLine 2\nLine 2\nLine 3");
      expect(capturedContent).toBe("Line 1\nLine 2\nLine 2\nLine 3");
    });

    it("prevents default on 'p' press", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("p");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("positions cursor at start of pasted line", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 3; // In "Line 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Yank Line 2
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      // Move to Line 1 and paste
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("p"));
      });

      // Cursor should be at start of pasted line (after "Line 1\n")
      expect(textarea.selectionStart).toBe(7);
    });

    it("does nothing with empty clipboard", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // No yank, clipboard is null
      expect(result.current.clipboard).toBeNull();

      act(() => {
        result.current.handleKeyDown(createKeyEvent("p"));
      });

      // Content unchanged
      expect(textarea.value).toBe("Line 1\nLine 2");
    });

    it("pushes to undo stack before paste", () => {
      textarea.value = "Line 1";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Yank current line
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.undoStackSize).toBe(0);

      // Paste
      act(() => {
        result.current.handleKeyDown(createKeyEvent("p"));
      });

      expect(result.current.undoStackSize).toBe(1);
    });

    it("paste on last line creates new last line", () => {
      textarea.value = "First\nLast";
      textarea.selectionStart = 8; // In "Last"
      textarea.selectionEnd = 8;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Yank "First"
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      // Move to Last and paste after
      textarea.selectionStart = 8;
      textarea.selectionEnd = 8;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("p"));
      });

      expect(textarea.value).toBe("First\nLast\nFirst");
    });

    it("can undo paste operation", () => {
      textarea.value = "Original";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Yank and paste
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("p"));
      });

      expect(textarea.value).toBe("Original\nOriginal");

      // Undo
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("Original");
    });
  });

  describe("'P' command (paste before)", () => {
    it("pastes clipboard content before current line", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 10; // In "Line 2"
      textarea.selectionEnd = 10;

      let capturedContent = "";
      const { result } = renderHook(() =>
        useViMode(
          getOptionsWithTextarea((content) => {
            capturedContent = content;
          })
        )
      );

      // First yank Line 1
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      // Move to Line 2 and paste before
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("P"));
      });

      expect(textarea.value).toBe("Line 1\nLine 1\nLine 2\nLine 3");
      expect(capturedContent).toBe("Line 1\nLine 1\nLine 2\nLine 3");
    });

    it("prevents default on 'P' press", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("P");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("positions cursor at start of pasted line", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 10; // In "Line 2"
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Yank Line 1
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      // Move to Line 2 and paste before
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("P"));
      });

      // Cursor should be at start of pasted line (at "Line 1" insertion point)
      expect(textarea.selectionStart).toBe(7);
    });

    it("does nothing with empty clipboard", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // No yank, clipboard is null
      expect(result.current.clipboard).toBeNull();

      act(() => {
        result.current.handleKeyDown(createKeyEvent("P"));
      });

      // Content unchanged
      expect(textarea.value).toBe("Line 1\nLine 2");
    });

    it("pushes to undo stack before paste", () => {
      textarea.value = "Line 1";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Yank current line
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.undoStackSize).toBe(0);

      // Paste before
      act(() => {
        result.current.handleKeyDown(createKeyEvent("P"));
      });

      expect(result.current.undoStackSize).toBe(1);
    });

    it("paste on first line creates new first line", () => {
      textarea.value = "First\nSecond";
      textarea.selectionStart = 2; // In "First"
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Yank "Second"
      textarea.selectionStart = 8;
      textarea.selectionEnd = 8;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      // Move to First and paste before
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;
      act(() => {
        result.current.handleKeyDown(createKeyEvent("P"));
      });

      expect(textarea.value).toBe("Second\nFirst\nSecond");
    });

    it("can undo paste operation", () => {
      textarea.value = "Original";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Yank and paste before
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("P"));
      });

      expect(textarea.value).toBe("Original\nOriginal");

      // Undo
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      expect(textarea.value).toBe("Original");
    });
  });

  describe("pending operator interaction", () => {
    it("other keys clear pending 'y' operator", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.pendingOperator).toBe("y");

      // Press 'h' (movement key)
      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(result.current.pendingOperator).toBeNull();
    });

    it("'y' then 'd' starts delete operator (not yank)", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.pendingOperator).toBe("y");

      // Press 'd' - should start delete operator
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(result.current.pendingOperator).toBe("d");
    });

    it("'d' then 'y' starts yank operator (not delete)", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(result.current.pendingOperator).toBe("d");

      // Press 'y' - should start yank operator
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.pendingOperator).toBe("y");
    });
  });

  describe("yank/put without textarea", () => {
    it("'yy' does not crash when textareaRef is null", () => {
      const nullRef = {
        current: null,
      } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      // Should not crash
      expect(result.current.mode).toBe("normal");
    });

    it("'p' does not crash when textareaRef is null", () => {
      const nullRef = {
        current: null,
      } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      const event = createKeyEvent("p");
      act(() => {
        result.current.handleKeyDown(event);
      });

      // Should prevent default but not crash
      expect(event.defaultPrevented).toBe(true);
    });

    it("'P' does not crash when textareaRef is null", () => {
      const nullRef = {
        current: null,
      } as React.RefObject<HTMLTextAreaElement | null>;
      const { result } = renderHook(() =>
        useViMode({ enabled: true, textareaRef: nullRef })
      );

      const event = createKeyEvent("P");
      act(() => {
        result.current.handleKeyDown(event);
      });

      // Should prevent default but not crash
      expect(event.defaultPrevented).toBe(true);
    });
  });
});

/**
 * Numeric prefix tests.
 *
 * @see REQ-13: Numeric prefixes for command repetition (e.g., 5j, 3dd, 2x)
 * @see TD-8: Numeric prefix handling
 */
describe("numeric prefixes", () => {
  let textarea: HTMLTextAreaElement;
  let textareaRef: React.RefObject<HTMLTextAreaElement>;

  function createTextareaRef(ta: HTMLTextAreaElement) {
    return { current: ta } as React.RefObject<HTMLTextAreaElement>;
  }

  beforeEach(() => {
    textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textareaRef = createTextareaRef(textarea);
  });

  afterEach(() => {
    textarea.remove();
  });

  function getOptionsWithTextarea(
    onContentChange?: (content: string) => void
  ): UseViModeOptions {
    return {
      enabled: true,
      textareaRef,
      onContentChange,
    };
  }

  describe("count accumulation", () => {
    it("starts with null pending count", () => {
      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      expect(result.current.pendingCount).toBeNull();
    });

    it("accumulates digits 1-9 as count", () => {
      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("5"));
      });

      expect(result.current.pendingCount).toBe(5);
    });

    it("accumulates multiple digits", () => {
      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("1"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("2"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("3"));
      });

      expect(result.current.pendingCount).toBe(123);
    });

    it("treats 0 as movement command when no count pending", () => {
      textarea.value = "Hello, world!";
      textarea.selectionStart = 7;
      textarea.selectionEnd = 7;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("0"));
      });

      // Should move to line start, not set count
      expect(result.current.pendingCount).toBeNull();
      expect(textarea.selectionStart).toBe(0);
    });

    it("treats 0 as digit when count is pending (10j case)", () => {
      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("1"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("0"));
      });

      expect(result.current.pendingCount).toBe(10);
    });

    it("prevents default for digit keys", () => {
      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      const event = createKeyEvent("5");
      act(() => {
        result.current.handleKeyDown(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });

    it("clears count when entering insert mode", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("5"));
      });
      expect(result.current.pendingCount).toBe(5);

      // Enter insert mode
      act(() => {
        result.current.handleKeyDown(createKeyEvent("i"));
      });

      // Count should be cleared when entering insert mode
      expect(result.current.pendingCount).toBeNull();
    });

    it("clears count after command execution", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 4;
      textarea.selectionEnd = 4;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("2"));
      });
      expect(result.current.pendingCount).toBe(2);

      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(result.current.pendingCount).toBeNull();
      expect(textarea.selectionStart).toBe(2); // Moved 2 left
    });
  });

  describe("movement with count", () => {
    it("5h moves left 5 characters", () => {
      textarea.value = "Hello, world!";
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("5"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(textarea.selectionStart).toBe(5);
    });

    it("5l moves right 5 characters", () => {
      textarea.value = "Hello, world!";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("5"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("l"));
      });

      expect(textarea.selectionStart).toBe(5);
    });

    it("3j moves down 3 lines", () => {
      textarea.value = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      textarea.selectionStart = 3; // In "Line 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("3"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("j"));
      });

      // Should be on Line 4, column 3
      expect(textarea.selectionStart).toBe(24); // "Line 1\nLine 2\nLine 3\n" = 21, + 3 = 24
    });

    it("3k moves up 3 lines", () => {
      textarea.value = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      textarea.selectionStart = 24; // In "Line 4"
      textarea.selectionEnd = 24;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("3"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("k"));
      });

      // Should be on Line 1, column 3
      expect(textarea.selectionStart).toBe(3);
    });

    it("clamps h movement at beginning of text", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(textarea.selectionStart).toBe(0);
    });

    it("clamps l movement at end of text", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("l"));
      });

      expect(textarea.selectionStart).toBe(5);
    });

    it("j stops at last line when count exceeds available lines", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 3; // In "Line 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("j"));
      });

      // Should be on Line 3 (last line), column 3
      expect(textarea.selectionStart).toBe(17);
    });

    it("k stops at first line when count exceeds available lines", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 17; // In "Line 3"
      textarea.selectionEnd = 17;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("k"));
      });

      // Should be on Line 1 (first line), column 3
      expect(textarea.selectionStart).toBe(3);
    });
  });

  describe("delete with count", () => {
    it("3x deletes 3 characters", () => {
      textarea.value = "Hello, world!";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("3"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(textarea.value).toBe("lo, world!");
      expect(textarea.selectionStart).toBe(0);
    });

    it("x clamps delete count to available characters", () => {
      textarea.value = "Hi";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });

      expect(textarea.value).toBe("");
    });

    it("3dd deletes 3 lines", () => {
      textarea.value = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      textarea.selectionStart = 3; // In "Line 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("3"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(textarea.value).toBe("Line 4\nLine 5");
      expect(textarea.selectionStart).toBe(0);
    });

    it("dd clamps line count to available lines", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 3; // In "Line 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(textarea.value).toBe("");
    });

    it("dd with count from middle of document", () => {
      textarea.value = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      textarea.selectionStart = 10; // In "Line 2"
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("2"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      expect(textarea.value).toBe("Line 1\nLine 4\nLine 5");
    });

    it("dd with count from near end of document", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 17; // In "Line 3"
      textarea.selectionEnd = 17;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("5"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });

      // Should delete just Line 3 (only 1 line available)
      expect(textarea.value).toBe("Line 1\nLine 2");
    });
  });

  describe("yank with count", () => {
    it("3yy yanks 3 lines", () => {
      textarea.value = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      textarea.selectionStart = 3; // In "Line 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("3"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.clipboard).toBe("Line 1\nLine 2\nLine 3");
      // Text should be unchanged
      expect(textarea.value).toBe("Line 1\nLine 2\nLine 3\nLine 4\nLine 5");
    });

    it("yy clamps line count to available lines", () => {
      textarea.value = "Line 1\nLine 2";
      textarea.selectionStart = 3; // In "Line 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.clipboard).toBe("Line 1\nLine 2");
    });

    it("multi-line yank and paste works correctly", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 3; // In "Line 1"
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Yank 2 lines
      act(() => {
        result.current.handleKeyDown(createKeyEvent("2"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });

      expect(result.current.clipboard).toBe("Line 1\nLine 2");

      // Move to Line 3 and paste after
      textarea.selectionStart = 17;
      textarea.selectionEnd = 17;

      act(() => {
        result.current.handleKeyDown(createKeyEvent("p"));
      });

      expect(textarea.value).toBe("Line 1\nLine 2\nLine 3\nLine 1\nLine 2");
    });
  });

  describe("count with pending operator", () => {
    it("count persists across first d key", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("2"));
      });
      expect(result.current.pendingCount).toBe(2);

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      // Count should still be there, pending operator set
      expect(result.current.pendingOperator).toBe("d");
      expect(result.current.pendingCount).toBe(2);

      act(() => {
        result.current.handleKeyDown(createKeyEvent("d"));
      });
      // Now both should be cleared
      expect(result.current.pendingOperator).toBeNull();
      expect(result.current.pendingCount).toBeNull();
      expect(textarea.value).toBe("Line 3");
    });

    it("count persists across first y key", () => {
      textarea.value = "Line 1\nLine 2\nLine 3";
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("2"));
      });
      expect(result.current.pendingCount).toBe(2);

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      // Count should still be there, pending operator set
      expect(result.current.pendingOperator).toBe("y");
      expect(result.current.pendingCount).toBe(2);

      act(() => {
        result.current.handleKeyDown(createKeyEvent("y"));
      });
      // Now both should be cleared
      expect(result.current.pendingOperator).toBeNull();
      expect(result.current.pendingCount).toBeNull();
      expect(result.current.clipboard).toBe("Line 1\nLine 2");
    });
  });

  describe("edge cases", () => {
    it("handles very large counts gracefully", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Type 999
      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("9"));
      });

      expect(result.current.pendingCount).toBe(999);

      // Move left should clamp to start
      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(textarea.selectionStart).toBe(0);
      expect(result.current.pendingCount).toBeNull();
    });

    it("count clears when entering command mode", () => {
      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      act(() => {
        result.current.handleKeyDown(createKeyEvent("5"));
      });
      expect(result.current.pendingCount).toBe(5);

      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });

      expect(result.current.mode).toBe("command");
      expect(result.current.pendingCount).toBeNull();
    });

    it("count does not apply to 0 movement (0 is always line start)", () => {
      textarea.value = "    Hello, world!";
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Start a count, then press 0
      act(() => {
        result.current.handleKeyDown(createKeyEvent("5"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("0"));
      });

      // Should have count 50 now, not moved
      expect(result.current.pendingCount).toBe(50);
      expect(textarea.selectionStart).toBe(10);

      // Now press h to use the count
      act(() => {
        result.current.handleKeyDown(createKeyEvent("h"));
      });

      expect(textarea.selectionStart).toBe(0); // Clamped from 10-50
      expect(result.current.pendingCount).toBeNull();
    });

    it("undo does not use count (just undoes once)", () => {
      textarea.value = "Hello";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      const { result } = renderHook(() => useViMode(getOptionsWithTextarea()));

      // Delete two characters separately to have two undo states
      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });
      expect(textarea.value).toBe("ello");

      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });
      expect(textarea.value).toBe("llo");

      // Try 2u - should only undo once (count ignored for u in our impl)
      act(() => {
        result.current.handleKeyDown(createKeyEvent("2"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("u"));
      });

      // Should only undo once
      expect(textarea.value).toBe("ello");
    });
  });

  /**
   * Ex Command Execution Tests
   *
   * Tests for ex commands (:w, :wq, :q, :q!) that control save and exit.
   *
   * @see REQ-15: :w saves file, remains in Pair Writing
   * @see REQ-16: :wq saves file and exits Pair Writing
   * @see REQ-17: :q exits if no unsaved changes; shows confirmation dialog if unsaved
   * @see REQ-18: :q! exits without saving (discards changes)
   */
  describe("ex command execution", () => {
    it(":w calls onSave callback", () => {
      let saveCalled = false;
      const options: UseViModeOptions = {
        enabled: true,
        onSave: () => {
          saveCalled = true;
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and type :w
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(saveCalled).toBe(true);
      expect(result.current.mode).toBe("normal");
    });

    it(":w does not call onExit", () => {
      let exitCalled = false;
      const options: UseViModeOptions = {
        enabled: true,
        onSave: () => {},
        onExit: () => {
          exitCalled = true;
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and type :w
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(exitCalled).toBe(false);
    });

    it(":wq calls onSave then onExit", () => {
      const callOrder: string[] = [];
      const options: UseViModeOptions = {
        enabled: true,
        onSave: () => {
          callOrder.push("save");
        },
        onExit: () => {
          callOrder.push("exit");
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and type :wq
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("q"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(callOrder).toEqual(["save", "exit"]);
      expect(result.current.mode).toBe("normal");
    });

    it(":x is alias for :wq (calls onSave then onExit)", () => {
      const callOrder: string[] = [];
      const options: UseViModeOptions = {
        enabled: true,
        onSave: () => {
          callOrder.push("save");
        },
        onExit: () => {
          callOrder.push("exit");
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and type :x
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("x"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(callOrder).toEqual(["save", "exit"]);
    });

    it(":q calls onQuitWithUnsaved (parent handles unsaved check)", () => {
      let quitWithUnsavedCalled = false;
      let exitCalled = false;
      const options: UseViModeOptions = {
        enabled: true,
        onQuitWithUnsaved: () => {
          quitWithUnsavedCalled = true;
        },
        onExit: () => {
          exitCalled = true;
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and type :q
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("q"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(quitWithUnsavedCalled).toBe(true);
      expect(exitCalled).toBe(false); // :q does NOT call onExit directly
      expect(result.current.mode).toBe("normal");
    });

    it(":q! calls onExit directly (force quit)", () => {
      let exitCalled = false;
      let quitWithUnsavedCalled = false;
      const options: UseViModeOptions = {
        enabled: true,
        onExit: () => {
          exitCalled = true;
        },
        onQuitWithUnsaved: () => {
          quitWithUnsavedCalled = true;
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and type :q!
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("q"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("!"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(exitCalled).toBe(true);
      expect(quitWithUnsavedCalled).toBe(false); // :q! skips the unsaved check
      expect(result.current.mode).toBe("normal");
    });

    it("unknown command is silently ignored", () => {
      let saveCalled = false;
      let exitCalled = false;
      let quitWithUnsavedCalled = false;
      const options: UseViModeOptions = {
        enabled: true,
        onSave: () => {
          saveCalled = true;
        },
        onExit: () => {
          exitCalled = true;
        },
        onQuitWithUnsaved: () => {
          quitWithUnsavedCalled = true;
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and type an unknown command
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("f"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("o"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("o"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(saveCalled).toBe(false);
      expect(exitCalled).toBe(false);
      expect(quitWithUnsavedCalled).toBe(false);
      expect(result.current.mode).toBe("normal");
    });

    it("empty command is silently ignored", () => {
      let saveCalled = false;
      const options: UseViModeOptions = {
        enabled: true,
        onSave: () => {
          saveCalled = true;
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and immediately press Enter (empty command)
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(saveCalled).toBe(false);
      expect(result.current.mode).toBe("normal");
    });

    it("command with leading/trailing whitespace is trimmed", () => {
      let saveCalled = false;
      const options: UseViModeOptions = {
        enabled: true,
        onSave: () => {
          saveCalled = true;
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and type " w " (with spaces)
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent(" "));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent(" "));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(saveCalled).toBe(true);
    });

    it("Escape cancels command mode without executing", () => {
      let saveCalled = false;
      const options: UseViModeOptions = {
        enabled: true,
        onSave: () => {
          saveCalled = true;
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and type :w
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      // Press Escape instead of Enter
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Escape"));
      });

      expect(saveCalled).toBe(false);
      expect(result.current.mode).toBe("normal");
      expect(result.current.commandBuffer).toBe("");
    });

    it("Ctrl+C cancels command mode without executing", () => {
      let saveCalled = false;
      const options: UseViModeOptions = {
        enabled: true,
        onSave: () => {
          saveCalled = true;
        },
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and type :w
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      // Press Ctrl+C instead of Enter
      act(() => {
        result.current.handleKeyDown(createKeyEvent("c", { ctrlKey: true }));
      });

      expect(saveCalled).toBe(false);
      expect(result.current.mode).toBe("normal");
      expect(result.current.commandBuffer).toBe("");
    });

    it("callbacks are optional (no crash when undefined)", () => {
      const options: UseViModeOptions = {
        enabled: true,
        // No callbacks defined
      };

      const { result } = renderHook(() => useViMode(options));

      // Enter command mode and execute various commands
      // Should not throw even without callbacks
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(result.current.mode).toBe("normal");

      // Try :wq
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("w"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("q"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(result.current.mode).toBe("normal");

      // Try :q
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("q"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(result.current.mode).toBe("normal");

      // Try :q!
      act(() => {
        result.current.handleKeyDown(createKeyEvent(":"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("q"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("!"));
      });
      act(() => {
        result.current.handleKeyDown(createKeyEvent("Enter"));
      });

      expect(result.current.mode).toBe("normal");
    });
  });
});

/**
 * useViMode Hook Tests
 *
 * Tests the vi mode state machine: mode transitions between normal, insert, and command.
 * Also tests movement commands (h, j, k, l, 0, $) in normal mode.
 *
 * @see .lore/plans/vi-mode-pair-writing.md
 * @see REQ-4: Support three modes: Normal (default), Insert, and Command
 * @see REQ-6: Esc returns to Normal mode from Insert or Command mode
 * @see REQ-7: Movement: h (left), j (down), k (up), l (right)
 * @see REQ-8: Line movement: 0 (start of line), $ (end of line)
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

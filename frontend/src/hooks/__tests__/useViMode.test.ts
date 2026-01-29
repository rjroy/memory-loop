/**
 * useViMode Hook Tests
 *
 * Tests the vi mode state machine: mode transitions between normal, insert, and command.
 *
 * @see .lore/plans/vi-mode-pair-writing.md
 * @see REQ-4: Support three modes: Normal (default), Insert, and Command
 * @see REQ-6: Esc returns to Normal mode from Insert or Command mode
 */

import { describe, it, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useViMode, type UseViModeOptions } from "../useViMode";

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

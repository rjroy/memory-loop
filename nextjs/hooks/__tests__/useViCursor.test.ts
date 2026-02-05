/**
 * useViCursor Hook Tests
 *
 * Tests the vi mode block cursor position calculation and visibility.
 *
 * @see .lore/plans/vi-mode-pair-writing.md (TD-10)
 */

import { describe, it, expect, afterEach } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useViCursor, calculateCursorPosition, type UseViCursorOptions } from "../useViCursor";
import { createRef } from "react";

// Mock textarea for testing
function createMockTextarea(options: {
  value?: string;
  scrollTop?: number;
  scrollLeft?: number;
}): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.value = options.value ?? "";
  textarea.scrollTop = options.scrollTop ?? 0;
  textarea.scrollLeft = options.scrollLeft ?? 0;

  // Set up basic styling that affects cursor position
  textarea.style.fontFamily = "monospace";
  textarea.style.fontSize = "14px";
  textarea.style.lineHeight = "20px";
  textarea.style.padding = "10px";
  textarea.style.width = "300px";
  textarea.style.whiteSpace = "pre-wrap";
  textarea.style.wordWrap = "break-word";
  textarea.style.boxSizing = "border-box";

  // Append to DOM so getBoundingClientRect works
  document.body.appendChild(textarea);

  return textarea;
}

describe("useViCursor", () => {
  let textarea: HTMLTextAreaElement | null = null;

  afterEach(() => {
    if (textarea && textarea.parentNode) {
      document.body.removeChild(textarea);
    }
    textarea = null;
  });

  describe("showOverlay visibility", () => {
    it("shows overlay in normal mode when enabled", () => {
      textarea = createMockTextarea({ value: "hello" });
      const ref = createRef<HTMLTextAreaElement>();
      (ref as { current: HTMLTextAreaElement }).current = textarea;

      const { result } = renderHook(() =>
        useViCursor({
          textareaRef: ref,
          cursorPosition: 0,
          mode: "normal",
          enabled: true,
        })
      );

      expect(result.current.showOverlay).toBe(true);
    });

    it("shows overlay in command mode when enabled", () => {
      textarea = createMockTextarea({ value: "hello" });
      const ref = createRef<HTMLTextAreaElement>();
      (ref as { current: HTMLTextAreaElement }).current = textarea;

      const { result } = renderHook(() =>
        useViCursor({
          textareaRef: ref,
          cursorPosition: 0,
          mode: "command",
          enabled: true,
        })
      );

      expect(result.current.showOverlay).toBe(true);
    });

    it("hides overlay in insert mode", () => {
      textarea = createMockTextarea({ value: "hello" });
      const ref = createRef<HTMLTextAreaElement>();
      (ref as { current: HTMLTextAreaElement }).current = textarea;

      const { result } = renderHook(() =>
        useViCursor({
          textareaRef: ref,
          cursorPosition: 0,
          mode: "insert",
          enabled: true,
        })
      );

      expect(result.current.showOverlay).toBe(false);
    });

    it("hides overlay when disabled", () => {
      textarea = createMockTextarea({ value: "hello" });
      const ref = createRef<HTMLTextAreaElement>();
      (ref as { current: HTMLTextAreaElement }).current = textarea;

      const { result } = renderHook(() =>
        useViCursor({
          textareaRef: ref,
          cursorPosition: 0,
          mode: "normal",
          enabled: false,
        })
      );

      expect(result.current.showOverlay).toBe(false);
    });

    it("toggles overlay when mode changes from normal to insert", () => {
      textarea = createMockTextarea({ value: "hello" });
      const ref = createRef<HTMLTextAreaElement>();
      (ref as { current: HTMLTextAreaElement }).current = textarea;

      const initialProps: UseViCursorOptions = {
        textareaRef: ref,
        cursorPosition: 0,
        mode: "normal",
        enabled: true,
      };

      const { result, rerender } = renderHook(
        (props: UseViCursorOptions) => useViCursor(props),
        { initialProps }
      );

      expect(result.current.showOverlay).toBe(true);

      // Switch to insert mode
      const insertProps: UseViCursorOptions = {
        textareaRef: ref,
        cursorPosition: 0,
        mode: "insert",
        enabled: true,
      };
      rerender(insertProps);

      expect(result.current.showOverlay).toBe(false);
    });
  });

  describe("cursorStyle position", () => {
    it("returns style object with top, left, height", () => {
      textarea = createMockTextarea({ value: "hello" });
      const ref = createRef<HTMLTextAreaElement>();
      (ref as { current: HTMLTextAreaElement }).current = textarea;

      const { result } = renderHook(() =>
        useViCursor({
          textareaRef: ref,
          cursorPosition: 0,
          mode: "normal",
          enabled: true,
        })
      );

      expect(result.current.cursorStyle).toHaveProperty("top");
      expect(result.current.cursorStyle).toHaveProperty("left");
      expect(result.current.cursorStyle).toHaveProperty("height");
      expect(typeof result.current.cursorStyle.top).toBe("number");
      expect(typeof result.current.cursorStyle.left).toBe("number");
      expect(typeof result.current.cursorStyle.height).toBe("number");
    });

    it("recalculates position when cursorPosition changes", () => {
      textarea = createMockTextarea({ value: "hello world" });
      const ref = createRef<HTMLTextAreaElement>();
      (ref as { current: HTMLTextAreaElement }).current = textarea;

      const { result, rerender } = renderHook(
        (props) => useViCursor(props),
        {
          initialProps: {
            textareaRef: ref,
            cursorPosition: 0,
            mode: "normal" as const,
            enabled: true,
          },
        }
      );

      // Verify initial state has position properties
      expect(result.current.cursorStyle).toHaveProperty("top");
      expect(result.current.cursorStyle).toHaveProperty("left");

      // Move cursor to position 5 - should not throw
      rerender({
        textareaRef: ref,
        cursorPosition: 5,
        mode: "normal" as const,
        enabled: true,
      });

      // Position properties should still exist after rerender
      // Note: In JSDOM, getBoundingClientRect returns zeros, so we can't
      // verify actual pixel positions. The real behavior is tested in
      // browser integration tests.
      expect(result.current.cursorStyle).toHaveProperty("top");
      expect(result.current.cursorStyle).toHaveProperty("left");
    });
  });

  describe("null ref handling", () => {
    it("returns default position when textareaRef is null", () => {
      const ref = createRef<HTMLTextAreaElement>();
      // ref.current is null by default

      const { result } = renderHook(() =>
        useViCursor({
          textareaRef: ref,
          cursorPosition: 0,
          mode: "normal",
          enabled: true,
        })
      );

      // Should have default values without throwing
      expect(result.current.cursorStyle).toHaveProperty("top");
      expect(result.current.cursorStyle).toHaveProperty("left");
    });
  });
});

describe("calculateCursorPosition", () => {
  let textarea: HTMLTextAreaElement | null = null;

  afterEach(() => {
    if (textarea && textarea.parentNode) {
      document.body.removeChild(textarea);
    }
    textarea = null;
  });

  it("returns position with top, left, height", () => {
    textarea = createMockTextarea({ value: "hello" });

    const position = calculateCursorPosition(textarea, 0);

    expect(position).toHaveProperty("top");
    expect(position).toHaveProperty("left");
    expect(position).toHaveProperty("height");
    expect(typeof position.top).toBe("number");
    expect(typeof position.left).toBe("number");
    expect(typeof position.height).toBe("number");
  });

  it("calculates position for different cursor positions without error", () => {
    textarea = createMockTextarea({ value: "hello world" });

    // These should all complete without throwing
    const pos0 = calculateCursorPosition(textarea, 0);
    const pos5 = calculateCursorPosition(textarea, 5);
    const pos10 = calculateCursorPosition(textarea, 10);

    // All should return valid position objects
    // Note: In JSDOM, getBoundingClientRect returns zeros, so we verify
    // structure rather than actual pixel values
    expect(pos0).toHaveProperty("top");
    expect(pos0).toHaveProperty("left");
    expect(pos5).toHaveProperty("top");
    expect(pos5).toHaveProperty("left");
    expect(pos10).toHaveProperty("top");
    expect(pos10).toHaveProperty("left");
  });

  it("calculates position for different lines without error", () => {
    textarea = createMockTextarea({ value: "line one\nline two\nline three" });

    // These should all complete without throwing
    const line1 = calculateCursorPosition(textarea, 0);
    const line2 = calculateCursorPosition(textarea, 9); // Start of "line two"
    const line3 = calculateCursorPosition(textarea, 18); // Start of "line three"

    // All should return valid position objects
    expect(line1).toHaveProperty("top");
    expect(line1).toHaveProperty("height");
    expect(line2).toHaveProperty("top");
    expect(line2).toHaveProperty("height");
    expect(line3).toHaveProperty("top");
    expect(line3).toHaveProperty("height");
  });

  it("handles empty textarea", () => {
    textarea = createMockTextarea({ value: "" });

    // Should not throw
    const position = calculateCursorPosition(textarea, 0);
    expect(position).toHaveProperty("top");
    expect(position).toHaveProperty("left");
    expect(position).toHaveProperty("height");
  });

  it("handles cursor at end of text", () => {
    textarea = createMockTextarea({ value: "hello" });

    // Should not throw when cursor is at end
    const position = calculateCursorPosition(textarea, 5);
    expect(position).toHaveProperty("top");
  });

  it("cleans up mirror element after calculation", () => {
    textarea = createMockTextarea({ value: "hello" });

    const initialChildCount = document.body.children.length;
    calculateCursorPosition(textarea, 0);
    const finalChildCount = document.body.children.length;

    // Should clean up mirror element (only textarea should remain as added element)
    expect(finalChildCount).toBe(initialChildCount);
  });

  it("accounts for scroll offset in position", () => {
    textarea = createMockTextarea({
      value: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np",
      scrollTop: 0,
    });

    // Make textarea small so it can scroll
    textarea.style.height = "50px";
    textarea.style.overflow = "auto";

    // Calculate position before scroll
    calculateCursorPosition(textarea, 30); // Somewhere in the middle

    // Simulate scroll
    textarea.scrollTop = 20;

    // Calculate position after scroll - key is that it doesn't throw
    const posAfterScroll = calculateCursorPosition(textarea, 30);

    // The top position should account for scroll
    // In JSDOM, getBoundingClientRect returns zeros, so we just verify
    // the function handles scroll without error
    expect(posAfterScroll).toHaveProperty("top");
  });
});

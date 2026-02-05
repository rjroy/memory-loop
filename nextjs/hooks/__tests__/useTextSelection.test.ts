/**
 * useTextSelection Hook Tests
 *
 * Tests line counting, paragraph extraction, and hook behavior.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import {
  useTextSelection,
  getLineNumber,
  countTotalLines,
  extractParagraphBefore,
  extractParagraphAfter,
  extractSelectionContext,
} from "../useTextSelection";
import { createRef } from "react";

describe("getLineNumber", () => {
  it("returns 1 for position 0", () => {
    expect(getLineNumber("hello\nworld", 0)).toBe(1);
  });

  it("returns 1 for positions on the first line", () => {
    expect(getLineNumber("hello\nworld", 3)).toBe(1);
    expect(getLineNumber("hello\nworld", 5)).toBe(1);
  });

  it("returns 2 for positions after first newline", () => {
    expect(getLineNumber("hello\nworld", 6)).toBe(2);
    expect(getLineNumber("hello\nworld", 10)).toBe(2);
  });

  it("handles multiple lines correctly", () => {
    const text = "line1\nline2\nline3\nline4";
    expect(getLineNumber(text, 0)).toBe(1); // start of line1
    expect(getLineNumber(text, 6)).toBe(2); // start of line2
    expect(getLineNumber(text, 12)).toBe(3); // start of line3
    expect(getLineNumber(text, 18)).toBe(4); // start of line4
  });

  it("handles empty string", () => {
    expect(getLineNumber("", 0)).toBe(1);
  });

  it("clamps position to text length", () => {
    expect(getLineNumber("hello", 100)).toBe(1);
    expect(getLineNumber("hello\nworld", 100)).toBe(2);
  });

  it("handles consecutive newlines", () => {
    const text = "a\n\nb";
    expect(getLineNumber(text, 0)).toBe(1); // a
    expect(getLineNumber(text, 2)).toBe(2); // empty line
    expect(getLineNumber(text, 3)).toBe(3); // b
  });
});

describe("countTotalLines", () => {
  it("returns 1 for empty string", () => {
    expect(countTotalLines("")).toBe(1);
  });

  it("returns 1 for single line without newline", () => {
    expect(countTotalLines("hello")).toBe(1);
  });

  it("returns 2 for text with one newline", () => {
    expect(countTotalLines("hello\nworld")).toBe(2);
  });

  it("counts multiple lines correctly", () => {
    expect(countTotalLines("a\nb\nc\nd")).toBe(4);
  });

  it("counts trailing newline as extra line", () => {
    expect(countTotalLines("hello\n")).toBe(2);
  });

  it("counts blank lines", () => {
    expect(countTotalLines("a\n\nb")).toBe(3);
    expect(countTotalLines("a\n\n\nb")).toBe(4);
  });
});

describe("extractParagraphBefore", () => {
  it("returns empty string when selection is at start", () => {
    expect(extractParagraphBefore("hello world", 0)).toBe("");
  });

  it("returns empty string when no paragraph delimiter exists before", () => {
    expect(extractParagraphBefore("hello world", 5)).toBe("");
  });

  it("extracts paragraph before when delimiter exists", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    // Selection at start of "Second"
    expect(extractParagraphBefore(text, 18)).toBe("First paragraph.");
  });

  it("extracts correct paragraph with multiple paragraphs", () => {
    const text = "Para one.\n\nPara two.\n\nPara three.";
    // Selection at "Para three"
    expect(extractParagraphBefore(text, 22)).toBe("Para two.");
  });

  it("handles paragraph at document start", () => {
    const text = "Very first.\n\nSecond.\n\nThird.";
    // Selection at "Second"
    expect(extractParagraphBefore(text, 13)).toBe("Very first.");
  });

  it("handles extra whitespace in paragraphs", () => {
    const text = "  Para one.  \n\n  Para two.  \n\nPara three.";
    // Selection at "Para three"
    expect(extractParagraphBefore(text, 31)).toBe("Para two.");
  });

  it("returns empty for single paragraph document", () => {
    const text = "Just one paragraph here.";
    expect(extractParagraphBefore(text, 10)).toBe("");
  });
});

describe("extractParagraphAfter", () => {
  it("returns empty string when selection is at end", () => {
    const text = "hello world";
    expect(extractParagraphAfter(text, text.length)).toBe("");
  });

  it("returns empty string when no paragraph delimiter exists after", () => {
    expect(extractParagraphAfter("hello world", 5)).toBe("");
  });

  it("extracts paragraph after when delimiter exists", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    // Selection ends at "First paragraph."
    expect(extractParagraphAfter(text, 16)).toBe("Second paragraph.");
  });

  it("extracts correct paragraph with multiple paragraphs", () => {
    const text = "Para one.\n\nPara two.\n\nPara three.";
    // Selection ends at "Para one."
    expect(extractParagraphAfter(text, 9)).toBe("Para two.");
  });

  it("handles paragraph at document end", () => {
    const text = "First.\n\nSecond.\n\nVery last.";
    // Selection ends at "Second."
    expect(extractParagraphAfter(text, 15)).toBe("Very last.");
  });

  it("handles extra whitespace in paragraphs", () => {
    const text = "Para one.\n\n  Para two.  \n\n  Para three.  ";
    // Selection ends at "Para one."
    expect(extractParagraphAfter(text, 9)).toBe("Para two.");
  });

  it("returns empty for single paragraph document", () => {
    const text = "Just one paragraph here.";
    expect(extractParagraphAfter(text, 10)).toBe("");
  });
});

describe("extractSelectionContext", () => {
  const sampleDoc = `# Introduction

This is the first paragraph with some content.

This is the second paragraph.

And this is the third paragraph at the end.`;

  it("returns null for empty selection (start equals end)", () => {
    expect(extractSelectionContext(sampleDoc, 5, 5)).toBeNull();
  });

  it("returns null for whitespace-only selection", () => {
    expect(extractSelectionContext("hello   world", 5, 8)).toBeNull();
  });

  it("returns null for invalid start position", () => {
    expect(extractSelectionContext(sampleDoc, -1, 10)).toBeNull();
  });

  it("returns null for invalid end position", () => {
    expect(extractSelectionContext(sampleDoc, 0, -1)).toBeNull();
  });

  it("returns null when start > end", () => {
    expect(extractSelectionContext(sampleDoc, 10, 5)).toBeNull();
  });

  it("returns null when positions exceed content length", () => {
    expect(extractSelectionContext("short", 0, 100)).toBeNull();
    expect(extractSelectionContext("short", 100, 105)).toBeNull();
  });

  it("extracts selection text correctly", () => {
    const result = extractSelectionContext("hello world", 0, 5);
    expect(result?.text).toBe("hello");
  });

  it("calculates line numbers correctly for single line selection", () => {
    const text = "line1\nline2\nline3";
    // Select "line2"
    const result = extractSelectionContext(text, 6, 11);
    expect(result?.startLine).toBe(2);
    expect(result?.endLine).toBe(2);
  });

  it("calculates line numbers correctly for multi-line selection", () => {
    const text = "line1\nline2\nline3\nline4";
    // Select "line2\nline3"
    const result = extractSelectionContext(text, 6, 17);
    expect(result?.startLine).toBe(2);
    expect(result?.endLine).toBe(3);
  });

  it("calculates total lines correctly", () => {
    const text = "line1\nline2\nline3\nline4";
    const result = extractSelectionContext(text, 0, 5);
    expect(result?.totalLines).toBe(4);
  });

  it("extracts paragraph context correctly", () => {
    const text = "Para 1.\n\nPara 2 selected text here.\n\nPara 3.";
    // Select "selected" in para 2
    const result = extractSelectionContext(text, 16, 24);
    expect(result?.contextBefore).toBe("Para 1.");
    expect(result?.contextAfter).toBe("Para 3.");
  });

  it("handles selection in first paragraph", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    const result = extractSelectionContext(text, 0, 5);
    expect(result?.contextBefore).toBe("");
    expect(result?.contextAfter).toBe("Second paragraph.");
  });

  it("handles selection in last paragraph", () => {
    const text = "First paragraph.\n\nLast paragraph.";
    const result = extractSelectionContext(text, 18, 22);
    expect(result?.contextBefore).toBe("First paragraph.");
    expect(result?.contextAfter).toBe("");
  });

  it("handles document with no paragraph breaks", () => {
    const text = "Single paragraph document with no breaks.";
    const result = extractSelectionContext(text, 7, 16);
    expect(result?.contextBefore).toBe("");
    expect(result?.contextAfter).toBe("");
    expect(result?.text).toBe("paragraph");
  });
});

describe("useTextSelection hook", () => {
  // Mock textarea for testing
  let mockTextarea: HTMLTextAreaElement;

  beforeEach(() => {
    mockTextarea = document.createElement("textarea");
    mockTextarea.value = "Hello\n\nWorld\n\nEnd.";
    document.body.appendChild(mockTextarea);
  });

  afterEach(() => {
    document.body.removeChild(mockTextarea);
  });

  it("returns null selection initially", () => {
    const ref = createRef<HTMLTextAreaElement>();
    (ref as { current: HTMLTextAreaElement }).current = mockTextarea;

    const { result } = renderHook(() =>
      useTextSelection(ref, mockTextarea.value)
    );

    expect(result.current.selection).toBeNull();
  });

  it("provides clearSelection function", () => {
    const ref = createRef<HTMLTextAreaElement>();
    (ref as { current: HTMLTextAreaElement }).current = mockTextarea;

    const { result } = renderHook(() =>
      useTextSelection(ref, mockTextarea.value)
    );

    expect(typeof result.current.clearSelection).toBe("function");
  });

  it("updates selection on select event", () => {
    const ref = createRef<HTMLTextAreaElement>();
    (ref as { current: HTMLTextAreaElement }).current = mockTextarea;

    const { result } = renderHook(() =>
      useTextSelection(ref, mockTextarea.value)
    );

    // Simulate selection
    act(() => {
      mockTextarea.selectionStart = 0;
      mockTextarea.selectionEnd = 5;
      mockTextarea.dispatchEvent(new Event("select"));
    });

    expect(result.current.selection).not.toBeNull();
    expect(result.current.selection?.text).toBe("Hello");
  });

  it("updates selection on mouseup", () => {
    const ref = createRef<HTMLTextAreaElement>();
    (ref as { current: HTMLTextAreaElement }).current = mockTextarea;

    const { result } = renderHook(() =>
      useTextSelection(ref, mockTextarea.value)
    );

    // Simulate selection via mouseup
    act(() => {
      mockTextarea.selectionStart = 7;
      mockTextarea.selectionEnd = 12;
      mockTextarea.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(result.current.selection).not.toBeNull();
    expect(result.current.selection?.text).toBe("World");
  });

  it("clears selection when content changes", () => {
    const ref = createRef<HTMLTextAreaElement>();
    (ref as { current: HTMLTextAreaElement }).current = mockTextarea;

    const { result, rerender } = renderHook(
      ({ content }) => useTextSelection(ref, content),
      { initialProps: { content: mockTextarea.value } }
    );

    // Set up a selection
    act(() => {
      mockTextarea.selectionStart = 0;
      mockTextarea.selectionEnd = 5;
      mockTextarea.dispatchEvent(new Event("select"));
    });

    expect(result.current.selection).not.toBeNull();

    // Change content
    rerender({ content: "Different content entirely" });

    expect(result.current.selection).toBeNull();
  });

  it("clearSelection sets selection to null", () => {
    const ref = createRef<HTMLTextAreaElement>();
    (ref as { current: HTMLTextAreaElement }).current = mockTextarea;

    const { result } = renderHook(() =>
      useTextSelection(ref, mockTextarea.value)
    );

    // Set up a selection
    act(() => {
      mockTextarea.selectionStart = 0;
      mockTextarea.selectionEnd = 5;
      mockTextarea.dispatchEvent(new Event("select"));
    });

    expect(result.current.selection).not.toBeNull();

    // Clear it
    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selection).toBeNull();
  });

  it("calculates correct context for middle selection", () => {
    const content = "First para.\n\nMiddle para has selected text.\n\nLast para.";
    mockTextarea.value = content;
    const ref = createRef<HTMLTextAreaElement>();
    (ref as { current: HTMLTextAreaElement }).current = mockTextarea;

    const { result } = renderHook(() => useTextSelection(ref, content));

    // Select "selected" in middle paragraph
    // "First para.\n\nMiddle para has selected text.\n\nLast para."
    // "selected" starts at index 29 and ends at 37
    act(() => {
      mockTextarea.selectionStart = 29;
      mockTextarea.selectionEnd = 37;
      mockTextarea.dispatchEvent(new Event("select"));
    });

    expect(result.current.selection?.text).toBe("selected");
    expect(result.current.selection?.contextBefore).toBe("First para.");
    expect(result.current.selection?.contextAfter).toBe("Last para.");
  });

  it("returns null for null ref", () => {
    const ref = createRef<HTMLTextAreaElement>();
    // ref.current is null

    const { result } = renderHook(() => useTextSelection(ref, "some content"));

    expect(result.current.selection).toBeNull();
  });

  it("returns correct line numbers", () => {
    const content = "Line 1\nLine 2\nLine 3\nLine 4";
    mockTextarea.value = content;
    const ref = createRef<HTMLTextAreaElement>();
    (ref as { current: HTMLTextAreaElement }).current = mockTextarea;

    const { result } = renderHook(() => useTextSelection(ref, content));

    // Select "Line 2\nLine 3"
    act(() => {
      mockTextarea.selectionStart = 7;
      mockTextarea.selectionEnd = 20;
      mockTextarea.dispatchEvent(new Event("select"));
    });

    expect(result.current.selection?.startLine).toBe(2);
    expect(result.current.selection?.endLine).toBe(3);
    expect(result.current.selection?.totalLines).toBe(4);
  });

  it("updates selection on touchend (iOS touch selection)", () => {
    jest.useFakeTimers();

    const ref = createRef<HTMLTextAreaElement>();
    (ref as { current: HTMLTextAreaElement }).current = mockTextarea;

    const { result } = renderHook(() =>
      useTextSelection(ref, mockTextarea.value)
    );

    // Simulate touch selection ending
    act(() => {
      mockTextarea.selectionStart = 0;
      mockTextarea.selectionEnd = 5;
      mockTextarea.dispatchEvent(new TouchEvent("touchend"));
    });

    // touchend handler uses setTimeout(10ms), advance past it
    act(() => {
      jest.advanceTimersByTime(20);
    });

    expect(result.current.selection).not.toBeNull();
    expect(result.current.selection?.text).toBe("Hello");

    jest.useRealTimers();
  });

  it("updates selection on document selectionchange when textarea is focused", () => {
    const ref = createRef<HTMLTextAreaElement>();
    (ref as { current: HTMLTextAreaElement }).current = mockTextarea;

    const { result } = renderHook(() =>
      useTextSelection(ref, mockTextarea.value)
    );

    // Focus the textarea and set selection
    act(() => {
      mockTextarea.focus();
      mockTextarea.selectionStart = 7;
      mockTextarea.selectionEnd = 12;
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(result.current.selection).not.toBeNull();
    expect(result.current.selection?.text).toBe("World");
  });

});

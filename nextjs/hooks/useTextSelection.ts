/**
 * useTextSelection Hook
 *
 * Tracks the current text selection within an element and provides
 * context information for AI-assisted text revision.
 *
 * Features:
 * - Listens for selection changes via Selection API
 * - Calculates line numbers (1-indexed)
 * - Extracts paragraph context (delimited by \n\n)
 * - Returns null when no text is selected
 *
 * Spec Requirements:
 * - REQ-F-4: Selection + surrounding context sent to Claude
 * - TD-4: Paragraph context extraction (one paragraph before/after)
 */

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Context information about the current text selection.
 * Used for Quick Actions and Advisory Actions in Pair Writing Mode.
 */
export interface SelectionContext {
  /** The selected text */
  text: string;
  /** 1-indexed line number where selection starts */
  startLine: number;
  /** 1-indexed line number where selection ends */
  endLine: number;
  /** Total lines in the document */
  totalLines: number;
  /** Paragraph before the selection (delimited by \n\n) */
  contextBefore: string;
  /** Paragraph after the selection (delimited by \n\n) */
  contextAfter: string;
}

/**
 * Return type for the useTextSelection hook.
 */
export interface UseTextSelectionResult {
  /** Current selection context, or null if no selection */
  selection: SelectionContext | null;
  /** Manually clear the selection state */
  clearSelection: () => void;
}

/**
 * Counts the number of newlines before a given position in text.
 * Returns the 1-indexed line number.
 */
export function getLineNumber(text: string, position: number): number {
  const clampedPosition = Math.min(position, text.length);
  const textBefore = text.substring(0, clampedPosition);
  const newlines = (textBefore.match(/\n/g) ?? []).length;
  return newlines + 1;
}

/**
 * Counts total lines in text (number of newlines + 1).
 */
export function countTotalLines(text: string): number {
  if (text === "") return 1;
  const newlines = (text.match(/\n/g) ?? []).length;
  return newlines + 1;
}

/**
 * Extracts the paragraph before a given position.
 * Paragraphs are delimited by blank lines (\n\n).
 * Returns the full paragraph text (without trailing delimiter).
 */
export function extractParagraphBefore(
  text: string,
  selectionStart: number
): string {
  if (selectionStart === 0) return "";

  const textBefore = text.substring(0, selectionStart);

  // Find the last paragraph delimiter before selection
  const lastDelimiter = textBefore.lastIndexOf("\n\n");

  if (lastDelimiter === -1) {
    // No delimiter found, everything before selection is the context
    // But we want the paragraph, not partial text, so return empty
    // Actually per spec, we want the preceding paragraph content
    // If no delimiter, the "paragraph before" doesn't exist
    return "";
  }

  // Find the start of that paragraph (look for another \n\n before it)
  const paragraphStart = textBefore.lastIndexOf("\n\n", lastDelimiter - 1);

  if (paragraphStart === -1) {
    // The paragraph starts at the beginning of the document
    return textBefore.substring(0, lastDelimiter).trim();
  }

  // Extract the paragraph between the two delimiters
  return textBefore.substring(paragraphStart + 2, lastDelimiter).trim();
}

/**
 * Extracts the paragraph after a given position.
 * Paragraphs are delimited by blank lines (\n\n).
 * Returns the full paragraph text (without leading delimiter).
 */
export function extractParagraphAfter(
  text: string,
  selectionEnd: number
): string {
  if (selectionEnd >= text.length) return "";

  const textAfter = text.substring(selectionEnd);

  // Find the first paragraph delimiter after selection
  const firstDelimiter = textAfter.indexOf("\n\n");

  if (firstDelimiter === -1) {
    // No delimiter found, no complete paragraph after
    return "";
  }

  // Find the end of the next paragraph (another \n\n or end of text)
  const nextDelimiter = textAfter.indexOf("\n\n", firstDelimiter + 2);

  if (nextDelimiter === -1) {
    // Paragraph extends to end of document
    return textAfter.substring(firstDelimiter + 2).trim();
  }

  // Extract the paragraph between the two delimiters
  return textAfter.substring(firstDelimiter + 2, nextDelimiter).trim();
}

/**
 * Extracts full selection context from document content.
 * This is the core logic used by the hook, exposed for testing.
 */
export function extractSelectionContext(
  content: string,
  selectionStart: number,
  selectionEnd: number
): SelectionContext | null {
  // Validate inputs
  if (selectionStart < 0 || selectionEnd < 0) return null;
  if (selectionStart > content.length || selectionEnd > content.length)
    return null;
  if (selectionStart >= selectionEnd) return null;

  const selectedText = content.substring(selectionStart, selectionEnd);

  // Empty or whitespace-only selection is treated as no selection
  if (selectedText.trim() === "") return null;

  return {
    text: selectedText,
    startLine: getLineNumber(content, selectionStart),
    endLine: getLineNumber(content, selectionEnd),
    totalLines: countTotalLines(content),
    contextBefore: extractParagraphBefore(content, selectionStart),
    contextAfter: extractParagraphAfter(content, selectionEnd),
  };
}

/**
 * Gets selection information from a textarea or contenteditable element.
 * Returns start/end offsets or null if element doesn't support selection.
 */
function getElementSelection(
  element: HTMLElement
): { start: number; end: number } | null {
  if (element instanceof HTMLTextAreaElement) {
    return {
      start: element.selectionStart,
      end: element.selectionEnd,
    };
  }

  // For contenteditable elements, use Selection API
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);

  // Check if selection is within our element
  if (!element.contains(range.commonAncestorContainer)) return null;

  // Calculate offsets relative to the element's text content
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.startContainer, range.startOffset);
  const start = preCaretRange.toString().length;

  preCaretRange.setEnd(range.endContainer, range.endOffset);
  const end = preCaretRange.toString().length;

  return { start, end };
}

/**
 * React hook for tracking text selection within an element.
 *
 * @param elementRef - Ref to the element to track selection in (textarea or contenteditable)
 * @param content - The current text content of the element
 * @returns Selection context or null if no selection
 *
 * @example
 * ```tsx
 * const textareaRef = useRef<HTMLTextAreaElement>(null);
 * const [content, setContent] = useState("");
 * const { selection } = useTextSelection(textareaRef, content);
 *
 * if (selection) {
 *   console.log(`Selected "${selection.text}" on lines ${selection.startLine}-${selection.endLine}`);
 * }
 * ```
 */
export function useTextSelection(
  elementRef: React.RefObject<HTMLElement | null>,
  content: string
): UseTextSelectionResult {
  const [selection, setSelection] = useState<SelectionContext | null>(null);

  // Keep content ref for use in event handlers
  const contentRef = useRef(content);
  contentRef.current = content;

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  // Update selection on selection change events
  const updateSelection = useCallback(() => {
    const element = elementRef.current;
    if (!element) {
      setSelection(null);
      return;
    }

    const elementSelection = getElementSelection(element);
    if (!elementSelection) {
      setSelection(null);
      return;
    }

    const context = extractSelectionContext(
      contentRef.current,
      elementSelection.start,
      elementSelection.end
    );

    setSelection(context);
  }, [elementRef]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    // For textarea, listen to multiple events to catch selection changes
    if (element instanceof HTMLTextAreaElement) {
      const handleSelect = () => updateSelection();
      const handleMouseUp = () => updateSelection();
      const handleTouchEnd = () => {
        // iOS Safari needs a small delay for selection to finalize after touch
        setTimeout(updateSelection, 10);
      };
      const handleKeyUp = (e: KeyboardEvent) => {
        // Update on shift+arrow keys (selection change)
        if (e.shiftKey || e.key === "Escape") {
          updateSelection();
        }
      };
      // iOS Safari fires selectionchange on document for textareas too
      const handleSelectionChange = () => {
        // Only update if our textarea is focused (selection is in it)
        if (document.activeElement === element) {
          updateSelection();
        }
      };

      element.addEventListener("select", handleSelect);
      element.addEventListener("mouseup", handleMouseUp);
      element.addEventListener("touchend", handleTouchEnd);
      element.addEventListener("keyup", handleKeyUp);
      document.addEventListener("selectionchange", handleSelectionChange);

      return () => {
        element.removeEventListener("select", handleSelect);
        element.removeEventListener("mouseup", handleMouseUp);
        element.removeEventListener("touchend", handleTouchEnd);
        element.removeEventListener("keyup", handleKeyUp);
        document.removeEventListener("selectionchange", handleSelectionChange);
      };
    }

    // For contenteditable, listen to document selectionchange
    const handleSelectionChange = () => {
      updateSelection();
    };

    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [elementRef, updateSelection]);

  // Clear selection when content changes
  // We don't have the original character positions, so we can't revalidate.
  // User will re-select if needed.
  useEffect(() => {
    if (selection) {
      setSelection(null);
    }
    // Intentionally only depend on content, not selection.
    // We want to clear when content changes, not re-run when selection changes.
  }, [content]);

  return {
    selection,
    clearSelection,
  };
}

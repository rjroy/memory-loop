/**
 * useViCursor Hook - Vi Mode Block Cursor Position
 *
 * Calculates pixel position for the block cursor overlay in vi normal mode
 * using the mirror element technique. A hidden div copies the textarea's
 * styling and content to measure where the cursor should appear.
 *
 * @see .lore/plans/vi-mode-pair-writing.md (TD-10)
 * @see .lore/research/vi-mode-implementation.md (Cursor Rendering Research)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { ViMode } from "./useViMode";

export interface UseViCursorOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  cursorPosition: number; // selectionStart
  mode: ViMode;
  enabled: boolean;
}

export interface CursorPosition {
  top: number;
  left: number;
  height: number;
}

export interface UseViCursorResult {
  cursorStyle: React.CSSProperties; // position for overlay
  showOverlay: boolean; // true in normal/command mode
}

/**
 * CSS properties that must be copied from textarea to mirror element
 * for accurate position calculation.
 */
const MIRROR_STYLE_PROPERTIES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "wordWrap",
  "wordSpacing",
  "whiteSpace",
  "overflowWrap",
  "tabSize",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "boxSizing",
  "width",
] as const;

/**
 * Creates a mirror element for measuring cursor position.
 * The mirror copies the textarea's styling so text wrapping matches.
 */
function createMirrorElement(): HTMLDivElement {
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";
  // Position off-screen
  mirror.style.left = "-9999px";
  mirror.style.top = "-9999px";
  return mirror;
}

/**
 * Converts camelCase to kebab-case for CSS property names.
 */
function toKebabCase(str: string): string {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}

/**
 * Copies relevant CSS properties from textarea to mirror element.
 */
function copyTextareaStyles(
  textarea: HTMLTextAreaElement,
  mirror: HTMLDivElement
): void {
  const computed = window.getComputedStyle(textarea);

  for (const prop of MIRROR_STYLE_PROPERTIES) {
    const kebabProp = toKebabCase(prop);
    const value = computed.getPropertyValue(kebabProp);
    mirror.style.setProperty(kebabProp, value);
  }
}

/**
 * Calculates cursor pixel position using the mirror element technique.
 *
 * Algorithm:
 * 1. Create off-screen div with identical styling to textarea
 * 2. Split content at cursor position
 * 3. Insert span marker between text nodes
 * 4. Measure span's position relative to the mirror
 * 5. Account for textarea scroll offset
 */
export function calculateCursorPosition(
  textarea: HTMLTextAreaElement,
  cursorPos: number
): CursorPosition {
  // Create and configure mirror
  const mirror = createMirrorElement();
  copyTextareaStyles(textarea, mirror);
  document.body.appendChild(mirror);

  try {
    // Split text at cursor position
    const value = textarea.value;
    const textBefore = value.substring(0, cursorPos);
    const charAtCursor = value.charAt(cursorPos);

    // Build mirror content using safe DOM methods
    // Use a span to mark cursor position
    const cursorSpan = document.createElement("span");
    // Use the actual character at cursor, or non-breaking space if empty/newline
    cursorSpan.textContent =
      charAtCursor && charAtCursor !== "\n" ? charAtCursor : "\u00A0";
    cursorSpan.style.display = "inline";

    mirror.textContent = "";

    // Handle the text before cursor, preserving whitespace
    if (textBefore) {
      // Use createTextNode to preserve whitespace properly
      const beforeNode = document.createTextNode(textBefore);
      mirror.appendChild(beforeNode);
    }
    mirror.appendChild(cursorSpan);

    // Get positions - measure span relative to mirror, not viewport
    const mirrorRect = mirror.getBoundingClientRect();
    const spanRect = cursorSpan.getBoundingClientRect();

    // Calculate position relative to mirror (which has same styling as textarea)
    // Then account for scroll offset
    const top = spanRect.top - mirrorRect.top - textarea.scrollTop;
    const left = spanRect.left - mirrorRect.left - textarea.scrollLeft;

    // Get line height from computed style for cursor height
    const computed = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(computed.lineHeight) || 20;

    return {
      top,
      left,
      height: lineHeight,
    };
  } finally {
    // Clean up mirror element
    document.body.removeChild(mirror);
  }
}

/**
 * Hook for managing vi mode block cursor overlay position.
 *
 * Shows the overlay cursor in normal and command modes (when the native
 * caret is hidden). Hides it in insert mode to let the native caret show.
 *
 * @example
 * ```tsx
 * const { cursorStyle, showOverlay } = useViCursor({
 *   textareaRef,
 *   cursorPosition: selectionStart,
 *   mode: viMode,
 *   enabled: viModeEnabled,
 * });
 *
 * return (
 *   <>
 *     <textarea ref={textareaRef} />
 *     {showOverlay && <div className="vi-cursor" style={cursorStyle} />}
 *   </>
 * );
 * ```
 */
export function useViCursor(options: UseViCursorOptions): UseViCursorResult {
  const { textareaRef, cursorPosition, mode, enabled } = options;

  const [position, setPosition] = useState<CursorPosition>({
    top: 0,
    left: 0,
    height: 20,
  });

  // Track scroll position to update cursor on scroll
  const scrollTopRef = useRef(0);
  const scrollLeftRef = useRef(0);

  // Calculate cursor position
  const updatePosition = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !enabled) return;

    const newPosition = calculateCursorPosition(textarea, cursorPosition);
    setPosition(newPosition);

    // Store current scroll for reference
    scrollTopRef.current = textarea.scrollTop;
    scrollLeftRef.current = textarea.scrollLeft;
  }, [textareaRef, cursorPosition, enabled]);

  // Update position when cursor moves
  useEffect(() => {
    updatePosition();
  }, [updatePosition]);

  // Update position on scroll
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !enabled) return;

    const handleScroll = () => {
      // Recalculate position based on new scroll offset
      const newPosition = calculateCursorPosition(textarea, cursorPosition);
      setPosition(newPosition);
    };

    textarea.addEventListener("scroll", handleScroll);
    return () => {
      textarea.removeEventListener("scroll", handleScroll);
    };
  }, [textareaRef, cursorPosition, enabled]);

  // Also update on window resize (textarea might reflow)
  useEffect(() => {
    if (!enabled) return;

    const handleResize = () => {
      updatePosition();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [enabled, updatePosition]);

  // Show overlay in normal and command modes, not in insert mode
  const showOverlay = enabled && (mode === "normal" || mode === "command");

  // Convert position to CSS style
  const cursorStyle: React.CSSProperties = {
    top: position.top,
    left: position.left,
    height: position.height,
  };

  return {
    cursorStyle,
    showOverlay,
  };
}

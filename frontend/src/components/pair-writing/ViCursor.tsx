/**
 * ViCursor Component - Block Cursor Overlay for Vi Mode
 *
 * Renders a block cursor overlay for vi normal mode. The cursor is positioned
 * absolutely within the editor container, showing the current cursor position
 * with a semi-transparent background and blink animation.
 *
 * @see .lore/plans/vi-mode-pair-writing.md (TD-10)
 */

import type { CSSProperties } from "react";
import "./vi-mode.css";

export interface ViCursorProps {
  /** CSS style containing top, left, height from useViCursor */
  style: CSSProperties;
  /** Whether to show the cursor (visible in normal/command mode) */
  visible: boolean;
}

/**
 * Block cursor overlay for vi normal mode.
 *
 * This component renders on top of the textarea to show a vim-style block
 * cursor when in normal mode. The native textarea caret is hidden via CSS
 * (caret-color: transparent) when this cursor is shown.
 *
 * Features:
 * - Block cursor appearance (~0.6em wide)
 * - Semi-transparent background
 * - Blink animation
 * - pointer-events: none so it doesn't interfere with textarea interaction
 *
 * @example
 * ```tsx
 * const { cursorStyle, showOverlay } = useViCursor({
 *   textareaRef,
 *   cursorPosition,
 *   mode: viMode,
 *   enabled: viModeEnabled,
 * });
 *
 * return (
 *   <div className="pair-writing-editor">
 *     <textarea ref={textareaRef} />
 *     <ViCursor style={cursorStyle} visible={showOverlay} />
 *   </div>
 * );
 * ```
 */
export function ViCursor({ style, visible }: ViCursorProps): React.ReactNode {
  if (!visible) {
    return null;
  }

  return (
    <div
      className="vi-cursor"
      style={style}
      data-testid="vi-cursor"
      aria-hidden="true"
    />
  );
}

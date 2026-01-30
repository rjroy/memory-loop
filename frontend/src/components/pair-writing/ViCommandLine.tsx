/**
 * ViCommandLine Component - Ex Command Display for Vi Mode
 *
 * Renders a vim-style command line display at the bottom of the editor.
 * Appears when user presses ':' in Normal mode. Shows a ":" prefix
 * followed by the current command buffer text.
 *
 * This is a pure display component: all keyboard input is handled by
 * useViMode through the textarea's keydown events. The textarea retains
 * focus while in command mode; this component just displays what's being
 * typed.
 *
 * @see .lore/specs/vi-mode-pair-writing.md (REQ-14, REQ-19)
 * @see .lore/plans/vi-mode-pair-writing.md (TD-5)
 */

import "./vi-mode.css";

export interface ViCommandLineProps {
  /** Whether the command line should be visible */
  visible: boolean;
  /** Current command buffer value (without the leading colon) */
  value: string;
}

/**
 * Vim-style command line display.
 *
 * This component renders at the bottom of the editor container, showing
 * a ":" prefix followed by the command buffer text. The textarea retains
 * focus; this is a pure display component.
 *
 * Key events are handled by useViMode through the textarea's onKeyDown,
 * which updates the command buffer.
 *
 * @example
 * ```tsx
 * const { mode, commandBuffer } = useViMode({...});
 *
 * return (
 *   <div className="pair-writing-editor">
 *     <textarea onKeyDown={handleKeyDown} />
 *     <ViCommandLine
 *       visible={mode === "command"}
 *       value={commandBuffer}
 *     />
 *   </div>
 * );
 * ```
 */
export function ViCommandLine({
  visible,
  value,
}: ViCommandLineProps): React.ReactNode {
  if (!visible) {
    return null;
  }

  return (
    <div
      className="vi-command-line"
      data-testid="vi-command-line"
      role="status"
      aria-label="Vi command line"
      aria-live="polite"
    >
      <span className="vi-command-line__prefix" aria-hidden="true">
        :
      </span>
      <span className="vi-command-line__text">{value}</span>
      <span className="vi-command-line__cursor" aria-hidden="true" />
    </div>
  );
}

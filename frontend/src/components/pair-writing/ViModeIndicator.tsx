/**
 * ViModeIndicator Component
 *
 * Displays the current vi mode in vim-style format at the bottom of the editor.
 * Shows "-- NORMAL --", "-- INSERT --", or "-- COMMAND --" based on mode.
 *
 * @see .lore/specs/vi-mode-pair-writing.md REQ-5
 */

import type { ViMode } from "../../hooks/useViMode";
import "./vi-mode.css";

export interface ViModeIndicatorProps {
  /** Current vi mode */
  mode: ViMode;
  /** Whether vi mode is enabled (hidden when false) */
  visible: boolean;
  /** Command buffer to display in command mode (e.g., ":w") */
  commandBuffer?: string;
}

/** Map mode to display text */
const MODE_LABELS: Record<ViMode, string> = {
  normal: "-- NORMAL --",
  insert: "-- INSERT --",
  command: "-- COMMAND --",
};

/**
 * Mode indicator component showing current vi mode.
 * Positioned at bottom-left of editor, styled like classic vim.
 */
export function ViModeIndicator({
  mode,
  visible,
  commandBuffer,
}: ViModeIndicatorProps): React.ReactNode {
  if (!visible) {
    return null;
  }

  const label = MODE_LABELS[mode];
  const displayText =
    mode === "command" && commandBuffer
      ? `${label} ${commandBuffer}`
      : label;

  return (
    <div
      className="vi-mode-indicator"
      data-mode={mode}
      aria-live="polite"
      aria-label={`Vi mode: ${mode}`}
    >
      {displayText}
    </div>
  );
}

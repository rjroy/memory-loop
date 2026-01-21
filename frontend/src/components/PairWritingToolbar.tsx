/**
 * PairWritingToolbar Component
 *
 * Toolbar for Pair Writing Mode with Snapshot, Save, and Exit buttons.
 *
 * @see .sdd/plans/memory-loop/2026-01-20-pair-writing-mode-plan.md TD-5, TD-8, TD-11
 * @see .sdd/specs/memory-loop/2026-01-20-pair-writing-mode.md REQ-F-14, REQ-F-23, REQ-F-29, REQ-F-30
 */

import React, { useState } from "react";
import "./PairWritingMode.css";

export interface PairWritingToolbarProps {
  /** Whether there are unsaved manual edits (triggers exit warning per REQ-F-30) */
  hasUnsavedChanges: boolean;
  /** Whether a snapshot currently exists (REQ-F-24) */
  hasSnapshot: boolean;
  /** Whether save is in progress */
  isSaving?: boolean;
  /** Called when user clicks Snapshot button (REQ-F-23) */
  onSnapshot: () => void;
  /** Called when user clicks Save button (REQ-F-29) */
  onSave: () => void;
  /** Called when user clicks Exit button (REQ-F-14) */
  onExit: () => void;
  /** Current file path being edited (displayed in toolbar) */
  filePath?: string;
  /** The actual snapshot text content (for hover preview) */
  snapshotContent?: string;
}

/**
 * Toolbar for Pair Writing Mode.
 *
 * Features:
 * - Snapshot button to capture current document state (REQ-F-23)
 * - Save button to persist manual edits (REQ-F-29)
 * - Exit button with warning for unsaved changes (REQ-F-14, REQ-F-30)
 *
 * Note: Exit confirmation dialog is handled by the parent PairWritingMode component.
 */
/**
 * Truncates snapshot content for preview display.
 * Limits to ~500 characters or ~15 lines, whichever is shorter.
 */
function truncateForPreview(content: string): { text: string; isTruncated: boolean } {
  const MAX_CHARS = 500;
  const MAX_LINES = 15;

  const lines = content.split("\n");
  let result = "";
  let lineCount = 0;

  for (const line of lines) {
    if (lineCount >= MAX_LINES || result.length + line.length > MAX_CHARS) {
      return { text: result.trimEnd(), isTruncated: true };
    }
    result += (lineCount > 0 ? "\n" : "") + line;
    lineCount++;
  }

  return { text: result, isTruncated: false };
}

export function PairWritingToolbar({
  hasUnsavedChanges,
  hasSnapshot,
  isSaving = false,
  onSnapshot,
  onSave,
  onExit,
  filePath,
  snapshotContent,
}: PairWritingToolbarProps): React.ReactNode {
  const [isHoveringSnapshot, setIsHoveringSnapshot] = useState(false);
  return (
    <div className="pair-writing-toolbar" role="toolbar" aria-label="Pair Writing toolbar">
      {/* Left section: file info */}
      <div className="pair-writing-toolbar__left">
        {filePath && (
          <span className="pair-writing-toolbar__file-path" title={filePath}>
            {filePath}
          </span>
        )}
        {hasUnsavedChanges && (
          <span className="pair-writing-toolbar__unsaved-indicator" aria-label="Unsaved changes">
            *
          </span>
        )}
      </div>

      {/* Right section: action buttons */}
      <div className="pair-writing-toolbar__actions">
        {/* Snapshot button with hover preview (REQ-F-23) */}
        <div
          className="pair-writing-toolbar__snapshot-wrapper"
          onMouseEnter={() => setIsHoveringSnapshot(true)}
          onMouseLeave={() => setIsHoveringSnapshot(false)}
        >
          <button
            type="button"
            className={`pair-writing-toolbar__btn pair-writing-toolbar__btn--snapshot${hasSnapshot ? " pair-writing-toolbar__btn--has-snapshot" : ""}`}
            onClick={onSnapshot}
            aria-pressed={hasSnapshot}
            title={hasSnapshot ? "Update snapshot (replaces previous)" : "Take snapshot for comparison"}
          >
            <svg
              className="pair-writing-toolbar__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="pair-writing-toolbar__label">Snapshot</span>
          </button>
          {/* Snapshot preview popover */}
          {hasSnapshot && isHoveringSnapshot && snapshotContent && (() => {
            const { text, isTruncated } = truncateForPreview(snapshotContent);
            return (
              <div className="pair-writing-toolbar__snapshot-preview" role="tooltip">
                <pre className="pair-writing-toolbar__snapshot-preview-content">
                  {text}
                  {isTruncated && <span className="pair-writing-toolbar__snapshot-preview-ellipsis">...</span>}
                </pre>
              </div>
            );
          })()}
        </div>

        {/* Save button (REQ-F-29) */}
        <button
          type="button"
          className="pair-writing-toolbar__btn pair-writing-toolbar__btn--save"
          onClick={onSave}
          disabled={!hasUnsavedChanges || isSaving}
          title={hasUnsavedChanges ? "Save changes to vault" : "No unsaved changes"}
        >
          {isSaving ? (
            <div className="pair-writing-toolbar__spinner" aria-hidden="true" />
          ) : (
            <svg
              className="pair-writing-toolbar__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          )}
          <span className="pair-writing-toolbar__label">{isSaving ? "Saving..." : "Save"}</span>
        </button>

        {/* Exit button (REQ-F-14) */}
        <button
          type="button"
          className="pair-writing-toolbar__btn pair-writing-toolbar__btn--exit"
          onClick={onExit}
          title="Exit Pair Writing mode"
        >
          <svg
            className="pair-writing-toolbar__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
          <span className="pair-writing-toolbar__label">Exit</span>
        </button>
      </div>
    </div>
  );
}

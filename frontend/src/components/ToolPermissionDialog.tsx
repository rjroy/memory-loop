/**
 * ToolPermissionDialog Component
 *
 * Displays a dialog asking the user for permission before running a tool.
 * Shows the tool name and input parameters for user review.
 */

import React, { useId } from "react";
import "./ToolPermissionDialog.css";

export interface ToolPermissionRequest {
  toolUseId: string;
  toolName: string;
  input: unknown;
}

export interface ToolPermissionDialogProps {
  request: ToolPermissionRequest | null;
  onAllow: () => void;
  onDeny: () => void;
}

/**
 * Formats tool input for display.
 * Shows a truncated JSON representation.
 */
function formatToolInput(input: unknown): string {
  try {
    const json = JSON.stringify(input, null, 2);
    // Truncate if too long
    if (json.length > 500) {
      return json.slice(0, 500) + "\n...";
    }
    return json;
  } catch {
    return String(input);
  }
}

/**
 * Returns a human-readable description for common tool names.
 */
function getToolDescription(toolName: string): string {
  const descriptions: Record<string, string> = {
    Read: "Read a file from your vault",
    Write: "Write content to a file in your vault",
    Edit: "Edit a file in your vault",
    Bash: "Execute a shell command",
    Glob: "Search for files matching a pattern",
    Grep: "Search file contents for a pattern",
    WebFetch: "Fetch content from a URL",
    WebSearch: "Search the web",
    Task: "Run a background task",
  };
  return descriptions[toolName] ?? `Use the ${toolName} tool`;
}

export function ToolPermissionDialog({
  request,
  onAllow,
  onDeny,
}: ToolPermissionDialogProps): React.ReactNode {
  const titleId = useId();

  if (!request) return null;

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onDeny();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onDeny();
    }
  }

  return (
    <div
      className="tool-permission__backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="tool-permission"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="tool-permission__header">
          <span className="tool-permission__icon">🔧</span>
          <h2 id={titleId} className="tool-permission__title">
            Tool Permission Request
          </h2>
        </div>

        <div className="tool-permission__content">
          <p className="tool-permission__description">
            Claude wants to <strong>{getToolDescription(request.toolName)}</strong>
          </p>

          <div className="tool-permission__tool-name">
            <span className="tool-permission__label">Tool:</span>
            <code>{request.toolName}</code>
          </div>

          <div className="tool-permission__input">
            <span className="tool-permission__label">Parameters:</span>
            <pre className="tool-permission__code">
              {formatToolInput(request.input)}
            </pre>
          </div>
        </div>

        <div className="tool-permission__actions">
          <button
            type="button"
            className="tool-permission__btn tool-permission__btn--deny"
            onClick={onDeny}
          >
            Deny
          </button>
          <button
            type="button"
            className="tool-permission__btn tool-permission__btn--allow"
            onClick={onAllow}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

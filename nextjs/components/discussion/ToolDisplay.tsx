/**
 * Tool Display Component
 *
 * Expandable card for displaying tool invocations during AI responses.
 * Shows tool name, loading state, and expandable input/output.
 */

import React, { useState } from "react";
import "./ToolDisplay.css";

const MAX_EXPANDED_LENGTH = 5000;

/**
 * Props for ToolDisplay component.
 */
export interface ToolDisplayProps {
  /** Tool name */
  toolName: string;
  /** Unique tool use ID */
  toolUseId: string;
  /** Tool input parameters */
  input?: unknown;
  /** Tool output/result */
  output?: unknown;
  /** Whether the tool is currently running */
  isLoading?: boolean;
}

/**
 * Formats a value for display, truncating if necessary.
 */
function formatValue(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) {
    return "";
  }

  const formatted = typeof value === "string"
    ? value
    : JSON.stringify(value, null, 2);

  if (formatted.length > maxLength) {
    return formatted.slice(0, maxLength) + "...";
  }

  return formatted;
}

/**
 * Gets a brief summary of the tool invocation.
 */
function getToolSummary(toolName: string, input: unknown): string {
  // Try to extract meaningful summary based on common tool patterns
  if (input && typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;

    // Common patterns for file/path tools
    if ("file_path" in obj && typeof obj.file_path === "string") {
      const path = obj.file_path;
      return path.split("/").pop() || path;
    }

    if ("path" in obj && typeof obj.path === "string") {
      const path = obj.path;
      return path.split("/").pop() || path;
    }

    // Command tools
    if ("command" in obj && typeof obj.command === "string") {
      const cmd = obj.command;
      return cmd.slice(0, 30) + (cmd.length > 30 ? "..." : "");
    }

    // Pattern/query tools
    if ("pattern" in obj && typeof obj.pattern === "string") {
      return `"${obj.pattern}"`;
    }

    if ("query" in obj && typeof obj.query === "string") {
      const query = obj.query;
      return query.slice(0, 30) + (query.length > 30 ? "..." : "");
    }
  }

  return "";
}

/**
 * Expandable tool invocation card.
 *
 * - Collapsed: tool name + brief summary
 * - Loading spinner during tool_start until tool_end
 * - Tap/click expands card
 * - Expanded: formatted input parameters and output
 * - Visual distinction from text messages
 */
export function ToolDisplay({
  toolName,
  input,
  output,
  isLoading = false,
}: ToolDisplayProps): React.ReactNode {
  const [isExpanded, setIsExpanded] = useState(false);

  const summary = getToolSummary(toolName, input);
  const hasContent = input !== undefined || output !== undefined;

  function handleToggle() {
    if (hasContent || isLoading) {
      setIsExpanded(!isExpanded);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleToggle();
    }
  }

  return (
    <div
      className={`tool-display ${isExpanded ? "tool-display--expanded" : ""} ${
        isLoading ? "tool-display--loading" : ""
      }`}
      role="listitem"
    >
      <div
        className="tool-display__header"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`${toolName} tool${isLoading ? ", running" : ""}`}
      >
        <div className="tool-display__icon">
          {isLoading ? (
            <span className="tool-display__spinner" aria-hidden="true" />
          ) : (
            <span className="tool-display__tool-icon" aria-hidden="true">
              🔧
            </span>
          )}
        </div>
        <div className="tool-display__info">
          <span className="tool-display__name">{toolName}</span>
          {summary && (
            <span className="tool-display__summary">{summary}</span>
          )}
        </div>
        {hasContent && (
          <span
            className={`tool-display__chevron ${
              isExpanded ? "tool-display__chevron--expanded" : ""
            }`}
            aria-hidden="true"
          >
            ▸
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="tool-display__content">
          {input !== undefined && (
            <div className="tool-display__section">
              <span className="tool-display__section-label">Input</span>
              <pre className="tool-display__code">
                {formatValue(input, MAX_EXPANDED_LENGTH)}
              </pre>
            </div>
          )}
          {output !== undefined && (
            <div className="tool-display__section">
              <span className="tool-display__section-label">Output</span>
              <pre className="tool-display__code">
                {formatValue(output, MAX_EXPANDED_LENGTH)}
              </pre>
            </div>
          )}
          {isLoading && !input && !output && (
            <div className="tool-display__section">
              <span className="tool-display__waiting">Waiting for result...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

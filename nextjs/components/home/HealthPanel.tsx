/**
 * HealthPanel Component
 *
 * Displays backend health issues (errors and warnings) in a collapsible panel.
 * Appears at the bottom of the Home/Ground view when issues exist.
 * Uses REST API polling via useHealth hook.
 */

import React, { useCallback, useEffect } from "react";
import { useSession } from "../../contexts/SessionContext";
import { useHealth } from "../../hooks/useHealth";
import type { HealthIssue } from "@memory-loop/shared";
import "./HealthPanel.css";

/**
 * Formats the issue count for display in the header.
 */
function formatIssueCounts(issues: HealthIssue[]): string {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  const parts: string[] = [];
  if (errors > 0) {
    parts.push(`${errors} error${errors > 1 ? "s" : ""}`);
  }
  if (warnings > 0) {
    parts.push(`${warnings} warning${warnings > 1 ? "s" : ""}`);
  }
  return parts.join(", ");
}

/**
 * Maps health category to a human-readable label.
 */
function getCategoryLabel(category: HealthIssue["category"]): string {
  switch (category) {
    case "vault_config":
      return "Vault Config";
    case "file_watcher":
      return "File Watcher";
    case "cache":
      return "Cache";
    case "general":
    default:
      return "General";
  }
}

/**
 * HealthPanel displays backend health issues in a collapsible panel.
 *
 * - Renders nothing if no issues exist
 * - Collapsed state shows "Issues (N)" with error/warning counts
 * - Expanded state shows list with severity indicators and dismiss buttons
 * - Touch-friendly with 44px tap targets
 * - Uses REST API polling via useHealth hook
 */
export function HealthPanel(): React.ReactNode {
  const { health, vault, toggleHealthExpanded, setHealthIssues, dismissHealthIssue } = useSession();
  const { issues: fetchedIssues, dismissIssue: dismissFromHook } = useHealth(vault?.id);

  // Sync fetched issues to session context (only when a vault is selected)
  useEffect(() => {
    if (vault) {
      setHealthIssues(fetchedIssues);
    }
  }, [vault, fetchedIssues, setHealthIssues]);

  const handleToggle = useCallback(() => {
    toggleHealthExpanded();
  }, [toggleHealthExpanded]);

  const handleDismiss = useCallback(
    (issueId: string) => {
      // Update local state immediately (optimistic)
      dismissHealthIssue(issueId);
      // Also dismiss in the hook state
      dismissFromHook(issueId);
    },
    [dismissHealthIssue, dismissFromHook]
  );

  // Don't render if no issues
  if (health.issues.length === 0) {
    return null;
  }

  const issueCountText = formatIssueCounts(health.issues);
  const hasErrors = health.issues.some((i) => i.severity === "error");

  return (
    <section
      className={`health-panel ${hasErrors ? "health-panel--has-errors" : ""}`}
      aria-label="Backend health issues"
    >
      <button
        type="button"
        className="health-panel__header"
        onClick={handleToggle}
        aria-expanded={health.isExpanded}
        aria-controls="health-panel-content"
      >
        <span className="health-panel__title">
          <span className="health-panel__icon" aria-hidden="true">
            {hasErrors ? "!" : "⚠"}
          </span>
          Issues ({issueCountText})
        </span>
        <span
          className={`health-panel__chevron ${health.isExpanded ? "health-panel__chevron--expanded" : ""}`}
          aria-hidden="true"
        >
          ▼
        </span>
      </button>

      {health.isExpanded && (
        <ul
          id="health-panel-content"
          className="health-panel__list"
          role="list"
        >
          {health.issues.map((issue) => (
            <li
              key={issue.id}
              className={`health-panel__item health-panel__item--${issue.severity}`}
            >
              <div className="health-panel__item-content">
                <div className="health-panel__item-header">
                  <span className="health-panel__severity">
                    {issue.severity === "error" ? "Error" : "Warning"}
                  </span>
                  <span className="health-panel__category">
                    {getCategoryLabel(issue.category)}
                  </span>
                </div>
                <p className="health-panel__message">{issue.message}</p>
                {issue.details && (
                  <p className="health-panel__details">{issue.details}</p>
                )}
              </div>
              {issue.dismissible && (
                <button
                  type="button"
                  className="health-panel__dismiss"
                  onClick={() => handleDismiss(issue.id)}
                  aria-label={`Dismiss: ${issue.message}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

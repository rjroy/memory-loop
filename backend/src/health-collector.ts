/**
 * Health Collector
 *
 * Centralized error and warning aggregation for backend health reporting.
 * Each WebSocket connection gets its own collector instance.
 *
 * Features:
 * - Report/resolve/dismiss issues by ID
 * - Subscriber pattern for real-time updates
 * - Session-scoped (clear on vault change)
 * - Sorts errors before warnings
 */

import { createLogger } from "./logger.js";
import type { HealthIssue, HealthSeverity, HealthCategory } from "@memory-loop/shared";

const log = createLogger("Health");

/**
 * Callback type for health change notifications.
 */
export type HealthChangeCallback = (issues: HealthIssue[]) => void;

/**
 * Parameters for reporting a health issue.
 */
export interface ReportParams {
  /** Unique identifier for the issue (used for resolve/dismiss) */
  id: string;
  /** Severity level */
  severity: HealthSeverity;
  /** Issue category */
  category: HealthCategory;
  /** Human-readable message */
  message: string;
  /** Technical details (file path, error message, etc.) */
  details?: string;
  /** Whether user can dismiss this issue (default: true) */
  dismissible?: boolean;
}

/**
 * Collects and manages health issues for a connection.
 *
 * Usage:
 * ```typescript
 * const collector = createHealthCollector();
 *
 * // Subscribe to changes
 * const unsubscribe = collector.subscribe((issues) => {
 *   ws.send({ type: "health_report", issues });
 * });
 *
 * // Report an issue
 * collector.report({
 *   id: "widget_config_stats",
 *   severity: "error",
 *   category: "widget_config",
 *   message: "Invalid widget configuration",
 *   details: ".memory-loop/widgets/stats.yaml: missing 'name' field",
 * });
 *
 * // Resolve when fixed
 * collector.resolve("widget_config_stats");
 *
 * // Clear all on vault change
 * collector.clear();
 * ```
 */
export class HealthCollector {
  private issues: Map<string, HealthIssue> = new Map();
  private dismissedIds: Set<string> = new Set();
  private listeners: Set<HealthChangeCallback> = new Set();

  /**
   * Report a health issue.
   *
   * If an issue with the same ID already exists, it's replaced.
   * If the ID was previously dismissed, the report is ignored.
   */
  report(params: ReportParams): void {
    // Don't re-add dismissed issues
    if (this.dismissedIds.has(params.id)) {
      log.debug(`Ignoring dismissed issue: ${params.id}`);
      return;
    }

    const issue: HealthIssue = {
      id: params.id,
      severity: params.severity,
      category: params.category,
      message: params.message,
      details: params.details,
      timestamp: new Date().toISOString(),
      dismissible: params.dismissible ?? true,
    };

    const isNew = !this.issues.has(params.id);
    this.issues.set(params.id, issue);

    if (isNew) {
      log.info(`Health issue reported: [${params.severity}] ${params.message}`);
    } else {
      log.debug(`Health issue updated: ${params.id}`);
    }

    this.notifyListeners();
  }

  /**
   * Resolve a health issue (e.g., when the underlying error is fixed).
   *
   * @returns true if the issue was removed, false if it didn't exist
   */
  resolve(id: string): boolean {
    if (this.issues.delete(id)) {
      log.info(`Health issue resolved: ${id}`);
      this.notifyListeners();
      return true;
    }
    return false;
  }

  /**
   * Dismiss a health issue (user action).
   *
   * Dismissed issues won't reappear until the collector is cleared
   * (typically on vault change).
   *
   * @returns true if the issue was dismissed, false if it didn't exist
   */
  dismiss(id: string): boolean {
    if (this.issues.delete(id)) {
      this.dismissedIds.add(id);
      log.info(`Health issue dismissed: ${id}`);
      this.notifyListeners();
      return true;
    }
    return false;
  }

  /**
   * Clear all issues and dismissed IDs.
   *
   * Call this when switching vaults to reset health state.
   */
  clear(): void {
    const hadIssues = this.issues.size > 0;
    this.issues.clear();
    this.dismissedIds.clear();

    if (hadIssues) {
      log.info("Health collector cleared");
      this.notifyListeners();
    }
  }

  /**
   * Get all active issues (excludes dismissed).
   *
   * Issues are sorted: errors first, then by timestamp (newest first).
   */
  getIssues(): HealthIssue[] {
    return Array.from(this.issues.values())
      .filter((issue) => !this.dismissedIds.has(issue.id))
      .sort((a, b) => {
        // Errors first
        if (a.severity !== b.severity) {
          return a.severity === "error" ? -1 : 1;
        }
        // Then by timestamp (newest first)
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
  }

  /**
   * Check if there are any active issues.
   */
  hasIssues(): boolean {
    return this.issues.size > 0;
  }

  /**
   * Get counts by severity.
   */
  getCounts(): { errors: number; warnings: number; total: number } {
    let errors = 0;
    let warnings = 0;

    for (const issue of this.issues.values()) {
      if (issue.severity === "error") {
        errors++;
      } else {
        warnings++;
      }
    }

    return { errors, warnings, total: errors + warnings };
  }

  /**
   * Subscribe to health changes.
   *
   * The callback is invoked whenever issues change (report, resolve, dismiss, clear).
   *
   * @returns Unsubscribe function
   */
  subscribe(callback: HealthChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all subscribers of the current issue list.
   */
  private notifyListeners(): void {
    const issues = this.getIssues();
    for (const listener of this.listeners) {
      try {
        listener(issues);
      } catch (error) {
        log.error("Health listener error", error);
      }
    }
  }
}

/**
 * Create a new health collector instance.
 *
 * Each WebSocket connection should have its own collector.
 */
export function createHealthCollector(): HealthCollector {
  return new HealthCollector();
}

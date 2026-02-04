/**
 * useHealth Hook
 *
 * Handles health issue retrieval for a vault via REST API.
 * Polls the health endpoint periodically to get updated issues.
 *
 * Requirements:
 * - REQ-F-30: Health issues via GET /api/vaults/:vaultId/health
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { createApiClient, vaultPath, ApiError } from "../api/client.js";
import type { HealthIssue } from "@memory-loop/shared";
import type { FetchFn } from "../api/types.js";

/**
 * Health response from the API.
 */
export interface HealthResponse {
  issues: HealthIssue[];
}

/**
 * Return type for the useHealth hook.
 */
export interface UseHealthResult {
  /** Current health issues */
  issues: HealthIssue[];
  /** Whether a health check is in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;
  /** Manually refresh health status */
  refresh: () => Promise<void>;
  /** Dismiss a health issue locally (optimistic update) */
  dismissIssue: (issueId: string) => void;
}

/**
 * Configuration options for useHealth hook.
 */
export interface UseHealthOptions {
  /** Custom fetch implementation for testing */
  fetch?: FetchFn;
  /** Polling interval in milliseconds (default: 30000) */
  pollInterval?: number;
  /** Disable polling (for testing) */
  disablePolling?: boolean;
}

/**
 * Default polling interval (30 seconds).
 */
const DEFAULT_POLL_INTERVAL = 30000;

/**
 * React hook for health issue retrieval.
 *
 * @param vaultId - The vault ID to get health for (null if no vault selected)
 * @param options - Optional configuration (fetch for testing, poll interval)
 * @returns Health issues, loading state, and refresh function
 *
 * @example
 * ```tsx
 * const { issues, isLoading, refresh, dismissIssue } = useHealth(vault?.id);
 *
 * // Issues are automatically polled every 30 seconds
 * // Use refresh() to manually trigger a refresh
 * // Use dismissIssue(id) to optimistically remove an issue
 * ```
 */
export function useHealth(
  vaultId: string | null | undefined,
  options: UseHealthOptions = {}
): UseHealthResult {
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { pollInterval = DEFAULT_POLL_INTERVAL, disablePolling = false } = options;

  // Memoize API client to avoid recreating on each render
  const api = useMemo(
    () => createApiClient(options.fetch ? { fetch: options.fetch } : {}),
    [options.fetch]
  );

  /**
   * Fetch health issues from the API.
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (!vaultId) {
      setIssues([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.get<HealthResponse>(vaultPath(vaultId, "health"));
      setIssues(result.issues);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to get health status";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  /**
   * Dismiss an issue locally (optimistic update).
   * The server-side dismiss happens via a separate dismiss endpoint if needed.
   */
  const dismissIssue = useCallback((issueId: string): void => {
    setIssues((prev) => prev.filter((issue) => issue.id !== issueId));
  }, []);

  // Initial fetch when vaultId changes
  useEffect(() => {
    if (!vaultId) {
      setIssues([]);
      return;
    }

    void refresh();
  }, [vaultId, refresh]);

  // Polling effect
  useEffect(() => {
    if (!vaultId || disablePolling) {
      return;
    }

    const intervalId = setInterval(() => {
      void refresh();
    }, pollInterval);

    return () => {
      clearInterval(intervalId);
    };
  }, [vaultId, pollInterval, disablePolling, refresh]);

  return {
    issues,
    isLoading,
    error,
    refresh,
    dismissIssue,
  };
}

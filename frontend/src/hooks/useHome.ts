/**
 * useHome Hook
 *
 * Handles home dashboard operations for a vault.
 * Uses REST API client for goals, inspiration, and tasks.
 *
 * Requirements:
 * - REQ-F-19: Goals via GET /api/vaults/:vaultId/goals
 * - REQ-F-20: Inspiration via GET /api/vaults/:vaultId/inspiration
 * - REQ-F-21: Tasks via GET /api/vaults/:vaultId/tasks
 * - REQ-F-22: Task toggle via PATCH /api/vaults/:vaultId/tasks
 */

import { useState, useCallback, useMemo } from "react";
import { createApiClient, vaultPath, ApiError } from "../api/client.js";
import type { TaskEntry, InspirationItem } from "@memory-loop/shared";
import type { FetchFn } from "../api/types.js";

/**
 * Goals response from the API.
 */
export interface GoalsResponse {
  content: string | null;
}

/**
 * Inspiration response from the API.
 */
export interface InspirationResponse {
  contextual: InspirationItem | null;
  quote: InspirationItem;
}

/**
 * Tasks response from the API.
 */
export interface TasksResponse {
  tasks: TaskEntry[];
  incomplete: number;
  total: number;
}

/**
 * Task toggle response from the API.
 */
export interface TaskToggledResponse {
  filePath: string;
  lineNumber: number;
  newState: string;
}

/**
 * Daily prep status response from the API.
 */
export interface DailyPrepStatusResponse {
  exists: boolean;
  commitment?: string[];
  energy?: string;
  calendar?: string;
}

/**
 * Return type for the useHome hook.
 */
export interface UseHomeResult {
  /** Get goals content from the vault */
  getGoals: () => Promise<string | null>;
  /** Get inspiration (contextual prompt and quote) */
  getInspiration: () => Promise<InspirationResponse | null>;
  /** Get tasks from configured directories */
  getTasks: () => Promise<TasksResponse | null>;
  /** Toggle a task's completion state */
  toggleTask: (
    filePath: string,
    lineNumber: number,
    newState?: string
  ) => Promise<TaskToggledResponse | null>;
  /** Get daily prep status for today */
  getDailyPrepStatus: () => Promise<DailyPrepStatusResponse | null>;
  /** Whether an operation is currently in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Configuration options for useHome hook.
 */
export interface UseHomeOptions {
  /** Custom fetch implementation for testing */
  fetch?: FetchFn;
}

/**
 * React hook for home dashboard operations.
 *
 * @param vaultId - The vault ID to operate on
 * @param options - Optional configuration (fetch for testing)
 * @returns Home dashboard functions, loading state, and error state
 *
 * @example
 * ```tsx
 * const { getGoals, getTasks, toggleTask, isLoading } = useHome(vault?.id);
 *
 * useEffect(() => {
 *   getGoals().then((content) => setGoals(content));
 *   getTasks().then((result) => setTasks(result?.tasks ?? []));
 * }, [getGoals, getTasks]);
 * ```
 */
export function useHome(
  vaultId: string | undefined,
  options: UseHomeOptions = {}
): UseHomeResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize API client to avoid recreating on each render
  const api = useMemo(
    () => createApiClient(options.fetch ? { fetch: options.fetch } : {}),
    [options.fetch]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Get goals content from the vault.
   */
  const getGoals = useCallback(async (): Promise<string | null> => {
    if (!vaultId) {
      setError("No vault selected");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.get<GoalsResponse>(vaultPath(vaultId, "goals"));
      return result.content;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to get goals";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  /**
   * Get inspiration (contextual prompt and quote).
   */
  const getInspiration = useCallback(async (): Promise<InspirationResponse | null> => {
    console.log(`[useHome] getInspiration called, vaultId:`, vaultId);
    if (!vaultId) {
      setError("No vault selected");
      console.log(`[useHome] No vaultId, returning null`);
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = vaultPath(vaultId, "inspiration");
      console.log(`[useHome] Fetching:`, url);
      const result = await api.get<InspirationResponse>(url);
      console.log(`[useHome] Result:`, result);
      return result;
    } catch (err) {
      console.error(`[useHome] Error:`, err);
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to get inspiration";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  /**
   * Get tasks from configured directories.
   */
  const getTasks = useCallback(async (): Promise<TasksResponse | null> => {
    if (!vaultId) {
      setError("No vault selected");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.get<TasksResponse>(vaultPath(vaultId, "tasks"));
      return result;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to get tasks";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  /**
   * Toggle a task's completion state.
   */
  const toggleTask = useCallback(
    async (
      filePath: string,
      lineNumber: number,
      newState?: string
    ): Promise<TaskToggledResponse | null> => {
      if (!vaultId) {
        setError("No vault selected");
        return null;
      }

      if (!filePath) {
        setError("File path is required");
        return null;
      }

      if (lineNumber < 1) {
        setError("Line number must be at least 1");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const body: { filePath: string; lineNumber: number; newState?: string } = {
          filePath,
          lineNumber,
        };
        if (newState !== undefined) {
          body.newState = newState;
        }

        const result = await api.patch<TaskToggledResponse>(
          vaultPath(vaultId, "tasks"),
          body
        );
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to toggle task";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Get daily prep status for today.
   */
  const getDailyPrepStatus = useCallback(async (): Promise<DailyPrepStatusResponse | null> => {
    if (!vaultId) {
      setError("No vault selected");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.get<DailyPrepStatusResponse>(
        vaultPath(vaultId, "daily-prep/today")
      );
      return result;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to get daily prep status";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  return {
    getGoals,
    getInspiration,
    getTasks,
    toggleTask,
    getDailyPrepStatus,
    isLoading,
    error,
    clearError,
  };
}

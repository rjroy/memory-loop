/**
 * useMemory Hook
 *
 * Handles memory file operations via REST API.
 *
 * Requirements:
 * - REQ-F-35: Get memory content via GET /api/vaults/:vaultId/memory
 * - REQ-F-36: Save memory content via PUT /api/vaults/:vaultId/memory
 */

import { useState, useCallback, useMemo } from "react";
import { createApiClient, vaultPath, ApiError } from "../api/client.js";
import type { FetchFn } from "../api/types.js";

/**
 * Response from GET /memory.
 */
export interface MemoryContentResponse {
  content: string;
  sizeBytes: number;
  exists: boolean;
}

/**
 * Response from PUT /memory.
 */
export interface MemorySavedResponse {
  success: boolean;
  sizeBytes?: number;
  error?: string;
}

/**
 * Return type for the useMemory hook.
 */
export interface UseMemoryResult {
  /** Get memory file content and metadata */
  getMemory: () => Promise<MemoryContentResponse | null>;
  /** Save memory file content */
  saveMemory: (content: string) => Promise<boolean>;
  /** Whether an operation is currently in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Configuration options for useMemory hook.
 */
export interface UseMemoryOptions {
  /** Custom fetch implementation for testing */
  fetch?: FetchFn;
}

/**
 * React hook for memory file operations.
 *
 * @param vaultId - The vault ID to operate on
 * @param options - Optional configuration (fetch for testing)
 * @returns Memory functions, loading state, and error state
 *
 * @example
 * ```tsx
 * const { getMemory, saveMemory, isLoading } = useMemory(vault?.id);
 *
 * useEffect(() => {
 *   getMemory().then((result) => {
 *     if (result) {
 *       setContent(result.content);
 *     }
 *   });
 * }, [getMemory]);
 * ```
 */
export function useMemory(
  vaultId: string | undefined,
  options: UseMemoryOptions = {}
): UseMemoryResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize API client to avoid recreating on each render
  const api = useMemo(
    () => createApiClient({ fetch: options.fetch }),
    [options.fetch]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Get memory file content and metadata.
   */
  const getMemory = useCallback(async (): Promise<MemoryContentResponse | null> => {
    if (!vaultId) {
      setError("No vault selected");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.get<MemoryContentResponse>(
        vaultPath(vaultId, "memory")
      );
      return result;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to get memory";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  /**
   * Save memory file content.
   */
  const saveMemory = useCallback(
    async (content: string): Promise<boolean> => {
      if (!vaultId) {
        setError("No vault selected");
        return false;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.put<MemorySavedResponse>(
          vaultPath(vaultId, "memory"),
          { content }
        );
        return result.success;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to save memory";
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  return {
    getMemory,
    saveMemory,
    isLoading,
    error,
    clearError,
  };
}

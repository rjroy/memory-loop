/**
 * useSessions Hook
 *
 * Handles session management operations via REST API.
 *
 * Requirements:
 * - REQ-F-40: Delete session via DELETE /api/vaults/:vaultId/sessions/:sessionId
 */

import { useState, useCallback, useMemo } from "react";
import { createApiClient, vaultPath, ApiError } from "../api/client.js";
import type { FetchFn } from "../api/types.js";

/**
 * Response from DELETE /sessions/:sessionId.
 */
export interface DeleteSessionResponse {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Return type for the useSessions hook.
 */
export interface UseSessionsResult {
  /** Delete a session by ID */
  deleteSession: (sessionId: string) => Promise<boolean>;
  /** Whether an operation is currently in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Configuration options for useSessions hook.
 */
export interface UseSessionsOptions {
  /** Custom fetch implementation for testing */
  fetch?: FetchFn;
}

/**
 * React hook for session management operations.
 *
 * @param vaultId - The vault ID to operate on
 * @param options - Optional configuration (fetch for testing)
 * @returns Session functions, loading state, and error state
 *
 * @example
 * ```tsx
 * const { deleteSession, isLoading, error } = useSessions(vault?.id);
 *
 * const handleDelete = async (sessionId: string) => {
 *   const success = await deleteSession(sessionId);
 *   if (success) {
 *     console.log("Session deleted");
 *   }
 * };
 * ```
 */
export function useSessions(
  vaultId: string | undefined,
  options: UseSessionsOptions = {}
): UseSessionsResult {
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
   * Delete a session by ID.
   */
  const deleteSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      if (!vaultId) {
        setError("No vault selected");
        return false;
      }

      if (!sessionId) {
        setError("Session ID is required");
        return false;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.delete<DeleteSessionResponse>(
          vaultPath(vaultId, `sessions/${encodeURIComponent(sessionId)}`)
        );
        return result.success;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to delete session";
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  return {
    deleteSession,
    isLoading,
    error,
    clearError,
  };
}

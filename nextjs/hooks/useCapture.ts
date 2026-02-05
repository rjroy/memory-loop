/**
 * useCapture Hook
 *
 * Handles note capture operations for a vault.
 * Uses REST API client for capture and recent activity retrieval.
 *
 * Requirements:
 * - REQ-F-16: Note capture via POST /api/vaults/:vaultId/capture
 * - REQ-F-17: Recent notes via GET /api/vaults/:vaultId/recent-notes
 * - REQ-F-18: Recent activity via GET /api/vaults/:vaultId/recent-activity
 */

import { useState, useCallback, useMemo } from "react";
import { createApiClient, vaultPath, ApiError } from "@/lib/api/client";
import type { RecentNoteEntry, RecentDiscussionEntry } from "@memory-loop/shared";
import type { FetchFn } from "@/lib/api/types";

/**
 * Result of a capture operation.
 */
export interface CaptureResult {
  success: boolean;
  timestamp: string;
  notePath: string;
}

/**
 * Recent activity response containing both captures and discussions.
 */
export interface RecentActivity {
  captures: RecentNoteEntry[];
  discussions: RecentDiscussionEntry[];
}

/**
 * Return type for the useCapture hook.
 */
export interface UseCaptureResult {
  /** Capture a note to today's daily note */
  captureNote: (text: string) => Promise<CaptureResult | null>;
  /** Get recent captured notes from the vault inbox */
  getRecentNotes: (limit?: number) => Promise<RecentNoteEntry[]>;
  /** Get recent activity (captures + discussions) */
  getRecentActivity: () => Promise<RecentActivity | null>;
  /** Whether an operation is currently in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Configuration options for useCapture hook.
 */
export interface UseCaptureOptions {
  /** Custom fetch implementation for testing */
  fetch?: FetchFn;
}

/**
 * React hook for note capture operations.
 *
 * @param vaultId - The vault ID to capture notes to
 * @param options - Optional configuration (fetch for testing)
 * @returns Capture functions, loading state, and error state
 *
 * @example
 * ```tsx
 * const { captureNote, isLoading, error } = useCapture(vault?.id);
 *
 * const handleCapture = async (text: string) => {
 *   const result = await captureNote(text);
 *   if (result) {
 *     console.log("Captured at:", result.timestamp);
 *   }
 * };
 * ```
 */
export function useCapture(
  vaultId: string | undefined,
  options: UseCaptureOptions = {}
): UseCaptureResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize API client to avoid recreating on each render
  // Only pass fetch if provided, otherwise use default
  const api = useMemo(
    () => createApiClient(options.fetch ? { fetch: options.fetch } : {}),
    [options.fetch]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Capture a note to today's daily note.
   */
  const captureNote = useCallback(
    async (text: string): Promise<CaptureResult | null> => {
      if (!vaultId) {
        setError("No vault selected");
        return null;
      }

      if (!text.trim()) {
        setError("Note text is required");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.post<CaptureResult>(
          vaultPath(vaultId, "capture"),
          { text }
        );
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to capture note";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Get recent captured notes from the vault inbox.
   */
  const getRecentNotes = useCallback(
    async (limit?: number): Promise<RecentNoteEntry[]> => {
      if (!vaultId) {
        setError("No vault selected");
        return [];
      }

      setIsLoading(true);
      setError(null);

      try {
        const path = limit
          ? `${vaultPath(vaultId, "recent-notes")}?limit=${limit}`
          : vaultPath(vaultId, "recent-notes");

        const result = await api.get<{ notes: RecentNoteEntry[] }>(path);
        return result.notes;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to get recent notes";
        setError(message);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Get recent activity (captures + discussions).
   */
  const getRecentActivity = useCallback(async (): Promise<RecentActivity | null> => {
    console.log(`[useCapture] getRecentActivity called, vaultId:`, vaultId);
    if (!vaultId) {
      setError("No vault selected");
      console.log(`[useCapture] No vaultId, returning null`);
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = vaultPath(vaultId, "recent-activity");
      console.log(`[useCapture] Fetching:`, url);
      const result = await api.get<RecentActivity>(url);
      console.log(`[useCapture] Result:`, result);
      return result;
    } catch (err) {
      console.error(`[useCapture] Error:`, err);
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to get recent activity";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  return {
    captureNote,
    getRecentNotes,
    getRecentActivity,
    isLoading,
    error,
    clearError,
  };
}

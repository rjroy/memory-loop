/**
 * useMeetings Hook
 *
 * Handles meeting operations for a vault via REST API.
 *
 * Requirements:
 * - REQ-F-23: Start meeting via POST /api/vaults/:vaultId/meetings
 * - REQ-F-24: Stop meeting via DELETE /api/vaults/:vaultId/meetings/current
 * - REQ-F-25: Get meeting state via GET /api/vaults/:vaultId/meetings/current
 */

import { useState, useCallback, useMemo } from "react";
import { createApiClient, vaultPath, ApiError } from "../api/client.js";
import type { FetchFn } from "../api/types.js";

/**
 * Response from POST /meetings (start meeting).
 */
export interface MeetingStartedResponse {
  title: string;
  filePath: string;
  startedAt: string;
}

/**
 * Response from DELETE /meetings/current (stop meeting).
 */
export interface MeetingStoppedResponse {
  filePath: string;
  content: string;
  entryCount: number;
}

/**
 * Response from GET /meetings/current (meeting state).
 */
export interface MeetingStateResponse {
  isActive: boolean;
  title?: string;
  filePath?: string;
  startedAt?: string;
}

/**
 * Return type for the useMeetings hook.
 */
export interface UseMeetingsResult {
  /** Start a new meeting with the given title */
  startMeeting: (title: string) => Promise<MeetingStartedResponse | null>;
  /** Stop the current meeting */
  stopMeeting: () => Promise<MeetingStoppedResponse | null>;
  /** Get the current meeting state */
  getMeetingState: () => Promise<MeetingStateResponse | null>;
  /** Whether an operation is currently in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Configuration options for useMeetings hook.
 */
export interface UseMeetingsOptions {
  /** Custom fetch implementation for testing */
  fetch?: FetchFn;
}

/**
 * React hook for meeting operations.
 *
 * @param vaultId - The vault ID to operate on
 * @param options - Optional configuration (fetch for testing)
 * @returns Meeting functions, loading state, and error state
 *
 * @example
 * ```tsx
 * const { startMeeting, stopMeeting, getMeetingState, isLoading } = useMeetings(vault?.id);
 *
 * const handleStart = async () => {
 *   const result = await startMeeting("Sprint Planning");
 *   if (result) {
 *     console.log(`Meeting started: ${result.filePath}`);
 *   }
 * };
 * ```
 */
export function useMeetings(
  vaultId: string | undefined,
  options: UseMeetingsOptions = {}
): UseMeetingsResult {
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
   * Start a new meeting with the given title.
   */
  const startMeeting = useCallback(
    async (title: string): Promise<MeetingStartedResponse | null> => {
      if (!vaultId) {
        setError("No vault selected");
        return null;
      }

      if (!title.trim()) {
        setError("Meeting title is required");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.post<MeetingStartedResponse>(
          vaultPath(vaultId, "meetings"),
          { title }
        );
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to start meeting";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Stop the current meeting.
   */
  const stopMeeting = useCallback(async (): Promise<MeetingStoppedResponse | null> => {
    if (!vaultId) {
      setError("No vault selected");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.delete<MeetingStoppedResponse>(
        vaultPath(vaultId, "meetings/current")
      );
      return result;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to stop meeting";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  /**
   * Get the current meeting state.
   */
  const getMeetingState = useCallback(async (): Promise<MeetingStateResponse | null> => {
    if (!vaultId) {
      setError("No vault selected");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.get<MeetingStateResponse>(
        vaultPath(vaultId, "meetings/current")
      );
      return result;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to get meeting state";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  return {
    startMeeting,
    stopMeeting,
    getMeetingState,
    isLoading,
    error,
    clearError,
  };
}

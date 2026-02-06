/**
 * useConfig Hook
 *
 * Handles vault configuration operations via REST API.
 *
 * Requirements:
 * - REQ-F-29: Get pinned assets via GET /api/vaults/:vaultId/pinned-assets
 * - REQ-F-30: Set pinned assets via PUT /api/vaults/:vaultId/pinned-assets
 * - REQ-F-31: Update vault config via PATCH /api/vaults/:vaultId/config
 * - REQ-F-32: Setup vault via POST /api/vaults/:vaultId/setup
 */

import { useState, useCallback, useMemo } from "react";
import { createApiClient, vaultPath, ApiError } from "@/lib/api/client";
import type { FetchFn } from "@/lib/api/types";
import type { EditableVaultConfig } from "@/lib/schemas";

/**
 * Response from GET/PUT /pinned-assets.
 */
export interface PinnedAssetsResponse {
  paths: string[];
}

/**
 * Response from PATCH /config.
 */
export interface ConfigUpdateResponse {
  success: boolean;
}

/**
 * Response from POST /setup.
 */
export interface SetupResponse {
  success: boolean;
  summary: Array<{
    step: string;
    success: boolean;
    message?: string;
  }>;
}

/**
 * Return type for the useConfig hook.
 */
export interface UseConfigResult {
  /** Get pinned asset paths */
  getPinnedAssets: () => Promise<string[] | null>;
  /** Set pinned asset paths */
  setPinnedAssets: (paths: string[]) => Promise<string[] | null>;
  /** Update vault configuration */
  updateConfig: (config: EditableVaultConfig) => Promise<boolean>;
  /** Setup vault (create directories, install commands) */
  setupVault: () => Promise<SetupResponse | null>;

  /** Whether an operation is currently in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Configuration options for useConfig hook.
 */
export interface UseConfigOptions {
  /** Custom fetch implementation for testing */
  fetch?: FetchFn;
}

/**
 * React hook for vault configuration operations.
 *
 * @param vaultId - The vault ID to operate on
 * @param options - Optional configuration (fetch for testing)
 * @returns Config functions, loading state, and error state
 *
 * @example
 * ```tsx
 * const { getPinnedAssets, updateConfig, isLoading } = useConfig(vault?.id);
 *
 * const handleSaveConfig = async (config) => {
 *   const success = await updateConfig(config);
 *   if (success) {
 *     console.log("Config saved successfully");
 *   }
 * };
 * ```
 */
export function useConfig(
  vaultId: string | undefined,
  options: UseConfigOptions = {}
): UseConfigResult {
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
   * Get pinned asset paths.
   */
  const getPinnedAssets = useCallback(async (): Promise<string[] | null> => {
    if (!vaultId) {
      setError("No vault selected");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.get<PinnedAssetsResponse>(
        vaultPath(vaultId, "pinned-assets")
      );
      return result.paths;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to get pinned assets";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  /**
   * Set pinned asset paths.
   */
  const setPinnedAssets = useCallback(
    async (paths: string[]): Promise<string[] | null> => {
      if (!vaultId) {
        setError("No vault selected");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.put<PinnedAssetsResponse>(
          vaultPath(vaultId, "pinned-assets"),
          { paths }
        );
        return result.paths;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to set pinned assets";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Update vault configuration.
   */
  const updateConfig = useCallback(
    async (config: EditableVaultConfig): Promise<boolean> => {
      if (!vaultId) {
        setError("No vault selected");
        return false;
      }

      setIsLoading(true);
      setError(null);

      try {
        await api.patch<ConfigUpdateResponse>(
          vaultPath(vaultId, "config"),
          config
        );
        return true;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to update config";
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Setup vault (create directories, install commands).
   */
  const setupVault = useCallback(async (): Promise<SetupResponse | null> => {
    if (!vaultId) {
      setError("No vault selected");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.post<SetupResponse>(
        vaultPath(vaultId, "setup")
      );
      return result;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to setup vault";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  return {
    getPinnedAssets,
    setPinnedAssets,
    updateConfig,
    setupVault,

    isLoading,
    error,
    clearError,
  };
}

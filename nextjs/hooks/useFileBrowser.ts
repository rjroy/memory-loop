/**
 * useFileBrowser Hook
 *
 * Provides file browser operations for interacting with vault files via REST API.
 * Uses the API client with dependency injection for testability.
 *
 * Requirements:
 * - TASK-014: File Browser Hooks for REST API Migration
 * - REQ-F-5 through REQ-F-15: File browser operations
 */

import { useState, useCallback, useMemo } from "react";
import { createApiClient, vaultPath, ApiError } from "@/lib/api/client";
import type { FetchFn } from "@/lib/api/types";
import type { FileEntry } from "@memory-loop/shared";

// =============================================================================
// Response Types (matching backend route responses)
// =============================================================================

/**
 * Response from GET /files (directory listing)
 */
export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
}

/**
 * Response from GET /files/* (file content)
 */
export interface FileContent {
  path: string;
  content: string;
  truncated: boolean;
}

/**
 * Response from POST /files (create file)
 */
export interface CreateFileResponse {
  path: string;
}

/**
 * Response from POST /directories (create directory)
 */
export interface CreateDirectoryResponse {
  path: string;
}

/**
 * Response from PUT /files/* (write file)
 */
export interface WriteFileResponse {
  path: string;
  success: boolean;
}

/**
 * Response from DELETE /files/* (delete file)
 */
export interface DeleteFileResponse {
  path: string;
}

/**
 * Response from DELETE /directories/* (delete directory)
 */
export interface DeleteDirectoryResponse {
  path: string;
  filesDeleted: number;
  directoriesDeleted: number;
}

/**
 * Response from GET /directories/:path/contents (directory contents preview)
 */
export interface DirectoryContentsResponse {
  path: string;
  files: string[];
  directories: string[];
  totalFiles: number;
  totalDirectories: number;
  truncated: boolean;
}

/**
 * Response from PATCH /files/* (rename/move file)
 */
export interface RenameFileResponse {
  oldPath: string;
  newPath: string;
  referencesUpdated: number;
}

// =============================================================================
// Hook Configuration
// =============================================================================

/**
 * Configuration options for the useFileBrowser hook.
 * Supports dependency injection for testing.
 */
export interface UseFileBrowserConfig {
  /** Custom fetch function for testing */
  fetch?: FetchFn;
}

// =============================================================================
// Hook Return Type
// =============================================================================

/**
 * Return type for the useFileBrowser hook.
 */
export interface UseFileBrowserResult {
  /** List directory contents */
  listDirectory: (path: string) => Promise<DirectoryListing>;
  /** Read file content */
  readFile: (path: string) => Promise<FileContent>;
  /** Write content to an existing file */
  writeFile: (path: string, content: string) => Promise<void>;
  /** Delete a file */
  deleteFile: (path: string) => Promise<void>;
  /** Create a new file (path is parent directory, name is the file name without extension) */
  createFile: (parentPath: string, name: string) => Promise<string>;
  /** Create a new directory (path is parent directory, name is the directory name) */
  createDirectory: (parentPath: string, name: string) => Promise<string>;
  /** Delete a directory and all its contents */
  deleteDirectory: (path: string) => Promise<DeleteDirectoryResponse>;
  /** Get directory contents for deletion preview */
  getDirectoryContents: (path: string) => Promise<DirectoryContentsResponse>;
  /** Rename a file or directory */
  renameFile: (path: string, newName: string) => Promise<RenameFileResponse>;
  /** Move a file or directory to a new location */
  moveFile: (path: string, newPath: string) => Promise<RenameFileResponse>;
  /** Whether any operation is currently in progress */
  isLoading: boolean;
  /** Error from the last failed operation */
  error: ApiError | null;
  /** Clear the current error */
  clearError: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for file browser operations on a vault.
 *
 * @param vaultId - The vault ID to operate on
 * @param config - Optional configuration (for testing)
 * @returns File browser operations, loading state, and error state
 *
 * @example
 * ```tsx
 * const { listDirectory, readFile, isLoading, error } = useFileBrowser(vault?.id);
 *
 * const handleNavigate = async (path: string) => {
 *   const listing = await listDirectory(path);
 *   setEntries(listing.entries);
 * };
 * ```
 */
export function useFileBrowser(
  vaultId: string | undefined,
  config: UseFileBrowserConfig = {}
): UseFileBrowserResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Create API client (memoized to avoid recreating on every render)
  const api = useMemo(() => createApiClient(config.fetch ? { fetch: config.fetch } : {}), [config.fetch]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Helper to encode a file path for use in URL.
   * Each path segment is encoded separately to preserve slashes.
   */
  const encodeFilePath = useCallback((filePath: string): string => {
    // Split, encode each segment, rejoin with /
    return filePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }, []);

  /**
   * List directory contents.
   * GET /api/vaults/:vaultId/files?path=...
   */
  const listDirectory = useCallback(
    async (path: string): Promise<DirectoryListing> => {
      if (!vaultId) {
        const err = new ApiError(400, "VALIDATION_ERROR", "No vault selected");
        setError(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        const queryPath = path ? `?path=${encodeURIComponent(path)}` : "";
        const result = await api.get<DirectoryListing>(
          vaultPath(vaultId, `files${queryPath}`)
        );
        return result;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "INTERNAL_ERROR", String(err));
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Read file content.
   * GET /api/vaults/:vaultId/files/:path
   */
  const readFile = useCallback(
    async (path: string): Promise<FileContent> => {
      if (!vaultId) {
        const err = new ApiError(400, "VALIDATION_ERROR", "No vault selected");
        setError(err);
        throw err;
      }

      if (!path) {
        const err = new ApiError(400, "VALIDATION_ERROR", "File path is required");
        setError(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.get<FileContent>(
          vaultPath(vaultId, `files/${encodeFilePath(path)}`)
        );
        return result;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "INTERNAL_ERROR", String(err));
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api, encodeFilePath]
  );

  /**
   * Write content to an existing file.
   * PUT /api/vaults/:vaultId/files/:path
   */
  const writeFile = useCallback(
    async (path: string, content: string): Promise<void> => {
      if (!vaultId) {
        const err = new ApiError(400, "VALIDATION_ERROR", "No vault selected");
        setError(err);
        throw err;
      }

      if (!path) {
        const err = new ApiError(400, "VALIDATION_ERROR", "File path is required");
        setError(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        await api.put<WriteFileResponse>(
          vaultPath(vaultId, `files/${encodeFilePath(path)}`),
          { content }
        );
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "INTERNAL_ERROR", String(err));
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api, encodeFilePath]
  );

  /**
   * Delete a file.
   * DELETE /api/vaults/:vaultId/files/:path
   */
  const deleteFile = useCallback(
    async (path: string): Promise<void> => {
      if (!vaultId) {
        const err = new ApiError(400, "VALIDATION_ERROR", "No vault selected");
        setError(err);
        throw err;
      }

      if (!path) {
        const err = new ApiError(400, "VALIDATION_ERROR", "File path is required");
        setError(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        await api.delete<DeleteFileResponse>(
          vaultPath(vaultId, `files/${encodeFilePath(path)}`)
        );
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "INTERNAL_ERROR", String(err));
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api, encodeFilePath]
  );

  /**
   * Create a new file.
   * POST /api/vaults/:vaultId/files
   */
  const createFile = useCallback(
    async (parentPath: string, name: string): Promise<string> => {
      if (!vaultId) {
        const err = new ApiError(400, "VALIDATION_ERROR", "No vault selected");
        setError(err);
        throw err;
      }

      if (!name) {
        const err = new ApiError(400, "VALIDATION_ERROR", "File name is required");
        setError(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.post<CreateFileResponse>(
          vaultPath(vaultId, "files"),
          { path: parentPath, name }
        );
        return result.path;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "INTERNAL_ERROR", String(err));
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Create a new directory.
   * POST /api/vaults/:vaultId/directories
   */
  const createDirectory = useCallback(
    async (parentPath: string, name: string): Promise<string> => {
      if (!vaultId) {
        const err = new ApiError(400, "VALIDATION_ERROR", "No vault selected");
        setError(err);
        throw err;
      }

      if (!name) {
        const err = new ApiError(400, "VALIDATION_ERROR", "Directory name is required");
        setError(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.post<CreateDirectoryResponse>(
          vaultPath(vaultId, "directories"),
          { path: parentPath, name }
        );
        return result.path;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "INTERNAL_ERROR", String(err));
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Delete a directory and all its contents.
   * DELETE /api/vaults/:vaultId/directories/:path
   */
  const deleteDirectory = useCallback(
    async (path: string): Promise<DeleteDirectoryResponse> => {
      if (!vaultId) {
        const err = new ApiError(400, "VALIDATION_ERROR", "No vault selected");
        setError(err);
        throw err;
      }

      if (!path) {
        const err = new ApiError(400, "VALIDATION_ERROR", "Directory path is required");
        setError(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.delete<DeleteDirectoryResponse>(
          vaultPath(vaultId, `directories/${encodeFilePath(path)}`)
        );
        return result;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "INTERNAL_ERROR", String(err));
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api, encodeFilePath]
  );

  /**
   * Get directory contents for deletion preview.
   * GET /api/vaults/:vaultId/directories/:path/contents
   */
  const getDirectoryContents = useCallback(
    async (path: string): Promise<DirectoryContentsResponse> => {
      if (!vaultId) {
        const err = new ApiError(400, "VALIDATION_ERROR", "No vault selected");
        setError(err);
        throw err;
      }

      if (!path) {
        const err = new ApiError(400, "VALIDATION_ERROR", "Directory path is required");
        setError(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.get<DirectoryContentsResponse>(
          vaultPath(vaultId, `directories/${encodeFilePath(path)}/contents`)
        );
        return result;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "INTERNAL_ERROR", String(err));
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api, encodeFilePath]
  );

  /**
   * Rename a file or directory.
   * PATCH /api/vaults/:vaultId/files/:path with { newName }
   */
  const renameFile = useCallback(
    async (path: string, newName: string): Promise<RenameFileResponse> => {
      if (!vaultId) {
        const err = new ApiError(400, "VALIDATION_ERROR", "No vault selected");
        setError(err);
        throw err;
      }

      if (!path) {
        const err = new ApiError(400, "VALIDATION_ERROR", "File path is required");
        setError(err);
        throw err;
      }

      if (!newName) {
        const err = new ApiError(400, "VALIDATION_ERROR", "New name is required");
        setError(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.patch<RenameFileResponse>(
          vaultPath(vaultId, `files/${encodeFilePath(path)}`),
          { newName }
        );
        return result;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "INTERNAL_ERROR", String(err));
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api, encodeFilePath]
  );

  /**
   * Move a file or directory to a new location.
   * PATCH /api/vaults/:vaultId/files/:path with { newPath }
   */
  const moveFile = useCallback(
    async (path: string, newPath: string): Promise<RenameFileResponse> => {
      if (!vaultId) {
        const err = new ApiError(400, "VALIDATION_ERROR", "No vault selected");
        setError(err);
        throw err;
      }

      if (!path) {
        const err = new ApiError(400, "VALIDATION_ERROR", "File path is required");
        setError(err);
        throw err;
      }

      if (!newPath) {
        const err = new ApiError(400, "VALIDATION_ERROR", "New path is required");
        setError(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.patch<RenameFileResponse>(
          vaultPath(vaultId, `files/${encodeFilePath(path)}`),
          { newPath }
        );
        return result;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "INTERNAL_ERROR", String(err));
        setError(apiError);
        throw apiError;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api, encodeFilePath]
  );

  return {
    listDirectory,
    readFile,
    writeFile,
    deleteFile,
    createFile,
    createDirectory,
    deleteDirectory,
    getDirectoryContents,
    renameFile,
    moveFile,
    isLoading,
    error,
    clearError,
  };
}

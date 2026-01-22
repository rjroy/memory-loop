/**
 * useSearch Hook
 *
 * Handles search operations for a vault.
 * Uses REST API client for file search, content search, and snippets.
 *
 * Requirements:
 * - REQ-F-26: File name search via GET /api/vaults/:vaultId/search/files
 * - REQ-F-27: Content search via GET /api/vaults/:vaultId/search/content
 * - REQ-F-28: Context snippets via GET /api/vaults/:vaultId/search/snippets
 */

import { useState, useCallback, useMemo } from "react";
import { createApiClient, vaultPath, ApiError } from "../api/client.js";
import type { FileSearchResult, ContentSearchResult, ContextSnippet } from "@memory-loop/shared";
import type { FetchFn } from "../api/types.js";

/**
 * Search results response from the API.
 */
export interface SearchResultsResponse<T> {
  results: T[];
  totalMatches: number;
  searchTimeMs: number;
}

/**
 * Snippets response from the API.
 */
export interface SnippetsResponse {
  path: string;
  snippets: ContextSnippet[];
}

/**
 * Return type for the useSearch hook.
 */
export interface UseSearchResult {
  /** Search files by name using fuzzy matching */
  searchFiles: (query: string, limit?: number) => Promise<SearchResultsResponse<FileSearchResult> | null>;
  /** Search file contents using full-text search */
  searchContent: (query: string, limit?: number) => Promise<SearchResultsResponse<ContentSearchResult> | null>;
  /** Get context snippets for a file matching a query */
  getSnippets: (path: string, query: string) => Promise<ContextSnippet[]>;
  /** Whether an operation is currently in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Configuration options for useSearch hook.
 */
export interface UseSearchOptions {
  /** Custom fetch implementation for testing */
  fetch?: FetchFn;
}

/**
 * React hook for search operations.
 *
 * @param vaultId - The vault ID to search in
 * @param options - Optional configuration (fetch for testing)
 * @returns Search functions, loading state, and error state
 *
 * @example
 * ```tsx
 * const { searchFiles, searchContent, getSnippets, isLoading } = useSearch(vault?.id);
 *
 * const handleSearch = async (query: string) => {
 *   const results = await searchFiles(query);
 *   if (results) {
 *     console.log(`Found ${results.totalMatches} files in ${results.searchTimeMs}ms`);
 *   }
 * };
 * ```
 */
export function useSearch(
  vaultId: string | undefined,
  options: UseSearchOptions = {}
): UseSearchResult {
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
   * Search files by name using fuzzy matching.
   */
  const searchFiles = useCallback(
    async (
      query: string,
      limit?: number
    ): Promise<SearchResultsResponse<FileSearchResult> | null> => {
      if (!vaultId) {
        setError("No vault selected");
        return null;
      }

      if (!query.trim()) {
        setError("Search query is required");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ q: query });
        if (limit !== undefined) {
          params.set("limit", String(limit));
        }

        const result = await api.get<SearchResultsResponse<FileSearchResult>>(
          `${vaultPath(vaultId, "search/files")}?${params.toString()}`
        );
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to search files";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Search file contents using full-text search.
   */
  const searchContent = useCallback(
    async (
      query: string,
      limit?: number
    ): Promise<SearchResultsResponse<ContentSearchResult> | null> => {
      if (!vaultId) {
        setError("No vault selected");
        return null;
      }

      if (!query.trim()) {
        setError("Search query is required");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ q: query });
        if (limit !== undefined) {
          params.set("limit", String(limit));
        }

        const result = await api.get<SearchResultsResponse<ContentSearchResult>>(
          `${vaultPath(vaultId, "search/content")}?${params.toString()}`
        );
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to search content";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Get context snippets for a file matching a query.
   */
  const getSnippets = useCallback(
    async (path: string, query: string): Promise<ContextSnippet[]> => {
      if (!vaultId) {
        setError("No vault selected");
        return [];
      }

      if (!path.trim()) {
        setError("File path is required");
        return [];
      }

      if (!query.trim()) {
        setError("Search query is required");
        return [];
      }

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ path, q: query });
        const result = await api.get<SnippetsResponse>(
          `${vaultPath(vaultId, "search/snippets")}?${params.toString()}`
        );
        return result.snippets;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to get snippets";
        setError(message);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  return {
    searchFiles,
    searchContent,
    getSnippets,
    isLoading,
    error,
    clearError,
  };
}

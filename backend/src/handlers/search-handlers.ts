/**
 * Search Handlers
 *
 * Provides search functions for the REST API:
 * - searchFilesRest: Fuzzy file name search
 * - searchContentRest: Full-text content search
 * - getSnippetsRest: Context snippets for a file matching a query
 *
 * Note: WebSocket search handlers have been removed. Search operations
 * are now REST-only via routes/search.ts.
 */

import { serverLog as log } from "../logger.js";
import { getOrCreateIndex } from "../search-cache.js";
import type { FileSearchResult, ContentSearchResult, ContextSnippet } from "@memory-loop/shared";

// =============================================================================
// REST API Search Functions (using search cache)
// =============================================================================

/**
 * Search result with timing metadata for REST responses.
 */
export interface SearchResultWithTiming<T> {
  results: T[];
  totalMatches: number;
  searchTimeMs: number;
}

/**
 * Searches for files by name using fuzzy matching.
 * Uses the search cache for index management.
 *
 * @param vaultId - Unique identifier for the vault
 * @param vaultPath - Absolute path to the vault's content root
 * @param query - Search query string
 * @param limit - Maximum number of results (optional)
 * @returns Search results with timing metadata
 */
export async function searchFilesRest(
  vaultId: string,
  vaultPath: string,
  query: string,
  limit?: number
): Promise<SearchResultWithTiming<FileSearchResult>> {
  log.info(`[REST] Searching files in ${vaultId}: "${query}" (limit: ${limit ?? "default"})`);

  const startTime = Date.now();
  const index = getOrCreateIndex(vaultId, vaultPath);
  const results = await index.searchFiles(query, { limit });
  const searchTimeMs = Date.now() - startTime;

  log.info(`[REST] File search complete: ${results.length} results in ${searchTimeMs}ms`);

  return {
    results,
    totalMatches: results.length,
    searchTimeMs,
  };
}

/**
 * Searches file contents using full-text search.
 * Uses the search cache for index management.
 *
 * @param vaultId - Unique identifier for the vault
 * @param vaultPath - Absolute path to the vault's content root
 * @param query - Search query string
 * @param limit - Maximum number of results (optional)
 * @returns Search results with timing metadata
 */
export async function searchContentRest(
  vaultId: string,
  vaultPath: string,
  query: string,
  limit?: number
): Promise<SearchResultWithTiming<ContentSearchResult>> {
  log.info(`[REST] Searching content in ${vaultId}: "${query}" (limit: ${limit ?? "default"})`);

  const startTime = Date.now();
  const index = getOrCreateIndex(vaultId, vaultPath);
  const results = await index.searchContent(query, { limit });
  const searchTimeMs = Date.now() - startTime;

  log.info(`[REST] Content search complete: ${results.length} results in ${searchTimeMs}ms`);

  return {
    results,
    totalMatches: results.length,
    searchTimeMs,
  };
}

/**
 * Gets context snippets for a specific file matching a query.
 * Uses the search cache for index management.
 *
 * @param vaultId - Unique identifier for the vault
 * @param vaultPath - Absolute path to the vault's content root
 * @param path - File path relative to vault content root
 * @param query - Search query to highlight
 * @returns Array of context snippets
 */
export async function getSnippetsRest(
  vaultId: string,
  vaultPath: string,
  path: string,
  query: string
): Promise<ContextSnippet[]> {
  log.info(`[REST] Getting snippets: "${path}" for query "${query}"`);

  const index = getOrCreateIndex(vaultId, vaultPath);
  const snippets = await index.getSnippets(path, query);

  log.info(`[REST] Got ${snippets.length} snippets for ${path}`);

  return snippets;
}

/**
 * Search REST Routes
 *
 * Provides REST endpoints for search operations:
 * - GET /files?q= - File name search (fuzzy matching)
 * - GET /content?q= - Content search (full-text)
 * - GET /snippets?path=&q= - Context snippets for a file
 *
 * Requirements:
 * - REQ-F-26: File name search
 * - REQ-F-27: Content search
 * - REQ-F-28: Context snippets
 * - REQ-NF-2: Search performance <500ms
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-010)
 */

import { Hono } from "hono";
import { getVaultFromContext, jsonError } from "../middleware/vault-resolution.js";
import {
  searchFilesRest,
  searchContentRest,
  getSnippetsRest,
} from "../handlers/search-handlers.js";

/**
 * Search routes router.
 *
 * Expects to be mounted under /api/vaults/:vaultId/search with vault middleware applied.
 */
const searchRoutes = new Hono();

/**
 * GET /files?q=&limit=
 *
 * Search for files by name using fuzzy matching.
 *
 * Query parameters:
 * - q: Search query (required, non-empty)
 * - limit: Maximum results (optional, defaults to search index default)
 *
 * Response:
 * - 200: { results: FileSearchResult[], totalMatches: number, searchTimeMs: number }
 * - 400: { error: { code: "VALIDATION_ERROR", message: string } }
 */
searchRoutes.get("/files", async (c) => {
  const vault = getVaultFromContext(c);
  const query = c.req.query("q");
  const limitParam = c.req.query("limit");

  // Validate query parameter
  if (!query || query.trim() === "") {
    return jsonError(c, 400, "VALIDATION_ERROR", "Query parameter 'q' is required");
  }

  // Parse optional limit
  let limit: number | undefined;
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1) {
      return jsonError(c, 400, "VALIDATION_ERROR", "Invalid limit parameter. Must be a positive integer.");
    }
    limit = parsed;
  }

  const result = await searchFilesRest(vault.id, vault.path, query, limit);

  return c.json({
    results: result.results,
    totalMatches: result.totalMatches,
    searchTimeMs: result.searchTimeMs,
  });
});

/**
 * GET /content?q=&limit=
 *
 * Search file contents using full-text search.
 *
 * Query parameters:
 * - q: Search query (required, non-empty)
 * - limit: Maximum results (optional, defaults to search index default)
 *
 * Response:
 * - 200: { results: ContentSearchResult[], totalMatches: number, searchTimeMs: number }
 * - 400: { error: { code: "VALIDATION_ERROR", message: string } }
 */
searchRoutes.get("/content", async (c) => {
  const vault = getVaultFromContext(c);
  const query = c.req.query("q");
  const limitParam = c.req.query("limit");

  // Validate query parameter
  if (!query || query.trim() === "") {
    return jsonError(c, 400, "VALIDATION_ERROR", "Query parameter 'q' is required");
  }

  // Parse optional limit
  let limit: number | undefined;
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1) {
      return jsonError(c, 400, "VALIDATION_ERROR", "Invalid limit parameter. Must be a positive integer.");
    }
    limit = parsed;
  }

  const result = await searchContentRest(vault.id, vault.path, query, limit);

  return c.json({
    results: result.results,
    totalMatches: result.totalMatches,
    searchTimeMs: result.searchTimeMs,
  });
});

/**
 * GET /snippets?path=&q=
 *
 * Get context snippets for a file matching a query.
 *
 * Query parameters:
 * - path: Relative path to the file (required)
 * - q: Search query (required, non-empty)
 *
 * Response:
 * - 200: { path: string, snippets: ContextSnippet[] }
 * - 400: { error: { code: "VALIDATION_ERROR", message: string } }
 */
searchRoutes.get("/snippets", async (c) => {
  const vault = getVaultFromContext(c);
  const path = c.req.query("path");
  const query = c.req.query("q");

  // Validate path parameter
  if (!path || path.trim() === "") {
    return jsonError(c, 400, "VALIDATION_ERROR", "Query parameter 'path' is required");
  }

  // Validate query parameter
  if (!query || query.trim() === "") {
    return jsonError(c, 400, "VALIDATION_ERROR", "Query parameter 'q' is required");
  }

  const snippets = await getSnippetsRest(vault.id, vault.path, path, query);

  return c.json({
    path,
    snippets,
  });
});

export { searchRoutes };

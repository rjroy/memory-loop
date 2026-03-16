/**
 * Search API route handlers.
 *
 * Handles file name search, content search, and snippet retrieval.
 * Uses the search cache for per-vault index management.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getCachedVaultById } from "../vault";
import { getOrCreateIndex } from "../files/search/search-cache";

function jsonError(
  c: Context,
  error: string,
  code: string,
  status: ContentfulStatusCode,
): Response {
  return c.json({ error, code }, status);
}

/**
 * GET /vaults/:id/search/files - Fuzzy file name search.
 */
export async function searchFilesHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const query = c.req.query("q") ?? "";
  if (!query.trim()) {
    return c.json({ results: [], totalMatches: 0, searchTimeMs: 0 });
  }

  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  const startTime = Date.now();
  const index = getOrCreateIndex(vaultId, vault.contentRoot);
  const results = await index.searchFiles(query, { limit });
  const searchTimeMs = Date.now() - startTime;

  return c.json({
    results,
    totalMatches: results.length,
    searchTimeMs,
  });
}

/**
 * GET /vaults/:id/search/content - Full-text content search.
 */
export async function searchContentHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const query = c.req.query("q") ?? "";
  if (!query.trim()) {
    return c.json({ results: [], totalMatches: 0, searchTimeMs: 0 });
  }

  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  const startTime = Date.now();
  const index = getOrCreateIndex(vaultId, vault.contentRoot);
  const results = await index.searchContent(query, { limit });
  const searchTimeMs = Date.now() - startTime;

  return c.json({
    results,
    totalMatches: results.length,
    searchTimeMs,
  });
}

/**
 * GET /vaults/:id/search/snippets - Get context snippets for a file.
 */
export async function getSnippetsHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const path = c.req.query("path") ?? "";
  const query = c.req.query("q") ?? "";

  if (!path || !query) {
    return jsonError(c, "Missing required query params: path, q", "INVALID_REQUEST", 400);
  }

  const index = getOrCreateIndex(vaultId, vault.contentRoot);
  const snippets = await index.getSnippets(path, query);

  return c.json({ snippets });
}

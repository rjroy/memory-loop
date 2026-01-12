/**
 * Search Handlers
 *
 * Handles search operations within the selected vault:
 * - search_files: Fuzzy file name search
 * - search_content: Full-text content search
 * - get_snippets: Context snippets for a file matching a query
 */

import type { HandlerContext } from "./types.js";
import { requireVault } from "./types.js";
import { wsLog as log } from "../logger.js";

/**
 * Checks if search index is available and sends error if not.
 * Returns true if search is ready, false otherwise.
 */
function requireSearch(ctx: HandlerContext, operation: string): boolean {
  if (!requireVault(ctx)) {
    log.warn(`No vault selected for ${operation}`);
    return false;
  }

  if (!ctx.state.searchIndex) {
    log.warn(`Search index not initialized for ${operation}`);
    ctx.sendError("VAULT_NOT_FOUND", "No vault selected. Send select_vault first.");
    return false;
  }

  return true;
}

/**
 * Handles search_files message.
 * Searches for files by name using fuzzy matching.
 */
export async function handleSearchFiles(
  ctx: HandlerContext,
  query: string,
  limit?: number
): Promise<void> {
  log.info(`Searching files: "${query}" (limit: ${limit ?? "default"})`);

  if (!requireSearch(ctx, "file search")) {
    return;
  }

  try {
    const startTime = Date.now();
    const results = await ctx.state.searchIndex!.searchFiles(query, { limit });
    const searchTimeMs = Date.now() - startTime;

    log.info(`File search complete: ${results.length} results in ${searchTimeMs}ms`);

    ctx.send({
      type: "search_results",
      mode: "files",
      query,
      results,
      totalMatches: results.length,
      searchTimeMs,
    });
  } catch (error) {
    log.error("File search failed", error);
    const message =
      error instanceof Error ? error.message : "Failed to search files";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles search_content message.
 * Searches file contents using full-text search.
 */
export async function handleSearchContent(
  ctx: HandlerContext,
  query: string,
  limit?: number
): Promise<void> {
  log.info(`Searching content: "${query}" (limit: ${limit ?? "default"})`);

  if (!requireSearch(ctx, "content search")) {
    return;
  }

  try {
    const startTime = Date.now();
    const results = await ctx.state.searchIndex!.searchContent(query, { limit });
    const searchTimeMs = Date.now() - startTime;

    log.info(`Content search complete: ${results.length} results in ${searchTimeMs}ms`);

    ctx.send({
      type: "search_results",
      mode: "content",
      query,
      results,
      totalMatches: results.length,
      searchTimeMs,
    });
  } catch (error) {
    log.error("Content search failed", error);
    const message =
      error instanceof Error ? error.message : "Failed to search content";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles get_snippets message.
 * Returns context snippets for a specific file matching a query.
 */
export async function handleGetSnippets(
  ctx: HandlerContext,
  path: string,
  query: string
): Promise<void> {
  log.info(`Getting snippets: "${path}" for query "${query}"`);

  if (!requireSearch(ctx, "get snippets")) {
    return;
  }

  try {
    const snippets = await ctx.state.searchIndex!.getSnippets(path, query);

    log.info(`Got ${snippets.length} snippets for ${path}`);

    ctx.send({
      type: "snippets",
      path,
      snippets,
    });
  } catch (error) {
    log.error("Get snippets failed", error);
    const message =
      error instanceof Error ? error.message : "Failed to get snippets";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

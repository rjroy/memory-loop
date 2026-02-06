/**
 * Content Search API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/search/content - Search file contents
 */

import { NextRequest, NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { searchContentRest } from "@/lib/handlers";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/search/content
 *
 * Search file contents using full-text search.
 *
 * Query parameters:
 * - q: Search query (required, non-empty)
 * - limit: Maximum results (optional)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const query = request.nextUrl.searchParams.get("q");
  const limitParam = request.nextUrl.searchParams.get("limit");

  // Validate query parameter
  if (!query || query.trim() === "") {
    return jsonError("VALIDATION_ERROR", "Query parameter 'q' is required");
  }

  // Parse optional limit
  let limit: number | undefined;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1) {
      return jsonError("VALIDATION_ERROR", "Invalid limit parameter. Must be a positive integer.");
    }
    limit = parsed;
  }

  const result = await searchContentRest(vault.id, vault.contentRoot, query, limit);

  return NextResponse.json({
    results: result.results,
    totalMatches: result.totalMatches,
    searchTimeMs: result.searchTimeMs,
  });
}

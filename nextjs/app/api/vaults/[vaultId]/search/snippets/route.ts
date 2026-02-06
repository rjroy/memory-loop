/**
 * Search Snippets API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/search/snippets - Get context snippets for a file
 */

import { NextRequest, NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { getSnippetsRest } from "@/lib/handlers";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/search/snippets
 *
 * Get context snippets for a file matching a query.
 *
 * Query parameters:
 * - path: Relative path to the file (required)
 * - q: Search query (required, non-empty)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const path = request.nextUrl.searchParams.get("path");
  const query = request.nextUrl.searchParams.get("q");

  // Validate path parameter
  if (!path || path.trim() === "") {
    return jsonError("VALIDATION_ERROR", "Query parameter 'path' is required");
  }

  // Validate query parameter
  if (!query || query.trim() === "") {
    return jsonError("VALIDATION_ERROR", "Query parameter 'q' is required");
  }

  const snippets = await getSnippetsRest(vault.id, vault.path, path, query);

  return NextResponse.json({
    path,
    snippets,
  });
}

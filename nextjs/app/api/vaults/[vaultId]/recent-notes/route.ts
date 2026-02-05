/**
 * Recent Notes API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/recent-notes - Get recent captured notes
 */

import { NextRequest, NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { getRecentNotes } from "@memory-loop/backend/note-capture";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/recent-notes
 *
 * Returns recent captured notes from the vault inbox.
 * Query params: limit (optional, default 5)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  // Parse optional limit query param
  const limitParam = request.nextUrl.searchParams.get("limit");
  let limit = 5;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 100) {
      return jsonError("VALIDATION_ERROR", "limit must be a number between 1 and 100");
    }
    limit = parsed;
  }

  try {
    const notes = await getRecentNotes(vault, limit);
    return NextResponse.json({ notes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get recent notes";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

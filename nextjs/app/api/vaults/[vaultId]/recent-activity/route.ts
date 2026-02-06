/**
 * Recent Activity API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/recent-activity - Get combined recent activity
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { getRecentNotes } from "@memory-loop/backend/note-capture";
import { getRecentSessions } from "@memory-loop/backend/session-manager";
import {
  loadVaultConfig,
  resolveRecentCaptures,
  resolveRecentDiscussions,
} from "@memory-loop/backend/vault-config";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/recent-activity
 *
 * Returns combined recent activity: captures and discussions.
 * Uses vault config for limit settings.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  try {
    // Load vault config for limit settings
    const config = await loadVaultConfig(vault.path);
    const capturesLimit = resolveRecentCaptures(config);
    const discussionsLimit = resolveRecentDiscussions(config);

    // Fetch captures and discussions in parallel
    const [captures, discussions] = await Promise.all([
      getRecentNotes(vault, capturesLimit),
      getRecentSessions(vault.path, discussionsLimit),
    ]);

    return NextResponse.json({ captures, discussions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get recent activity";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

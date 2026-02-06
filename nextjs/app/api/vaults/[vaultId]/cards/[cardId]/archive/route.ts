/**
 * Card Archive API Route (Vault-Scoped)
 *
 * POST /api/vaults/:vaultId/cards/:cardId/archive - Archive a card
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { archiveCard } from "@/lib/spaced-repetition";

interface RouteParams {
  params: Promise<{ vaultId: string; cardId: string }>;
}

/**
 * POST /api/vaults/:vaultId/cards/:cardId/archive
 *
 * Archives a card, removing it from the review queue.
 * Archived cards are moved to the archive directory.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { vaultId, cardId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  // Validate card ID format
  if (!cardId || !/^[a-f0-9-]{36}$/i.test(cardId)) {
    return jsonError("VALIDATION_ERROR", "Invalid card ID format. Must be a UUID.");
  }

  try {
    const archived = await archiveCard(vault, cardId);

    if (!archived) {
      return jsonError("FILE_NOT_FOUND", `Card not found: ${cardId}`, 404);
    }

    return NextResponse.json({
      id: cardId,
      archived: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive card";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

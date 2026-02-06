/**
 * Due Cards API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/cards/due - Get cards due for review
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { getDueCards } from "@/lib/spaced-repetition";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/cards/due
 *
 * Returns all cards that are due for review today or earlier.
 * Cards are returned with question preview only (no answers).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  try {
    const cards = await getDueCards(vault);

    const previews = cards.map((card) => ({
      id: card.metadata.id,
      question: card.content.question,
      next_review: card.metadata.next_review,
      card_file: `${vault.metadataPath}/cards/${card.metadata.id}.md`,
    }));

    return NextResponse.json({
      cards: previews,
      count: previews.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get due cards";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

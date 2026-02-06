/**
 * Card Detail API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/cards/:cardId - Get full card details
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { getCard } from "@memory-loop/backend/spaced-repetition";

interface RouteParams {
  params: Promise<{ vaultId: string; cardId: string }>;
}

/**
 * GET /api/vaults/:vaultId/cards/:cardId
 *
 * Returns full card details including the answer.
 * Used after revealing the answer during review.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId, cardId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  // Validate card ID format (should be UUID)
  if (!cardId || !/^[a-f0-9-]{36}$/i.test(cardId)) {
    return jsonError("VALIDATION_ERROR", "Invalid card ID format. Must be a UUID.");
  }

  try {
    const result = await getCard(vault, cardId);

    if (!result.success) {
      return jsonError("FILE_NOT_FOUND", result.error, 404);
    }

    const card = result.data;
    return NextResponse.json({
      id: card.metadata.id,
      question: card.content.question,
      answer: card.content.answer,
      ease_factor: card.metadata.ease_factor,
      interval: card.metadata.interval,
      repetitions: card.metadata.repetitions,
      last_reviewed: card.metadata.last_reviewed,
      next_review: card.metadata.next_review,
      source_file: card.metadata.source_file,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get card";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

/**
 * Card Review API Route (Vault-Scoped)
 *
 * POST /api/vaults/:vaultId/cards/:cardId/review - Submit review response
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { submitReview, isValidResponse } from "@/lib/spaced-repetition";

interface RouteParams {
  params: Promise<{ vaultId: string; cardId: string }>;
}

const ReviewSchema = z.object({
  response: z.string(),
});

/**
 * POST /api/vaults/:vaultId/cards/:cardId/review
 *
 * Submits a review response for a card and updates its schedule.
 * Valid responses: "again", "hard", "good", "easy"
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId, cardId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  // Validate card ID format
  if (!cardId || !/^[a-f0-9-]{36}$/i.test(cardId)) {
    return jsonError("VALIDATION_ERROR", "Invalid card ID format. Must be a UUID.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "Invalid JSON body");
  }

  const parseResult = ReviewSchema.safeParse(body);
  if (!parseResult.success) {
    return jsonError("VALIDATION_ERROR", "response is required and must be a string");
  }

  const rawResponse = parseResult.data.response;
  if (!isValidResponse(rawResponse)) {
    return jsonError(
      "VALIDATION_ERROR",
      `Invalid response value: "${rawResponse}". Must be one of: again, hard, good, easy`
    );
  }

  try {
    const result = await submitReview(vault, cardId, rawResponse);

    if (!result.success) {
      // Check if this is a "not found" error
      if (result.error.includes("not found") || result.error.includes("Not found")) {
        return jsonError("FILE_NOT_FOUND", result.error, 404);
      }
      return jsonError("VALIDATION_ERROR", result.error);
    }

    const card = result.data;
    return NextResponse.json({
      id: card.metadata.id,
      next_review: card.metadata.next_review,
      interval: card.metadata.interval,
      ease_factor: card.metadata.ease_factor,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit review";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

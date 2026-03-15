/**
 * Card routes (vault-scoped).
 *
 * Daemon endpoints for spaced repetition card operations:
 * due cards, card detail, review submission, and archival.
 */

import type { Context } from "hono";
import { getCachedVaultById } from "../vault";
import {
  getDueCards,
  getCard,
  submitReview,
  archiveCard,
  isValidResponse,
} from "../spaced-repetition";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(c: Context, code: string, message: string, status: 400 | 404 | 500 = 400) {
  return c.json({ error: { code, message } }, status);
}

async function getVaultOrError(c: Context) {
  const vaultId = c.req.param("id");
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return { error: jsonError(c, "VAULT_NOT_FOUND", `Vault not found: ${vaultId}`, 404) };
  }
  return { vault };
}

const UUID_RE = /^[a-f0-9-]{36}$/i;

function validateCardId(c: Context): string | Response {
  const cardId = c.req.param("cardId");
  if (!cardId || !UUID_RE.test(cardId)) {
    return jsonError(c, "VALIDATION_ERROR", "Invalid card ID format. Must be a UUID.");
  }
  return cardId;
}

// ---------------------------------------------------------------------------
// GET /vaults/:id/cards/due
// ---------------------------------------------------------------------------

export async function dueCardsHandler(c: Context): Promise<Response> {
  const result = await getVaultOrError(c);
  if ("error" in result) return result.error;

  try {
    const cards = await getDueCards(result.vault);

    const previews = cards.map((card) => ({
      id: card.metadata.id,
      question: card.content.question,
      next_review: card.metadata.next_review,
      card_file: `${result.vault.metadataPath}/cards/${card.metadata.id}.md`,
    }));

    return c.json({ cards: previews, count: previews.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get due cards";
    return jsonError(c, "INTERNAL_ERROR", message, 500);
  }
}

// ---------------------------------------------------------------------------
// GET /vaults/:id/cards/:cardId
// ---------------------------------------------------------------------------

export async function cardDetailHandler(c: Context): Promise<Response> {
  const vaultResult = await getVaultOrError(c);
  if ("error" in vaultResult) return vaultResult.error;

  const cardId = validateCardId(c);
  if (cardId instanceof Response) return cardId;

  try {
    const result = await getCard(vaultResult.vault, cardId);

    if (!result.success) {
      return jsonError(c, "FILE_NOT_FOUND", result.error, 404);
    }

    const card = result.data;
    return c.json({
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
    return jsonError(c, "INTERNAL_ERROR", message, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /vaults/:id/cards/:cardId/review
// ---------------------------------------------------------------------------

export async function cardReviewHandler(c: Context): Promise<Response> {
  const vaultResult = await getVaultOrError(c);
  if ("error" in vaultResult) return vaultResult.error;

  const cardId = validateCardId(c);
  if (cardId instanceof Response) return cardId;

  let body: { response?: string };
  try {
    body = await c.req.json() as { response?: string };
  } catch {
    return jsonError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  if (typeof body.response !== "string") {
    return jsonError(c, "VALIDATION_ERROR", "response is required and must be a string");
  }

  if (!isValidResponse(body.response)) {
    return jsonError(
      c,
      "VALIDATION_ERROR",
      `Invalid response value: "${body.response}". Must be one of: again, hard, good, easy`,
    );
  }

  try {
    const result = await submitReview(vaultResult.vault, cardId, body.response);

    if (!result.success) {
      if (result.error.includes("not found") || result.error.includes("Not found")) {
        return jsonError(c, "FILE_NOT_FOUND", result.error, 404);
      }
      return jsonError(c, "VALIDATION_ERROR", result.error);
    }

    const card = result.data;
    return c.json({
      id: card.metadata.id,
      next_review: card.metadata.next_review,
      interval: card.metadata.interval,
      ease_factor: card.metadata.ease_factor,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit review";
    return jsonError(c, "INTERNAL_ERROR", message, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /vaults/:id/cards/:cardId/archive
// ---------------------------------------------------------------------------

export async function cardArchiveHandler(c: Context): Promise<Response> {
  const vaultResult = await getVaultOrError(c);
  if ("error" in vaultResult) return vaultResult.error;

  const cardId = validateCardId(c);
  if (cardId instanceof Response) return cardId;

  try {
    const archived = await archiveCard(vaultResult.vault, cardId);

    if (!archived) {
      return jsonError(c, "FILE_NOT_FOUND", `Card not found: ${cardId}`, 404);
    }

    return c.json({ id: cardId, archived: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive card";
    return jsonError(c, "INTERNAL_ERROR", message, 500);
  }
}

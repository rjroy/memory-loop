/**
 * Spaced Repetition Card Routes
 *
 * REST endpoints for spaced repetition card operations:
 * - GET /cards/due - Get cards due for review
 * - GET /cards/:cardId - Get full card details
 * - POST /cards/:cardId/review - Submit review response
 * - POST /cards/:cardId/archive - Archive a card
 *
 * All routes are under /api/vaults/:vaultId/ (vault middleware applied).
 *
 * Spec Requirements:
 * - REQ-F-17: Display question, allow reveal answer
 * - REQ-F-19: "Archive" action removes card from review queue
 * - REQ-F-26: SM-2 scheduling for cards
 */

import { Hono } from "hono";
import { getVaultFromContext, jsonError } from "../middleware/vault-resolution";
import {
  getDueCards,
  getCard,
  submitReview,
  archiveCard,
} from "../spaced-repetition/card-manager.js";
import { isValidResponse, type ReviewResponse } from "../spaced-repetition/sm2-algorithm.js";
import { createLogger } from "../logger";

const log = createLogger("CardRoutes");

// =============================================================================
// Response Types
// =============================================================================

/**
 * Preview of a due card (question only, no answer).
 */
interface DueCardPreview {
  id: string;
  question: string;
  next_review: string;
  card_file: string;
}

/**
 * Response type for GET /cards/due endpoint.
 */
interface DueCardsResponse {
  cards: DueCardPreview[];
  count: number;
}

/**
 * Full card detail with answer (after reveal).
 */
interface CardDetailResponse {
  id: string;
  question: string;
  answer: string;
  ease_factor: number;
  interval: number;
  repetitions: number;
  last_reviewed: string | null;
  next_review: string;
  source_file?: string;
}

/**
 * Response type for POST /cards/:cardId/review endpoint.
 */
interface ReviewResultResponse {
  id: string;
  next_review: string;
  interval: number;
  ease_factor: number;
}

/**
 * Request body for POST /cards/:cardId/review endpoint.
 */
interface ReviewRequest {
  response: ReviewResponse;
}

/**
 * Response type for POST /cards/:cardId/archive endpoint.
 */
interface ArchiveResponse {
  id: string;
  archived: boolean;
}

// =============================================================================
// Routes
// =============================================================================

const cardRoutes = new Hono();

/**
 * GET /cards/due
 *
 * Returns all cards that are due for review today or earlier.
 * Cards are returned with question preview only (no answers).
 */
cardRoutes.get("/due", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`Getting due cards for vault: ${vault.id}`);

  try {
    const cards = await getDueCards(vault);
    log.info(`Found ${cards.length} due cards`);

    const previews: DueCardPreview[] = cards.map((card) => ({
      id: card.metadata.id,
      question: card.content.question,
      next_review: card.metadata.next_review,
      card_file: `${vault.metadataPath}/cards/${card.metadata.id}.md`,
    }));

    const response: DueCardsResponse = {
      cards: previews,
      count: previews.length,
    };

    return c.json(response);
  } catch (error) {
    log.error("Failed to get due cards", error);
    const message = error instanceof Error ? error.message : "Failed to get due cards";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * GET /cards/:cardId
 *
 * Returns full card details including the answer.
 * Used after revealing the answer during review.
 */
cardRoutes.get("/:cardId", async (c) => {
  const vault = getVaultFromContext(c);
  const cardId = c.req.param("cardId");

  log.info(`Getting card ${cardId} for vault: ${vault.id}`);

  // Validate card ID format (should be UUID)
  if (!cardId || !/^[a-f0-9-]{36}$/i.test(cardId)) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid card ID format. Must be a UUID.");
  }

  try {
    const result = await getCard(vault, cardId);

    if (!result.success) {
      log.warn(`Card not found: ${cardId}`);
      return jsonError(c, 404, "FILE_NOT_FOUND", result.error);
    }

    const card = result.data;
    const response: CardDetailResponse = {
      id: card.metadata.id,
      question: card.content.question,
      answer: card.content.answer,
      ease_factor: card.metadata.ease_factor,
      interval: card.metadata.interval,
      repetitions: card.metadata.repetitions,
      last_reviewed: card.metadata.last_reviewed,
      next_review: card.metadata.next_review,
      source_file: card.metadata.source_file,
    };

    return c.json(response);
  } catch (error) {
    log.error(`Failed to get card ${cardId}`, error);
    const message = error instanceof Error ? error.message : "Failed to get card";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * POST /cards/:cardId/review
 *
 * Submits a review response for a card and updates its schedule.
 * Valid responses: "again", "hard", "good", "easy"
 */
cardRoutes.post("/:cardId/review", async (c) => {
  const vault = getVaultFromContext(c);
  const cardId = c.req.param("cardId");

  // Validate card ID format
  if (!cardId || !/^[a-f0-9-]{36}$/i.test(cardId)) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid card ID format. Must be a UUID.");
  }

  // Parse request body
  let body: ReviewRequest;
  try {
    body = await c.req.json<ReviewRequest>();
  } catch {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid JSON body");
  }

  // Validate response field
  if (!body.response || typeof body.response !== "string") {
    return jsonError(c, 400, "VALIDATION_ERROR", "response is required and must be a string");
  }

  // Store raw value for error messages before type guard narrows
  const rawResponse = body.response;
  if (!isValidResponse(rawResponse)) {
    return jsonError(
      c,
      400,
      "VALIDATION_ERROR",
      `Invalid response value: "${String(rawResponse)}". Must be one of: again, hard, good, easy`
    );
  }

  // After type guard, rawResponse is narrowed to ReviewResponse
  log.info(`Submitting review for card ${cardId}: response=${rawResponse}`);

  try {
    const result = await submitReview(vault, cardId, rawResponse);

    if (!result.success) {
      // Check if this is a "not found" error
      if (result.error.includes("not found") || result.error.includes("Not found")) {
        return jsonError(c, 404, "FILE_NOT_FOUND", result.error);
      }
      return jsonError(c, 400, "VALIDATION_ERROR", result.error);
    }

    const card = result.data;
    const response: ReviewResultResponse = {
      id: card.metadata.id,
      next_review: card.metadata.next_review,
      interval: card.metadata.interval,
      ease_factor: card.metadata.ease_factor,
    };

    log.info(
      `Card ${cardId} reviewed: next_review=${response.next_review}, interval=${response.interval}`
    );

    return c.json(response);
  } catch (error) {
    log.error(`Failed to submit review for card ${cardId}`, error);
    const message = error instanceof Error ? error.message : "Failed to submit review";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * POST /cards/:cardId/archive
 *
 * Archives a card, removing it from the review queue.
 * Archived cards are moved to the archive directory.
 */
cardRoutes.post("/:cardId/archive", async (c) => {
  const vault = getVaultFromContext(c);
  const cardId = c.req.param("cardId");

  // Validate card ID format
  if (!cardId || !/^[a-f0-9-]{36}$/i.test(cardId)) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid card ID format. Must be a UUID.");
  }

  log.info(`Archiving card ${cardId} for vault: ${vault.id}`);

  try {
    const archived = await archiveCard(vault, cardId);

    if (!archived) {
      return jsonError(c, 404, "FILE_NOT_FOUND", `Card not found: ${cardId}`);
    }

    const response: ArchiveResponse = {
      id: cardId,
      archived: true,
    };

    log.info(`Card ${cardId} archived successfully`);

    return c.json(response);
  } catch (error) {
    log.error(`Failed to archive card ${cardId}`, error);
    const message = error instanceof Error ? error.message : "Failed to archive card";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

export { cardRoutes };

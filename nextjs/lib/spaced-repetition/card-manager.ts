/**
 * Card Manager
 *
 * High-level CRUD operations for spaced repetition cards.
 * Coordinates card-storage, card-schema, and sm2-algorithm modules.
 *
 * Spec Requirements:
 * - REQ-F-17: Display question, allow reveal answer
 * - REQ-F-19: "Archive" action removes card from review queue
 * - REQ-F-21: Archived cards move to cards/archive/
 * - REQ-F-26: SM-2 scheduling for cards
 *
 * Plan Reference:
 * - CardManager (TASK-003): CRUD operations for card files, SM-2 calculations
 */

import { randomUUID } from "node:crypto";
import {
  loadDueCards,
  loadCard,
  saveCard,
  archiveCard as archiveCardFile,
  type VaultPathInfo,
} from "./card-storage";
import {
  type Card,
  type QACardContent,
  createNewCardMetadata,
  getToday,
} from "./card-schema";
import {
  calculateSM2,
  type ReviewResponse,
  type CardState,
  isValidResponse,
} from "./sm2-algorithm";
import { createLogger } from "../logger";

const log = createLogger("card-manager");

// =============================================================================
// Result Types
// =============================================================================

/** Result type for operations that can fail */
export type Result<T> = { success: true; data: T } | { success: false; error: string };

// =============================================================================
// Card Manager
// =============================================================================

/**
 * Get all cards due for review.
 *
 * @param vault - Vault path information
 * @param today - Today's date in YYYY-MM-DD format (defaults to actual today)
 * @returns Array of cards due for review, sorted by next_review ascending
 */
export async function getDueCards(
  vault: VaultPathInfo,
  today: string = getToday()
): Promise<Card[]> {
  log.debug(`Getting due cards for vault: ${vault.contentRoot}`);
  return loadDueCards(vault, today);
}

/**
 * Get a single card by ID.
 *
 * @param vault - Vault path information
 * @param cardId - UUID of the card
 * @returns Card if found, or error result
 */
export async function getCard(
  vault: VaultPathInfo,
  cardId: string
): Promise<Result<Card>> {
  log.debug(`Loading card ${cardId}`);
  const result = await loadCard(vault, cardId);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, data: result.card };
}

/**
 * Submit a review response for a card.
 * Applies SM-2 algorithm and updates card metadata.
 *
 * @param vault - Vault path information
 * @param cardId - UUID of the card
 * @param response - User's review response (again, hard, good, easy)
 * @param today - Today's date in YYYY-MM-DD format (defaults to actual today)
 * @returns Updated card if successful, or error result
 */
export async function submitReview(
  vault: VaultPathInfo,
  cardId: string,
  response: string,
  today: string = getToday()
): Promise<Result<Card>> {
  // Validate response
  if (!isValidResponse(response)) {
    return {
      success: false,
      error: `Invalid review response: ${response}. Must be one of: again, hard, good, easy`,
    };
  }

  // Load the card
  const loadResult = await loadCard(vault, cardId);
  if (!loadResult.success) {
    return { success: false, error: loadResult.error };
  }

  const card = loadResult.card;
  log.debug(
    `Submitting review for card ${cardId}: response=${response}, current_interval=${card.metadata.interval}`
  );

  // Extract current state for SM-2
  const state: CardState = {
    interval: card.metadata.interval,
    ease_factor: card.metadata.ease_factor,
    repetitions: card.metadata.repetitions,
  };

  // Calculate new values
  const sm2Result = calculateSM2(state, response, today);

  // Update card metadata
  const updatedCard: Card = {
    ...card,
    metadata: {
      ...card.metadata,
      interval: sm2Result.interval,
      ease_factor: sm2Result.ease_factor,
      repetitions: sm2Result.repetitions,
      next_review: sm2Result.next_review,
      last_reviewed: today,
    },
  };

  // Save the updated card
  try {
    await saveCard(vault, updatedCard);
    log.info(
      `Card ${cardId} reviewed: ${response} -> next_review=${sm2Result.next_review}, interval=${sm2Result.interval}`
    );
    return { success: true, data: updatedCard };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(`Failed to save card ${cardId} after review: ${message}`);
    return { success: false, error: `Failed to save card: ${message}` };
  }
}

/**
 * Archive a card (remove from review queue).
 * The card is moved to the archive directory and retains all metadata.
 *
 * @param vault - Vault path information
 * @param cardId - UUID of the card to archive
 * @returns true if archived, false if card not found
 */
export async function archiveCard(
  vault: VaultPathInfo,
  cardId: string
): Promise<boolean> {
  log.debug(`Archiving card ${cardId}`);
  return archiveCardFile(vault, cardId);
}

/**
 * Input data for creating a new card.
 */
export interface CreateCardInput {
  /** Question text (required) */
  question: string;
  /** Answer text (required) */
  answer: string;
  /** Optional source file path */
  sourceFile?: string;
}

/**
 * Create a new card.
 *
 * Generates a UUID for the card and initializes SM-2 metadata with defaults:
 * - interval: 0
 * - repetitions: 0
 * - ease_factor: 2.5
 * - next_review: today
 *
 * @param vault - Vault path information
 * @param input - Card content (question, answer, optional sourceFile)
 * @param today - Today's date in YYYY-MM-DD format (defaults to actual today)
 * @returns Created card if successful, or error result
 */
export async function createCard(
  vault: VaultPathInfo,
  input: CreateCardInput,
  today: string = getToday()
): Promise<Result<Card>> {
  // Validate input
  if (!input.question || input.question.trim().length === 0) {
    return { success: false, error: "Question is required" };
  }
  if (!input.answer || input.answer.trim().length === 0) {
    return { success: false, error: "Answer is required" };
  }

  // Generate UUID for new card
  const cardId = randomUUID();

  // Create metadata with SM-2 defaults
  const metadata = createNewCardMetadata(cardId, today, input.sourceFile);

  // Create card content
  const content: QACardContent = {
    question: input.question.trim(),
    answer: input.answer.trim(),
  };

  const card: Card = { metadata, content };

  // Save the card
  try {
    await saveCard(vault, card);
    log.info(`Created new card ${cardId}: "${input.question.slice(0, 50)}..."`);
    return { success: true, data: card };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(`Failed to create card: ${message}`);
    return { success: false, error: `Failed to create card: ${message}` };
  }
}

// =============================================================================
// Exports
// =============================================================================

export type { VaultPathInfo, Card, ReviewResponse };

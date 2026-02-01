/**
 * Card Deduplication
 *
 * Two-phase deduplication for spaced repetition cards:
 * 1. Jaccard similarity on question text (fast filtering)
 * 2. LLM verification for candidates above threshold
 *
 * Spec Requirements:
 * - REQ-1: Calculate Jaccard similarity on question text
 * - REQ-2: Remove stopwords before comparison
 * - REQ-3: Normalize text (lowercase, strip punctuation)
 * - REQ-4: Use 0.5 similarity threshold for candidates
 * - REQ-5: Self-deduplicate within new cards from same file
 * - REQ-6: LLM verification for semantic duplicates
 * - REQ-10: Archive older card when duplicate confirmed
 * - REQ-14: Fail open on LLM errors (safer to allow duplicates)
 *
 * Issue Reference: GitHub #440
 */

import type { Card } from "./card-schema.js";
import { archiveCard, type VaultPathInfo } from "./card-storage.js";
import { getSdkQuery, type QueryFunction } from "../sdk-provider.js";
import { createLogger } from "../logger.js";

const log = createLogger("card-dedup");

// =============================================================================
// Constants
// =============================================================================

/**
 * Common English stopwords to remove before comparison.
 * These words don't carry semantic meaning for duplicate detection.
 */
export const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "why",
  "how",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "about",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
]);

/**
 * Jaccard similarity threshold for LLM verification.
 * Cards above this threshold are sent to LLM for semantic verification.
 */
export const JACCARD_THRESHOLD = 0.5;

/**
 * Model to use for duplicate verification.
 * Using same model as card generation for consistency.
 */
const VERIFICATION_MODEL = "haiku";

// =============================================================================
// Types
// =============================================================================

/**
 * Context for deduplication during a discovery pass.
 * Holds existing cards and accumulates new cards for self-dedup.
 */
export interface DedupContext {
  /** All existing cards across vaults being processed */
  existingCards: Card[];
  /** New cards created during this pass (for self-dedup) */
  newCards: Card[];
  /** Vault path info for archiving operations */
  vaultPathInfo: VaultPathInfo;
}

/**
 * Statistics for deduplication operations.
 */
export interface DedupStats {
  /** Number of duplicate candidates found (above threshold) */
  duplicatesDetected: number;
  /** Number of duplicates confirmed and archived */
  duplicatesArchived: number;
}

/**
 * Result of a dedup check.
 */
export interface DedupCheckResult {
  /** Whether this card is a duplicate */
  isDuplicate: boolean;
  /** If duplicate, the card it duplicates */
  duplicateOf?: Card;
}

/**
 * Candidate pair for LLM verification.
 */
interface DuplicateCandidate {
  /** The existing or previously created card */
  existingCard: Card;
  /** Jaccard similarity score */
  similarity: number;
}

// =============================================================================
// Text Processing
// =============================================================================

/**
 * Tokenize text for Jaccard similarity comparison.
 *
 * Processing steps:
 * 1. Lowercase
 * 2. Remove punctuation
 * 3. Split on whitespace
 * 4. Remove stopwords
 *
 * @param text - Input text to tokenize
 * @returns Set of content words
 */
export function tokenize(text: string): Set<string> {
  // Lowercase and remove punctuation (keep only letters, numbers, spaces)
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ");

  // Split on whitespace and filter
  const words = normalized.split(/\s+/).filter((word) => {
    // Remove empty strings and stopwords
    return word.length > 0 && !STOPWORDS.has(word);
  });

  return new Set(words);
}

/**
 * Calculate Jaccard similarity between two token sets.
 *
 * Jaccard index = |A ∩ B| / |A ∪ B|
 *
 * @param a - First token set
 * @param b - Second token set
 * @returns Similarity score between 0 and 1
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  // Handle empty sets
  if (a.size === 0 && b.size === 0) {
    return 1; // Two empty sets are identical
  }
  if (a.size === 0 || b.size === 0) {
    return 0; // One empty set means no overlap
  }

  // Calculate intersection size
  let intersectionSize = 0;
  for (const word of a) {
    if (b.has(word)) {
      intersectionSize++;
    }
  }

  // Calculate union size: |A| + |B| - |A ∩ B|
  const unionSize = a.size + b.size - intersectionSize;

  return intersectionSize / unionSize;
}

// =============================================================================
// Duplicate Detection
// =============================================================================

/**
 * Find existing cards that are potential duplicates of a question.
 *
 * Returns cards with Jaccard similarity >= threshold, sorted by similarity descending.
 *
 * @param question - New question to check
 * @param existingCards - Cards to check against
 * @param threshold - Minimum similarity to be considered a candidate
 * @returns Array of candidate cards with their similarity scores
 */
export function findDuplicateCandidates(
  question: string,
  existingCards: Card[],
  threshold: number = JACCARD_THRESHOLD
): DuplicateCandidate[] {
  const newTokens = tokenize(question);
  const candidates: DuplicateCandidate[] = [];

  for (const card of existingCards) {
    const existingTokens = tokenize(card.content.question);
    const similarity = jaccardSimilarity(newTokens, existingTokens);

    if (similarity >= threshold) {
      candidates.push({ existingCard: card, similarity });
    }
  }

  // Sort by similarity descending (most similar first)
  candidates.sort((a, b) => b.similarity - a.similarity);

  return candidates;
}

// =============================================================================
// LLM Verification
// =============================================================================

/**
 * Build prompt for LLM duplicate verification.
 */
function buildVerificationPrompt(newQuestion: string, existingQuestion: string): string {
  return `Do these two questions test the same knowledge? Answer only YES or NO.

Question 1: ${newQuestion}

Question 2: ${existingQuestion}

Answer (YES or NO):`;
}

/**
 * Collect response from SDK query result.
 */
async function collectResponse(queryResult: ReturnType<QueryFunction>): Promise<string> {
  const responseParts: string[] = [];

  for await (const event of queryResult) {
    const rawEvent = event as unknown as Record<string, unknown>;
    const eventType = rawEvent.type as string;

    if (eventType === "assistant") {
      const message = rawEvent.message as
        | { content?: Array<{ type: string; text?: string }> }
        | undefined;

      if (message?.content) {
        for (const block of message.content) {
          if (block.type === "text" && block.text) {
            responseParts.push(block.text);
          }
        }
      }
    }
  }

  return responseParts.join("");
}

/**
 * Verify if a candidate is a true duplicate using LLM.
 *
 * Fails open (returns false) on any error to avoid losing cards.
 *
 * @param newQuestion - The new question
 * @param candidate - The candidate duplicate
 * @returns true if confirmed duplicate, false otherwise
 */
export async function verifyDuplicateWithLLM(
  newQuestion: string,
  candidate: DuplicateCandidate
): Promise<boolean> {
  const prompt = buildVerificationPrompt(newQuestion, candidate.existingCard.content.question);

  try {
    const queryResult = getSdkQuery()({
      prompt,
      options: {
        model: VERIFICATION_MODEL,
        maxTurns: 1,
        allowedTools: [],
      },
    });

    const response = await collectResponse(queryResult);
    const answer = response.trim().toUpperCase();

    // Parse response - look for YES or NO
    if (answer.includes("YES")) {
      log.debug(
        `LLM confirmed duplicate: "${newQuestion.slice(0, 50)}..." duplicates "${candidate.existingCard.content.question.slice(0, 50)}..."`
      );
      return true;
    }

    log.debug(
      `LLM rejected duplicate: "${newQuestion.slice(0, 50)}..." vs "${candidate.existingCard.content.question.slice(0, 50)}..."`
    );
    return false;
  } catch (error) {
    // Fail open - if LLM fails, treat as non-duplicate (safer to allow duplicates than lose cards)
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`LLM verification failed (failing open): ${message}`);
    return false;
  }
}

/**
 * Verify candidates with LLM and return confirmed duplicates.
 *
 * Checks candidates in order of similarity until one is confirmed as duplicate.
 * Returns after first confirmed duplicate (no need to check more).
 *
 * @param newQuestion - The new question
 * @param candidates - Candidates sorted by similarity descending
 * @returns Object with duplicates array (empty if none, or single confirmed duplicate)
 */
export async function verifyDuplicatesWithLLM(
  newQuestion: string,
  candidates: DuplicateCandidate[]
): Promise<{ duplicates: Card[] }> {
  // Check each candidate in order of similarity
  for (const candidate of candidates) {
    const isDuplicate = await verifyDuplicateWithLLM(newQuestion, candidate);
    if (isDuplicate) {
      return { duplicates: [candidate.existingCard] };
    }
  }

  return { duplicates: [] };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Check if a new card is a duplicate and handle archiving if so.
 *
 * This is the main entry point for dedup during card creation.
 * Checks against both existing cards and newly created cards in this pass.
 *
 * @param question - Question text of the new card
 * @param answer - Answer text of the new card (for context)
 * @param context - Dedup context with existing and new cards
 * @param stats - Stats to update
 * @returns Result indicating if duplicate was found
 */
export async function checkAndHandleDuplicate(
  question: string,
  answer: string,
  context: DedupContext,
  stats: DedupStats
): Promise<DedupCheckResult> {
  // Combine existing cards and new cards for checking
  const allCards = [...context.existingCards, ...context.newCards];

  // Find candidates above threshold
  const candidates = findDuplicateCandidates(question, allCards);

  if (candidates.length === 0) {
    return { isDuplicate: false };
  }

  log.debug(
    `Found ${candidates.length} duplicate candidates for "${question.slice(0, 50)}..."`
  );
  stats.duplicatesDetected += candidates.length;

  // Verify with LLM
  const { duplicates } = await verifyDuplicatesWithLLM(question, candidates);

  if (duplicates.length === 0) {
    return { isDuplicate: false };
  }

  // Found a confirmed duplicate - archive the older one
  const duplicateCard = duplicates[0];

  // The new card is newer, so archive the existing duplicate
  const archived = await archiveCard(context.vaultPathInfo, duplicateCard.metadata.id);
  if (archived) {
    stats.duplicatesArchived++;
    log.info(
      `Archived duplicate card ${duplicateCard.metadata.id}: "${duplicateCard.content.question.slice(0, 50)}..."`
    );

    // Remove from context so it doesn't match future cards
    context.existingCards = context.existingCards.filter(
      (c) => c.metadata.id !== duplicateCard.metadata.id
    );
    context.newCards = context.newCards.filter(
      (c) => c.metadata.id !== duplicateCard.metadata.id
    );
  }

  // The new card should still be created (it replaces the duplicate)
  return { isDuplicate: false };
}

/**
 * Create an empty dedup context for a discovery pass.
 *
 * @param existingCards - Pre-loaded existing cards
 * @param vaultPathInfo - Vault path info for archiving
 * @returns Initialized dedup context
 */
export function createDedupContext(
  existingCards: Card[],
  vaultPathInfo: VaultPathInfo
): DedupContext {
  return {
    existingCards,
    newCards: [],
    vaultPathInfo,
  };
}

/**
 * Create empty dedup stats.
 */
export function createDedupStats(): DedupStats {
  return {
    duplicatesDetected: 0,
    duplicatesArchived: 0,
  };
}

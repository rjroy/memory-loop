/**
 * SM-2 Spaced Repetition Algorithm
 *
 * Pure functions for calculating next review parameters based on the SM-2 algorithm
 * (Piotr Wozniak, 1987). This implementation simplifies the original 0-5 quality
 * scale to four responses: again, hard, good, easy.
 *
 * Spec Requirements:
 * - REQ-F-26: Implement SM-2 spaced repetition algorithm for scheduling
 * - REQ-F-27: "again" response: reset interval to 1 day, decrease ease factor
 * - REQ-F-28: "hard" response: increase interval slightly, decrease ease factor slightly
 * - REQ-F-29: "good" response: increase interval by ease factor
 * - REQ-F-30: "easy" response: increase interval significantly, increase ease factor
 * - REQ-F-31: Default ease factor is 2.5 for new cards
 * - REQ-F-32: Minimum ease factor is 1.3
 * - REQ-F-34: New cards start with interval=0, repetitions=0, ease_factor=2.5
 *
 * Plan Reference:
 * - TD-4: SM-2 Algorithm Implementation as pure functions
 */

import { addDays } from "./card-schema";

// =============================================================================
// Constants
// =============================================================================

/** Default ease factor for new cards (REQ-F-31) */
export const DEFAULT_EASE_FACTOR = 2.5;

/** Minimum ease factor to prevent cards from becoming too difficult (REQ-F-32) */
export const MIN_EASE_FACTOR = 1.3;

/** Maximum ease factor to prevent intervals from growing too fast */
export const MAX_EASE_FACTOR = 3.0;

/**
 * Ease factor adjustments per response type.
 * Derived from SM-2 formula: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
 * where q is the quality response (0-5 scale mapped to our four responses)
 */
const EASE_ADJUSTMENTS = {
  /** again (q=1): EF decreases by ~0.20 */
  again: -0.2,
  /** hard (q=2): EF decreases by ~0.15 */
  hard: -0.15,
  /** good (q=3): EF unchanged */
  good: 0,
  /** easy (q=4): EF increases by ~0.15 */
  easy: 0.15,
} as const;

/**
 * Hard response interval multiplier.
 * When user says "hard", we increase interval but less than ease factor would.
 */
const HARD_INTERVAL_MULTIPLIER = 1.2;

/**
 * Easy response bonus multiplier.
 * When user says "easy", we multiply interval by ease factor * this bonus.
 */
const EASY_BONUS_MULTIPLIER = 1.3;

// =============================================================================
// Types
// =============================================================================

/** The four possible review responses (simplified from SM-2's 0-5 scale) */
export type ReviewResponse = "again" | "hard" | "good" | "easy";

/** Current card state needed for SM-2 calculation */
export interface CardState {
  /** Current interval in days (0 for new cards) */
  interval: number;
  /** Current ease factor (2.5 for new cards) */
  ease_factor: number;
  /** Number of successful reviews (0 for new cards) */
  repetitions: number;
}

/** Result of SM-2 calculation */
export interface SM2Result {
  /** New interval in days */
  interval: number;
  /** Updated ease factor */
  ease_factor: number;
  /** Updated repetition count */
  repetitions: number;
  /** Next review date in YYYY-MM-DD format */
  next_review: string;
}

// =============================================================================
// Core Algorithm
// =============================================================================

/**
 * Calculate new SM-2 parameters based on review response.
 *
 * The algorithm follows these rules:
 * - "again": Reset to learning phase (interval=1, repetitions=0), decrease EF
 * - "hard": Small interval increase, slight EF decrease
 * - "good": Standard interval increase (interval * EF), EF unchanged
 * - "easy": Large interval increase (interval * EF * bonus), EF increases
 *
 * @param state - Current card state
 * @param response - User's review response
 * @param today - Today's date in YYYY-MM-DD format (for testing)
 * @returns Updated card parameters including next_review date
 */
export function calculateSM2(
  state: CardState,
  response: ReviewResponse,
  today: string
): SM2Result {
  // Calculate new ease factor first (applies to all responses)
  const newEaseFactor = clampEaseFactor(
    state.ease_factor + EASE_ADJUSTMENTS[response]
  );

  // Calculate new interval and repetitions based on response
  const { interval, repetitions } = calculateIntervalAndReps(
    state,
    response,
    newEaseFactor
  );

  // Calculate next review date
  const next_review = addDays(today, interval);

  return {
    interval,
    ease_factor: newEaseFactor,
    repetitions,
    next_review,
  };
}

/**
 * Calculate new interval and repetition count based on response.
 */
function calculateIntervalAndReps(
  state: CardState,
  response: ReviewResponse,
  newEaseFactor: number
): { interval: number; repetitions: number } {
  switch (response) {
    case "again":
      // Reset to learning phase (REQ-F-27)
      return { interval: 1, repetitions: 0 };

    case "hard":
      // Increase interval slightly (REQ-F-28)
      return {
        interval: calculateHardInterval(state),
        repetitions: state.repetitions + 1,
      };

    case "good":
      // Standard SM-2 interval increase (REQ-F-29)
      return {
        interval: calculateGoodInterval(state, newEaseFactor),
        repetitions: state.repetitions + 1,
      };

    case "easy":
      // Large interval increase with bonus (REQ-F-30)
      return {
        interval: calculateEasyInterval(state, newEaseFactor),
        repetitions: state.repetitions + 1,
      };
  }
}

/**
 * Calculate interval for "hard" response.
 * Increases interval slightly, but less than "good" would.
 */
function calculateHardInterval(state: CardState): number {
  // For new/learning cards (interval=0 or repetitions=0), set to 1 day
  if (state.interval === 0 || state.repetitions === 0) {
    return 1;
  }

  // For established cards, multiply by hard multiplier
  const newInterval = Math.round(state.interval * HARD_INTERVAL_MULTIPLIER);

  // Ensure at least 1 day increase
  return Math.max(newInterval, state.interval + 1);
}

/**
 * Calculate interval for "good" response.
 * Standard SM-2: multiply interval by ease factor.
 */
function calculateGoodInterval(
  state: CardState,
  easeFactor: number
): number {
  // First review: interval = 1
  if (state.repetitions === 0) {
    return 1;
  }

  // Second review: interval = 6 (standard SM-2 value)
  if (state.repetitions === 1) {
    return 6;
  }

  // Subsequent reviews: interval = previous * EF
  return Math.round(state.interval * easeFactor);
}

/**
 * Calculate interval for "easy" response.
 * Multiply by ease factor with additional bonus.
 */
function calculateEasyInterval(
  state: CardState,
  easeFactor: number
): number {
  // First review: jump ahead to 4 days (skip the 1-day interval)
  if (state.repetitions === 0) {
    return 4;
  }

  // Second review: jump to 10 days (better than standard 6)
  if (state.repetitions === 1) {
    return 10;
  }

  // Subsequent reviews: interval = previous * EF * bonus
  return Math.round(state.interval * easeFactor * EASY_BONUS_MULTIPLIER);
}

/**
 * Clamp ease factor to valid range [MIN_EASE_FACTOR, MAX_EASE_FACTOR].
 */
function clampEaseFactor(ef: number): number {
  return Math.max(MIN_EASE_FACTOR, Math.min(MAX_EASE_FACTOR, ef));
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create default state for a new card.
 * Per REQ-F-34: interval=0, repetitions=0, ease_factor=2.5
 */
export function createNewCardState(): CardState {
  return {
    interval: 0,
    ease_factor: DEFAULT_EASE_FACTOR,
    repetitions: 0,
  };
}

/**
 * Validate that a card state has valid SM-2 values.
 * Returns true if valid, false otherwise.
 */
export function isValidCardState(state: CardState): boolean {
  return (
    typeof state.interval === "number" &&
    state.interval >= 0 &&
    typeof state.ease_factor === "number" &&
    state.ease_factor >= MIN_EASE_FACTOR &&
    typeof state.repetitions === "number" &&
    state.repetitions >= 0 &&
    Number.isInteger(state.repetitions)
  );
}

/**
 * Check if a response is valid.
 */
export function isValidResponse(response: string): response is ReviewResponse {
  return ["again", "hard", "good", "easy"].includes(response);
}

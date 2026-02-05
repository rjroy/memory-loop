/**
 * Spaced Repetition Module
 *
 * Re-exports from spaced-repetition submodules for convenient access.
 */

// Card manager (main API)
export {
  getDueCards,
  getCard,
  submitReview,
  archiveCard,
  createCard,
  type Result,
  type CreateCardInput,
} from "./card-manager.js";

// SM-2 algorithm
export {
  isValidResponse,
  calculateSM2,
  DEFAULT_EASE_FACTOR,
  MIN_EASE_FACTOR,
  MAX_EASE_FACTOR,
  type ReviewResponse,
  type CardState,
  type SM2Result,
} from "./sm2-algorithm.js";

// Card schema
export {
  type Card,
  type CardMetadata,
  type QACardContent,
  createNewCardMetadata,
  getToday,
  parseCard,
} from "./card-schema.js";

// Card storage
export {
  type VaultPathInfo,
  loadDueCards,
  loadCard,
  saveCard,
  getCardsDir,
  getArchiveDir,
  serializeCard,
} from "./card-storage.js";

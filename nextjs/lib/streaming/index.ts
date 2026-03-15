/**
 * Streaming Module (Transitional)
 *
 * Re-exports session types from @memory-loop/shared.
 * The actual streaming implementation has moved to the daemon.
 */

export type {
  SessionEvent,
  PendingPrompt,
  PromptResponse,
  SessionState,
  SessionSnapshot,
  SessionEventCallback,
} from "@memory-loop/shared";

export { AlreadyProcessingError } from "@memory-loop/shared";

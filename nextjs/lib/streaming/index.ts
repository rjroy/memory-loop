/**
 * Streaming Module
 *
 * Session management and SDK event streaming.
 * Used by Next.js SSE chat endpoint.
 */

// Types
export type {
  SessionEvent,
  PendingPrompt,
  PromptResponse,
  SessionState,
  SessionEventCallback,
  ActiveSessionController,
  PendingPermissionRequest,
  PendingQuestionRequest,
} from "./types";

// Controller
export {
  createActiveSessionController,
  getActiveSessionController,
  resetActiveSessionController,
} from "./active-session-controller";

// Streamer utilities (for direct use if needed)
export type { StreamingResult, StreamerState, StreamerEmitter } from "./session-streamer";
export { streamSdkEvents } from "./session-streamer";

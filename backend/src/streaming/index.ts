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
} from "./types.js";

// Controller
export {
  createActiveSessionController,
  getActiveSessionController,
  resetActiveSessionController,
} from "./active-session-controller.js";

// Streamer utilities (for direct use if needed)
export type { StreamingResult, StreamerState, StreamerEmitter } from "./session-streamer.js";
export { streamSdkEvents } from "./session-streamer.js";

/**
 * Streaming Module
 *
 * Transport-agnostic session management and SDK event streaming.
 * Both WebSocket and SSE handlers use this module.
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

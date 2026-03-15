/**
 * Streaming Module
 *
 * Barrel exports for the session streaming subsystem.
 */

export {
  createActiveSessionController,
  type ActiveSessionController,
} from "./active-session-controller";

export type {
  PendingPermissionRequest,
  PendingQuestionRequest,
} from "./types";

export {
  startStreamSdkEvents,
  streamSdkEvents,
  type StreamingResult,
  type StreamerHandle,
  type StreamerState,
  type StreamerEmitter,
} from "./session-streamer";

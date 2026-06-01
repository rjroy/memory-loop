/**
 * Streaming Module
 *
 * Barrel exports for the session streaming subsystem. The single-slot
 * ActiveSessionController was removed in the keyed-sessions refactor; live state
 * now lives in the per-session registry and is driven by the keyed controller.
 */

export {
  type LiveSession,
  type LiveStreamerState,
  createLiveSession,
  getLiveSession,
  hasLiveSession,
  deleteLiveSession,
  emitToSession,
  bufferEvent,
  clearEventBuffer,
  getEventBuffer,
  addSubscriber,
  removeSubscriber,
  isProcessing,
  setProcessing,
  collectPendingPrompts,
  resetForTesting,
} from "./live-session-registry";

export {
  sendMessage,
  runTurn,
  abortProcessing,
  clearSession,
  subscribe,
  unsubscribe,
  respondToPrompt,
  getPendingPrompts,
  getState,
  getSnapshot,
  getReplayBuffer,
} from "./live-session-controller";

export type {
  PendingPermissionRequest,
  PendingQuestionRequest,
  SdkRunnerEvent,
  TurnUsageData,
} from "./types";

export { createPiEventAdapter, isSessionExpiryError } from "./event-translator";

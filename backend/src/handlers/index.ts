/**
 * WebSocket Handlers Module
 *
 * Re-exports all handler modules for convenient importing.
 */

// Shared types and utilities
export type {
  WebSocketLike,
  ConnectionState,
  HandlerContext,
  PendingPermissionRequest,
} from "./types.js";

export { createConnectionState, generateMessageId, requireVault } from "./types.js";

// Browser handlers
export {
  handleListDirectory,
  handleReadFile,
  handleWriteFile,
  handleDeleteFile,
} from "./browser-handlers.js";

// Search handlers
export {
  handleSearchFiles,
  handleSearchContent,
  handleGetSnippets,
} from "./search-handlers.js";

// Home/dashboard handlers
export {
  handleCaptureNote,
  handleGetRecentNotes,
  handleGetRecentActivity,
  handleGetGoals,
  handleGetInspiration,
  handleGetTasks,
  handleToggleTask,
} from "./home-handlers.js";

// Meeting handlers
export {
  handleStartMeeting,
  handleStopMeeting,
  handleGetMeetingState,
  handleMeetingCapture,
} from "./meeting-handlers.js";

// Pair writing handlers
export {
  handleQuickAction,
  handleAdvisoryAction,
  handlePairChat,
} from "./pair-writing-handlers.js";

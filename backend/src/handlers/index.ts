/**
 * Handlers Module
 *
 * Re-exports handler modules for REST routes and WebSocket operations.
 *
 * After REST API migration, most handlers have been moved to REST routes.
 * This module exports:
 * - Shared types and utilities
 * - Search handlers (REST-only, used by routes/search.ts)
 * - Config handlers (REST-only, used by routes/config.ts)
 * - Pair writing handlers (WebSocket, for streaming responses)
 * - Memory/extraction handlers (WebSocket, for extraction prompt operations)
 *
 * Removed handlers (now in REST routes):
 * - browser-handlers.ts -> routes/files.ts
 * - home-handlers.ts -> routes/home.ts, routes/capture.ts
 * - meeting-handlers.ts -> routes/meetings.ts
 */

// Shared types and utilities
export type {
  WebSocketLike,
  ConnectionState,
  HandlerContext,
  PendingPermissionRequest,
} from "./types.js";

export { createConnectionState, generateMessageId, requireVault } from "./types.js";

// Search handlers (REST-only, used by routes/search.ts)
export {
  searchFilesRest,
  searchContentRest,
  getSnippetsRest,
  type SearchResultWithTiming,
} from "./search-handlers.js";

// Config handlers (REST-only, used by routes/config.ts)
export {
  handleGetPinnedAssets,
  handleSetPinnedAssets,
  handleUpdateVaultConfig,
  handleSetupVault,
  handleCreateVault,
  ConfigValidationError,
  VaultNotFoundError,
  type PinnedAssetsResult,
  type ConfigUpdateResult,
  type VaultCreatedResult,
} from "./config-handlers.js";

// Pair writing handlers (WebSocket, for streaming responses)
export {
  handleQuickAction,
  handleAdvisoryAction,
} from "./pair-writing-handlers.js";

// Memory/extraction handlers (WebSocket, for extraction prompt operations)
export {
  handleGetExtractionPrompt,
  handleSaveExtractionPrompt,
  handleResetExtractionPrompt,
  handleTriggerExtraction,
} from "./memory-handlers.js";

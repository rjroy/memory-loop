/**
 * WebSocket Handlers Module
 *
 * Re-exports handler modules for WebSocket operations.
 *
 * After REST API migration, many handlers have been moved to REST routes.
 * This module now primarily exports:
 * - Shared types and utilities (still used by remaining WebSocket handlers)
 * - Search handlers (used by REST routes)
 * - Config handlers (used by REST routes)
 * - Pair writing handlers (used by WebSocket for streaming)
 *
 * The following handlers have been migrated to REST and are deprecated:
 * - browser-handlers.ts (use REST /files/* routes)
 * - home-handlers.ts (use REST /capture, /goals, etc.)
 * - meeting-handlers.ts (use REST /meetings/* routes)
 */

// Shared types and utilities
export type {
  WebSocketLike,
  ConnectionState,
  HandlerContext,
  PendingPermissionRequest,
} from "./types.js";

export { createConnectionState, generateMessageId, requireVault } from "./types.js";

// Search handlers (used by REST routes/search.ts)
export {
  handleSearchFiles,
  handleSearchContent,
  handleGetSnippets,
} from "./search-handlers.js";

// Config handlers (used by REST routes/config.ts)
export {
  handleGetPinnedAssets,
  handleSetPinnedAssets,
  handleUpdateVaultConfig,
  handleSetupVault,
  handleCreateVault,
  ConfigValidationError,
  VaultNotFoundError,
} from "./config-handlers.js";

// Pair writing handlers (used by WebSocket for streaming)
export {
  handleQuickAction,
  handleAdvisoryAction,
} from "./pair-writing-handlers.js";

/**
 * Shared Types for WebSocket Handlers
 *
 * Common types, interfaces, and helper functions used across all handler modules.
 */

import type { VaultInfo, ServerMessage, ErrorCode } from "@memory-loop/shared";
import type { SessionQueryResult } from "../session-manager.js";
import type { SearchIndexManager } from "../search/search-index.js";
import type { WidgetEngine, FileWatcher } from "../widgets/index.js";
import type { HealthCollector } from "../health-collector.js";

/**
 * WebSocket interface for sending messages.
 * Abstracts over different WebSocket implementations.
 */
export interface WebSocketLike {
  send(data: string): void;
  readyState: number;
}

/**
 * Pending tool permission request, waiting for user response.
 */
export interface PendingPermissionRequest {
  resolve: (allowed: boolean) => void;
  reject: (error: Error) => void;
}

/**
 * Pending AskUserQuestion request, waiting for user answers.
 */
export interface PendingAskUserQuestionRequest {
  resolve: (answers: Record<string, string>) => void;
  reject: (error: Error) => void;
}

/**
 * Connection state for a WebSocket client.
 * Each connection tracks its selected vault and active session.
 */
export interface ConnectionState {
  /** Currently selected vault (null if none selected) */
  currentVault: VaultInfo | null;
  /** Current session ID (null if no session active) */
  currentSessionId: string | null;
  /** Active query result with interrupt function (null if no query running) */
  activeQuery: SessionQueryResult | null;
  /** Pending tool permission requests, keyed by toolUseId */
  pendingPermissions: Map<string, PendingPermissionRequest>;
  /** Pending AskUserQuestion requests, keyed by toolUseId */
  pendingAskUserQuestions: Map<string, PendingAskUserQuestionRequest>;
  /** Search index manager for the current vault (null if no vault selected) */
  searchIndex: SearchIndexManager | null;
  /** Active model captured from SDK system/init event (null if not yet received) */
  activeModel: string | null;
  /** Widget engine for computing vault widgets (null if no vault selected) */
  widgetEngine: WidgetEngine | null;
  /** File watcher for widget source files (null if no vault selected) */
  widgetWatcher: FileWatcher | null;
  /** Health collector for tracking backend issues (null if no vault selected) */
  healthCollector: HealthCollector | null;
}

/**
 * Handler context passed to all message handlers.
 * Provides access to connection state and utility functions.
 */
export interface HandlerContext {
  /** Current connection state */
  state: ConnectionState;
  /** Send a typed server message to the client */
  send: (message: ServerMessage) => void;
  /** Send an error message to the client */
  sendError: (code: ErrorCode, message: string) => void;
}

/**
 * Creates initial connection state for a new WebSocket connection.
 */
export function createConnectionState(): ConnectionState {
  return {
    currentVault: null,
    currentSessionId: null,
    activeQuery: null,
    pendingPermissions: new Map(),
    pendingAskUserQuestions: new Map(),
    searchIndex: null,
    activeModel: null,
    widgetEngine: null,
    widgetWatcher: null,
    healthCollector: null,
  };
}

/**
 * Generates a unique message ID for response streaming.
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Checks if a vault is selected and sends an error if not.
 * Returns true if vault is selected, false otherwise.
 */
export function requireVault(ctx: HandlerContext): ctx is HandlerContext & { state: { currentVault: VaultInfo } } {
  if (!ctx.state.currentVault) {
    ctx.sendError("VAULT_NOT_FOUND", "No vault selected. Send select_vault first.");
    return false;
  }
  return true;
}

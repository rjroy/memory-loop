/**
 * Shared Types for WebSocket Handlers
 *
 * Common types, interfaces, and helper functions used across all handler modules.
 */

import type {
  VaultInfo,
  ServerMessage,
  ErrorCode,
  FileEntry,
  RecentNoteEntry,
  RecentDiscussionEntry,
  TaskEntry,
  ConversationMessage,
} from "@memory-loop/shared";
import type { SessionQueryResult } from "../session-manager.js";
import type { SearchIndexManager } from "../search/search-index.js";
import type { HealthCollector } from "../health-collector.js";
import type { ActiveMeeting } from "../meeting-capture.js";
import type { VaultConfig } from "../vault-config.js";
import type { ArchiveResult, RenameResult, MoveResult, DirectoryContentsResult, DeleteDirectoryResult } from "../file-browser.js";
import type { ReferenceUpdateResult } from "../reference-updater.js";

// =============================================================================
// Handler Dependencies (Injectable for Testing)
// =============================================================================

/**
 * Result of reading a file.
 */
export interface FileReadResult {
  content: string;
  truncated: boolean;
}

/**
 * Result of capturing a note.
 */
export interface CaptureResult {
  success: boolean;
  timestamp: string;
  notePath: string;
  error?: string;
}

/**
 * Result of getting all tasks.
 */
export interface TasksResult {
  tasks: TaskEntry[];
  incomplete: number;
  total: number;
}

/**
 * Result of toggling a task.
 */
export interface ToggleResult {
  success: boolean;
  newState?: string;
  error?: string;
}

/**
 * Result of getting inspiration.
 */
export interface InspirationResult {
  contextual: { text: string; attribution?: string } | null;
  quote: { text: string; attribution?: string };
}

/**
 * Dependencies for handler functions.
 * All functions are optional; defaults are used when not provided.
 */
export interface HandlerDependencies {
  // Note capture functions
  captureToDaily?: (
    vault: VaultInfo,
    text: string,
    date?: Date
  ) => Promise<CaptureResult>;
  getRecentNotes?: (
    vault: VaultInfo,
    limit?: number
  ) => Promise<RecentNoteEntry[]>;

  // File browser functions
  listDirectory?: (
    vaultPath: string,
    relativePath: string
  ) => Promise<FileEntry[]>;
  readMarkdownFile?: (
    vaultPath: string,
    relativePath: string
  ) => Promise<FileReadResult>;
  writeMarkdownFile?: (
    vaultPath: string,
    relativePath: string,
    content: string
  ) => Promise<void>;
  deleteFile?: (vaultPath: string, relativePath: string) => Promise<void>;
  getDirectoryContents?: (vaultPath: string, relativePath: string) => Promise<DirectoryContentsResult>;
  deleteDirectory?: (vaultPath: string, relativePath: string) => Promise<DeleteDirectoryResult>;
  archiveFile?: (vaultPath: string, relativePath: string, archiveRoot: string) => Promise<ArchiveResult>;
  createDirectory?: (vaultPath: string, parentPath: string, name: string) => Promise<string>;
  createFile?: (vaultPath: string, parentPath: string, name: string) => Promise<string>;
  renameFile?: (vaultPath: string, relativePath: string, newName: string) => Promise<RenameResult>;
  moveFile?: (vaultPath: string, sourcePath: string, destPath: string) => Promise<MoveResult>;
  updateReferences?: (vaultPath: string, oldPath: string, newPath: string, isDirectory: boolean) => Promise<ReferenceUpdateResult>;

  // Inspiration manager
  getInspiration?: (vault: VaultInfo) => Promise<InspirationResult>;

  // Task manager
  getAllTasks?: (
    vaultPath: string,
    config: VaultConfig
  ) => Promise<TasksResult>;
  toggleTask?: (
    vaultPath: string,
    filePath: string,
    lineNumber: number,
    newState?: string
  ) => Promise<ToggleResult>;

  // Session manager
  getRecentSessions?: (
    vaultPath: string,
    limit?: number
  ) => Promise<RecentDiscussionEntry[]>;
  resumeSession?: (
    vaultPath: string,
    sessionId: string,
    prompt: string
  ) => Promise<SessionQueryResult>;
  appendMessage?: (
    vaultPath: string,
    sessionId: string,
    message: ConversationMessage
  ) => Promise<void>;

  // Vault config
  loadVaultConfig?: (vaultPath: string) => Promise<VaultConfig>;
}

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
  /** Cumulative token count across all turns in the session (input + output) */
  cumulativeTokens: number;
  /** Context window size for the active model (null if not yet known) */
  contextWindow: number | null;
  /** Health collector for tracking backend issues (null if no vault selected) */
  healthCollector: HealthCollector | null;
  /** Active meeting session (null if no meeting in progress) */
  activeMeeting: ActiveMeeting | null;
}

/**
 * Required handler dependencies (with defaults filled in).
 */
export interface RequiredHandlerDependencies {
  captureToDaily: (
    vault: VaultInfo,
    text: string,
    date?: Date
  ) => Promise<CaptureResult>;
  getRecentNotes: (
    vault: VaultInfo,
    limit?: number
  ) => Promise<RecentNoteEntry[]>;
  listDirectory: (
    vaultPath: string,
    relativePath: string
  ) => Promise<FileEntry[]>;
  readMarkdownFile: (
    vaultPath: string,
    relativePath: string
  ) => Promise<FileReadResult>;
  writeMarkdownFile: (
    vaultPath: string,
    relativePath: string,
    content: string
  ) => Promise<void>;
  deleteFile: (vaultPath: string, relativePath: string) => Promise<void>;
  getDirectoryContents: (vaultPath: string, relativePath: string) => Promise<DirectoryContentsResult>;
  deleteDirectory: (vaultPath: string, relativePath: string) => Promise<DeleteDirectoryResult>;
  archiveFile: (vaultPath: string, relativePath: string, archiveRoot: string) => Promise<ArchiveResult>;
  createDirectory: (vaultPath: string, parentPath: string, name: string) => Promise<string>;
  createFile: (vaultPath: string, parentPath: string, name: string) => Promise<string>;
  renameFile: (vaultPath: string, relativePath: string, newName: string) => Promise<RenameResult>;
  moveFile: (vaultPath: string, sourcePath: string, destPath: string) => Promise<MoveResult>;
  updateReferences: (vaultPath: string, oldPath: string, newPath: string, isDirectory: boolean) => Promise<ReferenceUpdateResult>;
  getInspiration: (vault: VaultInfo) => Promise<InspirationResult>;
  getAllTasks: (
    vaultPath: string,
    config: VaultConfig
  ) => Promise<TasksResult>;
  toggleTask: (
    vaultPath: string,
    filePath: string,
    lineNumber: number,
    newState?: string
  ) => Promise<ToggleResult>;
  getRecentSessions: (
    vaultPath: string,
    limit?: number
  ) => Promise<RecentDiscussionEntry[]>;
  resumeSession: (
    vaultPath: string,
    sessionId: string,
    prompt: string
  ) => Promise<SessionQueryResult>;
  appendMessage: (
    vaultPath: string,
    sessionId: string,
    message: ConversationMessage
  ) => Promise<void>;
  loadVaultConfig: (vaultPath: string) => Promise<VaultConfig>;
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
  /** Injectable dependencies for handler functions */
  deps: RequiredHandlerDependencies;
}

/**
 * Checks if an error is a FileBrowserError by checking its name property.
 * Used instead of instanceof to avoid mock.module() dependencies.
 */
export function isFileBrowserError(
  error: unknown
): error is Error & { code: ErrorCode } {
  return (
    error instanceof Error &&
    error.name === "FileBrowserError" &&
    "code" in error
  );
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
    cumulativeTokens: 0,
    contextWindow: null,
    healthCollector: null,
    activeMeeting: null,
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

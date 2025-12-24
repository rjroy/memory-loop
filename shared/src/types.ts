/**
 * Memory Loop Shared Types
 *
 * Core type definitions for Vault and Session models.
 * These types are used by both frontend and backend.
 */

/**
 * Information about an Obsidian vault discovered by the backend.
 *
 * @property id - Directory name (unique identifier)
 * @property name - Human-readable name from CLAUDE.md title or fallback to id
 * @property path - Relative path for display in UI
 * @property hasClaudeMd - Whether the vault has a CLAUDE.md file
 * @property inboxPath - Resolved inbox location for daily notes
 */
export interface VaultInfo {
  id: string;
  name: string;
  path: string;
  hasClaudeMd: boolean;
  inboxPath: string;
}

/**
 * Metadata for a Claude Agent SDK session.
 *
 * Session data is stored in `.memory-loop/sessions/` as JSON files.
 * The actual conversation state is managed by the Claude Agent SDK.
 *
 * @property id - Claude Agent SDK session ID
 * @property vaultId - Vault directory name
 * @property vaultPath - Absolute path to the vault
 * @property createdAt - ISO 8601 timestamp of session creation
 * @property lastActiveAt - ISO 8601 timestamp of last activity
 */
export interface SessionMetadata {
  id: string;
  vaultId: string;
  vaultPath: string;
  createdAt: string;
  lastActiveAt: string;
}

/**
 * Error codes for the WebSocket protocol.
 *
 * These codes provide structured error information for clients
 * to handle specific error conditions appropriately.
 */
export type ErrorCode =
  | "VAULT_NOT_FOUND"
  | "VAULT_ACCESS_DENIED"
  | "SESSION_NOT_FOUND"
  | "SESSION_INVALID"
  | "SDK_ERROR"
  | "NOTE_CAPTURE_FAILED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "FILE_NOT_FOUND"
  | "DIRECTORY_NOT_FOUND"
  | "PATH_TRAVERSAL"
  | "INVALID_FILE_TYPE";

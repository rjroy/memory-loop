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
 * @property path - Absolute path to the vault root directory
 * @property hasClaudeMd - Whether the vault has a CLAUDE.md file
 * @property contentRoot - Absolute path to content root (may differ from path if configured)
 * @property inboxPath - Resolved inbox location for daily notes (relative to contentRoot)
 * @property metadataPath - Path to metadata directory (relative to contentRoot)
 * @property goalsPath - Path to goals.md if it exists (relative to contentRoot)
 * @property setupComplete - Whether vault setup has been completed (marker file exists)
 */
export interface VaultInfo {
  id: string;
  name: string;
  path: string;
  hasClaudeMd: boolean;
  contentRoot: string;
  inboxPath: string;
  metadataPath: string;
  goalsPath?: string;
  setupComplete: boolean;
}

/**
 * A tool invocation within an assistant message.
 *
 * @property toolUseId - Unique ID for this tool invocation
 * @property toolName - Name of the tool that was invoked
 * @property input - Tool input parameters (optional)
 * @property output - Tool output/result (optional)
 * @property status - Whether the tool is running or complete
 */
export interface StoredToolInvocation {
  toolUseId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  status: "running" | "complete";
}

/**
 * A message in the conversation history.
 *
 * Stored server-side in session files and sent to frontend on resume.
 *
 * @property id - Unique message ID
 * @property role - Who sent the message
 * @property content - Message text content
 * @property timestamp - ISO 8601 timestamp
 * @property toolInvocations - Tool invocations for assistant messages (optional)
 */
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolInvocations?: StoredToolInvocation[];
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
 * @property messages - Conversation history for this session
 */
export interface SessionMetadata {
  id: string;
  vaultId: string;
  vaultPath: string;
  createdAt: string;
  lastActiveAt: string;
  messages: ConversationMessage[];
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

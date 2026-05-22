/**
 * Memory Loop Shared Types
 *
 * Core type definitions for Vault, Session, and Message models.
 * Used by both frontend and backend.
 */

/**
 * Named colors for custom badges. Map to theme CSS variables.
 */
export type BadgeColor =
  | "black"
  | "purple"
  | "red"
  | "cyan"
  | "orange"
  | "blue"
  | "green"
  | "yellow";

export interface Badge {
  text: string;
  color: BadgeColor;
}

/**
 * Information about an Obsidian vault discovered by the backend.
 *
 * `path` is the vault root; `contentRoot` is the content directory (may differ
 * if configured). All sub-paths (inboxPath, metadataPath, etc.) are relative
 * to `contentRoot`. `order` may be `Infinity` for vaults without an explicit
 * order, sorting them last.
 */
export interface VaultInfo {
  id: string;
  name: string;
  subtitle?: string;
  path: string;
  hasClaudeMd: boolean;
  contentRoot: string;
  inboxPath: string;
  metadataPath: string;
  goalsPath?: string;
  attachmentPath: string;
  setupComplete: boolean;
  discussionModel?: string;
  promptsPerGeneration: number;
  maxPoolSize: number;
  quotesPerWeek: number;
  recentCaptures?: number;
  recentDiscussions?: number;
  badges: Badge[];
  order: number;
  cardsEnabled: boolean;
  viMode: boolean;
}

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
 * Stored server-side in session files and sent to the frontend on resume.
 * `contextUsage` and `durationMs` are only set for assistant messages.
 */
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolInvocations?: StoredToolInvocation[];
  contextUsage?: number;
  durationMs?: number;
}

/**
 * Metadata for a Claude Agent SDK session.
 *
 * Stored as JSON in `.memory-loop/sessions/`. Conversation state lives in
 * the SDK; we persist enough to resume and render history.
 */
export interface SessionMetadata {
  id: string;
  vaultId: string;
  vaultPath: string;
  createdAt: string;
  lastActiveAt: string;
  messages: ConversationMessage[];
  activeModel?: string;
  transcriptPath?: string;
  piSessionPath?: string;
}

export type SaveConfigResult =
  | { success: true }
  | { success: false; error: string };

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

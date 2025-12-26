/**
 * Memory Loop WebSocket Protocol
 *
 * Zod schemas for validating WebSocket messages between client and server.
 * Uses discriminated unions for type-safe message handling.
 */

import { z } from "zod";

// =============================================================================
// Vault Info Schema
// =============================================================================

/**
 * Schema for VaultInfo - used in vault_list messages
 */
export const VaultInfoSchema = z.object({
  id: z.string().min(1, "Vault ID is required"),
  name: z.string().min(1, "Vault name is required"),
  path: z.string().min(1, "Vault path is required"),
  hasClaudeMd: z.boolean(),
  inboxPath: z.string().min(1, "Inbox path is required"),
  goalsPath: z.string().optional(),
});

// =============================================================================
// Error Code Schema
// =============================================================================

/**
 * Schema for ErrorCode enum values
 */
export const ErrorCodeSchema = z.enum([
  "VAULT_NOT_FOUND",
  "VAULT_ACCESS_DENIED",
  "SESSION_NOT_FOUND",
  "SESSION_INVALID",
  "SDK_ERROR",
  "NOTE_CAPTURE_FAILED",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
  "FILE_NOT_FOUND",
  "DIRECTORY_NOT_FOUND",
  "PATH_TRAVERSAL",
  "INVALID_FILE_TYPE",
]);

// =============================================================================
// File Browser Schemas
// =============================================================================

/**
 * Schema for a file or directory entry in a vault listing
 */
export const FileEntrySchema = z.object({
  name: z.string().min(1, "Entry name is required"),
  type: z.enum(["file", "directory"]),
  path: z.string(), // Can be empty string for root entries
});

/**
 * Schema for a recent note entry in the inbox
 */
export const RecentNoteEntrySchema = z.object({
  id: z.string().min(1, "Entry ID is required"),
  text: z.string(),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM format"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
});

/**
 * Schema for a recent discussion entry (session summary)
 */
export const RecentDiscussionEntrySchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  preview: z.string(),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM format"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
  messageCount: z.number().int().min(0),
});

/**
 * Schema for a conversation message in session history
 */
export const ConversationMessageSchema = z.object({
  id: z.string().min(1, "Message ID is required"),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string().min(1, "Timestamp is required"),
});

// =============================================================================
// Client -> Server Message Schemas
// =============================================================================

/**
 * Client requests to select a vault and start/resume a session
 */
export const SelectVaultMessageSchema = z.object({
  type: z.literal("select_vault"),
  vaultId: z.string().min(1, "Vault ID is required"),
});

/**
 * Client sends a note to be captured in the daily note
 */
export const CaptureNoteMessageSchema = z.object({
  type: z.literal("capture_note"),
  text: z.string().min(1, "Note text is required"),
});

/**
 * Client sends a discussion message for the AI to respond to
 */
export const DiscussionMessageSchema = z.object({
  type: z.literal("discussion_message"),
  text: z.string().min(1, "Message text is required"),
});

/**
 * Client requests to resume an existing session
 */
export const ResumeSessionMessageSchema = z.object({
  type: z.literal("resume_session"),
  sessionId: z.string().min(1, "Session ID is required"),
});

/**
 * Client requests to start a new session (clearing context)
 */
export const NewSessionMessageSchema = z.object({
  type: z.literal("new_session"),
});

/**
 * Client requests to abort the current operation
 */
export const AbortMessageSchema = z.object({
  type: z.literal("abort"),
});

/**
 * Client sends a ping to keep the connection alive
 */
export const PingMessageSchema = z.object({
  type: z.literal("ping"),
});

/**
 * Client requests directory listing in the vault
 * Path is relative to vault root; empty string for root directory
 */
export const ListDirectoryMessageSchema = z.object({
  type: z.literal("list_directory"),
  path: z.string(), // Empty string for root, or relative path like "folder/subfolder"
});

/**
 * Client requests to read a markdown file from the vault
 * Path is relative to vault root and must end with .md
 */
export const ReadFileMessageSchema = z.object({
  type: z.literal("read_file"),
  path: z.string().min(1, "File path is required"),
});

/**
 * Client requests recent captured notes from the vault inbox
 */
export const GetRecentNotesMessageSchema = z.object({
  type: z.literal("get_recent_notes"),
});

/**
 * Client requests recent activity (captures + discussions) from the vault
 */
export const GetRecentActivityMessageSchema = z.object({
  type: z.literal("get_recent_activity"),
});

/**
 * Client requests goals from the vault's goals.md file
 */
export const GetGoalsMessageSchema = z.object({
  type: z.literal("get_goals"),
});

/**
 * Discriminated union of all client message types
 */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  SelectVaultMessageSchema,
  CaptureNoteMessageSchema,
  DiscussionMessageSchema,
  ResumeSessionMessageSchema,
  NewSessionMessageSchema,
  AbortMessageSchema,
  PingMessageSchema,
  ListDirectoryMessageSchema,
  ReadFileMessageSchema,
  GetRecentNotesMessageSchema,
  GetRecentActivityMessageSchema,
  GetGoalsMessageSchema,
]);

// =============================================================================
// Server -> Client Message Schemas
// =============================================================================

/**
 * Server sends the list of available vaults
 */
export const VaultListMessageSchema = z.object({
  type: z.literal("vault_list"),
  vaults: z.array(VaultInfoSchema),
});

/**
 * Server confirms session is ready
 * Note: sessionId can be empty when vault is first selected (session created lazily)
 * When resuming a session, messages contains the conversation history.
 */
export const SessionReadyMessageSchema = z.object({
  type: z.literal("session_ready"),
  sessionId: z.string(), // Can be empty - session created on first discussion_message
  vaultId: z.string().min(1),
  messages: z.array(ConversationMessageSchema).optional(), // Sent on resume
  createdAt: z.string().optional(), // ISO 8601 timestamp of session creation
});

/**
 * Server confirms note was captured
 */
export const NoteCapturedMessageSchema = z.object({
  type: z.literal("note_captured"),
  timestamp: z.string().min(1, "Timestamp is required"),
});

/**
 * Server signals start of AI response
 */
export const ResponseStartMessageSchema = z.object({
  type: z.literal("response_start"),
  messageId: z.string().min(1),
});

/**
 * Server sends a chunk of the AI response
 */
export const ResponseChunkMessageSchema = z.object({
  type: z.literal("response_chunk"),
  messageId: z.string().min(1),
  content: z.string(), // Can be empty for whitespace-only chunks
});

/**
 * Server signals end of AI response
 */
export const ResponseEndMessageSchema = z.object({
  type: z.literal("response_end"),
  messageId: z.string().min(1),
});

/**
 * Server signals start of tool invocation
 */
export const ToolStartMessageSchema = z.object({
  type: z.literal("tool_start"),
  toolName: z.string().min(1),
  toolUseId: z.string().min(1),
});

/**
 * Server sends tool input parameters
 */
export const ToolInputMessageSchema = z.object({
  type: z.literal("tool_input"),
  toolUseId: z.string().min(1),
  input: z.unknown(),
});

/**
 * Server signals end of tool invocation with output
 */
export const ToolEndMessageSchema = z.object({
  type: z.literal("tool_end"),
  toolUseId: z.string().min(1),
  output: z.unknown(),
});

/**
 * Server sends an error message
 */
export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  code: ErrorCodeSchema,
  message: z.string().min(1, "Error message is required"),
});

/**
 * Server responds to ping
 */
export const PongMessageSchema = z.object({
  type: z.literal("pong"),
});

/**
 * Server sends directory listing response
 */
export const DirectoryListingMessageSchema = z.object({
  type: z.literal("directory_listing"),
  path: z.string(), // The requested directory path (empty string for root)
  entries: z.array(FileEntrySchema), // Sorted: directories first, then files, alphabetically
});

/**
 * Server sends file content response
 */
export const FileContentMessageSchema = z.object({
  type: z.literal("file_content"),
  path: z.string().min(1, "File path is required"),
  content: z.string(),
  truncated: z.boolean(), // True if file exceeded 1MB and was truncated
});

/**
 * Server sends recent captured notes from the vault inbox
 */
export const RecentNotesMessageSchema = z.object({
  type: z.literal("recent_notes"),
  notes: z.array(RecentNoteEntrySchema),
});

/**
 * Server sends recent activity (captures + discussions) from the vault
 */
export const RecentActivityMessageSchema = z.object({
  type: z.literal("recent_activity"),
  captures: z.array(RecentNoteEntrySchema),
  discussions: z.array(RecentDiscussionEntrySchema),
});

/**
 * Schema for a section of goals parsed from goals.md
 * Sections are created from markdown headers at any level
 */
export const GoalSectionSchema = z.object({
  title: z.string(),
  items: z.array(z.string()),
  hasMore: z.boolean(),
});

/**
 * Server sends goals from the vault's goals.md file
 * Returns null for sections if the file doesn't exist
 */
export const GoalsMessageSchema = z.object({
  type: z.literal("goals"),
  sections: z.array(GoalSectionSchema).nullable(),
});

/**
 * Discriminated union of all server message types
 */
export const ServerMessageSchema = z.discriminatedUnion("type", [
  VaultListMessageSchema,
  SessionReadyMessageSchema,
  NoteCapturedMessageSchema,
  ResponseStartMessageSchema,
  ResponseChunkMessageSchema,
  ResponseEndMessageSchema,
  ToolStartMessageSchema,
  ToolInputMessageSchema,
  ToolEndMessageSchema,
  ErrorMessageSchema,
  PongMessageSchema,
  DirectoryListingMessageSchema,
  FileContentMessageSchema,
  RecentNotesMessageSchema,
  RecentActivityMessageSchema,
  GoalsMessageSchema,
]);

// =============================================================================
// Inferred TypeScript Types
// =============================================================================

// File browser types
export type FileEntry = z.infer<typeof FileEntrySchema>;

// Recent notes types
export type RecentNoteEntry = z.infer<typeof RecentNoteEntrySchema>;

// Recent discussion types
export type RecentDiscussionEntry = z.infer<typeof RecentDiscussionEntrySchema>;

// Conversation message type
export type ConversationMessageProtocol = z.infer<typeof ConversationMessageSchema>;

// Client message types
export type SelectVaultMessage = z.infer<typeof SelectVaultMessageSchema>;
export type CaptureNoteMessage = z.infer<typeof CaptureNoteMessageSchema>;
export type DiscussionMessage = z.infer<typeof DiscussionMessageSchema>;
export type ResumeSessionMessage = z.infer<typeof ResumeSessionMessageSchema>;
export type NewSessionMessage = z.infer<typeof NewSessionMessageSchema>;
export type AbortMessage = z.infer<typeof AbortMessageSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;
export type ListDirectoryMessage = z.infer<typeof ListDirectoryMessageSchema>;
export type ReadFileMessage = z.infer<typeof ReadFileMessageSchema>;
export type GetRecentNotesMessage = z.infer<typeof GetRecentNotesMessageSchema>;
export type GetRecentActivityMessage = z.infer<typeof GetRecentActivityMessageSchema>;
export type GetGoalsMessage = z.infer<typeof GetGoalsMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Server message types
export type VaultListMessage = z.infer<typeof VaultListMessageSchema>;
export type SessionReadyMessage = z.infer<typeof SessionReadyMessageSchema>;
export type NoteCapturedMessage = z.infer<typeof NoteCapturedMessageSchema>;
export type ResponseStartMessage = z.infer<typeof ResponseStartMessageSchema>;
export type ResponseChunkMessage = z.infer<typeof ResponseChunkMessageSchema>;
export type ResponseEndMessage = z.infer<typeof ResponseEndMessageSchema>;
export type ToolStartMessage = z.infer<typeof ToolStartMessageSchema>;
export type ToolInputMessage = z.infer<typeof ToolInputMessageSchema>;
export type ToolEndMessage = z.infer<typeof ToolEndMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type PongMessage = z.infer<typeof PongMessageSchema>;
export type DirectoryListingMessage = z.infer<typeof DirectoryListingMessageSchema>;
export type FileContentMessage = z.infer<typeof FileContentMessageSchema>;
export type RecentNotesMessage = z.infer<typeof RecentNotesMessageSchema>;
export type RecentActivityMessage = z.infer<typeof RecentActivityMessageSchema>;
export type GoalSection = z.infer<typeof GoalSectionSchema>;
export type GoalsMessage = z.infer<typeof GoalsMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Parse and validate a client message from JSON
 * @throws ZodError if validation fails
 */
export function parseClientMessage(data: unknown): ClientMessage {
  return ClientMessageSchema.parse(data);
}

/**
 * Parse and validate a server message from JSON
 * @throws ZodError if validation fails
 */
export function parseServerMessage(data: unknown): ServerMessage {
  return ServerMessageSchema.parse(data);
}

/**
 * Safely parse a client message, returning success/error result
 */
export function safeParseClientMessage(data: unknown) {
  return ClientMessageSchema.safeParse(data);
}

/**
 * Safely parse a server message, returning success/error result
 */
export function safeParseServerMessage(data: unknown) {
  return ServerMessageSchema.safeParse(data);
}

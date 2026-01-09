/**
 * Memory Loop WebSocket Protocol
 *
 * Zod schemas for validating WebSocket messages between client and server.
 * Uses discriminated unions for type-safe message handling.
 */

import { z } from "zod";

// =============================================================================
// Badge Schema
// =============================================================================

/**
 * Schema for badge color enum - valid named colors for badges
 */
export const BadgeColorSchema = z.enum([
  "black",
  "purple",
  "red",
  "cyan",
  "orange",
  "blue",
  "green",
  "yellow",
]);

/**
 * Schema for Badge - custom badge configured in .memory-loop.json
 */
export const BadgeSchema = z.object({
  text: z.string().min(1, "Badge text is required"),
  color: BadgeColorSchema,
});

// =============================================================================
// Vault Info Schema
// =============================================================================

/**
 * Schema for VaultInfo - used in vault_list messages
 */
export const VaultInfoSchema = z.object({
  id: z.string().min(1, "Vault ID is required"),
  name: z.string().min(1, "Vault name is required"),
  subtitle: z.string().optional(),
  path: z.string().min(1, "Vault path is required"),
  hasClaudeMd: z.boolean(),
  contentRoot: z.string().min(1, "Content root is required"),
  inboxPath: z.string().min(1, "Inbox path is required"),
  metadataPath: z.string().min(1, "Metadata path is required"),
  goalsPath: z.string().optional(),
  attachmentPath: z.string().min(1, "Attachment path is required"),
  setupComplete: z.boolean(),
  promptsPerGeneration: z.number().int().positive(),
  maxPoolSize: z.number().int().positive(),
  quotesPerWeek: z.number().int().positive(),
  badges: z.array(BadgeSchema),
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
 * Schema for a task entry parsed from markdown files
 * Tasks are lines matching /^\s*- \[(.)\] (.+)$/
 */
export const TaskEntrySchema = z.object({
  /** Task text content (after checkbox) */
  text: z.string(),
  /** Checkbox state character: ' ', 'x', '/', '?', 'b', 'f' */
  state: z.string().length(1, "State must be a single character"),
  /** Relative file path from content root */
  filePath: z.string().min(1, "File path is required"),
  /** Line number in file (1-indexed) */
  lineNumber: z.number().int().min(1, "Line number must be at least 1"),
  /** File modification time (Unix timestamp in ms) for sorting */
  fileMtime: z.number().int().min(0),
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

// =============================================================================
// Slash Command Schema
// =============================================================================

/**
 * Schema for a slash command available in the discussion interface
 * Commands are sent from server to client in session_ready message
 */
export const SlashCommandSchema = z.object({
  /** Command name including "/" prefix (e.g., "/commit") */
  name: z.string().min(2, "Command name must include / prefix and at least one character"),
  /** User-facing description of what the command does */
  description: z.string().min(1, "Description is required"),
  /** Optional hint for expected arguments (e.g., "<message>") */
  argumentHint: z.string().optional(),
});

// =============================================================================
// Tool Invocation Schema
// =============================================================================

/**
 * Schema for a tool invocation within an assistant message
 */
export const ToolInvocationSchema = z.object({
  toolUseId: z.string().min(1, "Tool use ID is required"),
  toolName: z.string().min(1, "Tool name is required"),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  status: z.enum(["running", "complete"]),
});

/**
 * Schema for a conversation message in session history
 */
export const ConversationMessageSchema = z.object({
  id: z.string().min(1, "Message ID is required"),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string().min(1, "Timestamp is required"),
  toolInvocations: z.array(ToolInvocationSchema).optional(),
});

// =============================================================================
// Search Result Schemas
// =============================================================================

/**
 * Schema for a file name search result
 * Returned when searching by file name with fuzzy matching
 */
export const FileSearchResultSchema = z.object({
  /** Relative path from content root */
  path: z.string(),
  /** File name only (without path) */
  name: z.string(),
  /** Match quality score (higher = better match) */
  score: z.number(),
  /** Character positions in name that matched the query */
  matchPositions: z.array(z.number()),
});

/**
 * Schema for a content search result
 * Returned when searching within file contents
 */
export const ContentSearchResultSchema = z.object({
  /** Relative path from content root */
  path: z.string(),
  /** File name only (without path) */
  name: z.string(),
  /** Number of matches found in this file */
  matchCount: z.number().int().min(1),
  /** Context snippets (populated on demand via get_snippets) */
  snippets: z.array(z.lazy(() => ContextSnippetSchema)).optional(),
});

/**
 * Schema for a context snippet showing a matched line with surrounding context
 * Used for content search result expansion
 */
export const ContextSnippetSchema = z.object({
  /** Line number of the match (1-indexed) */
  lineNumber: z.number().int().min(1),
  /** The matched line content */
  line: z.string(),
  /** Up to 2 lines before the match */
  contextBefore: z.array(z.string()),
  /** Up to 2 lines after the match */
  contextAfter: z.array(z.string()),
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
 * Client requests inspiration (contextual prompt and quote)
 */
export const GetInspirationMessageSchema = z.object({
  type: z.literal("get_inspiration"),
});

/**
 * Client requests to write content to a markdown file in the vault
 * Path is relative to vault root and must end with .md
 */
export const WriteFileMessageSchema = z.object({
  type: z.literal("write_file"),
  path: z.string().min(1, "File path is required"),
  content: z.string(), // Empty string is valid (clearing file)
});

/**
 * Client requests task list from configured directories
 */
export const GetTasksMessageSchema = z.object({
  type: z.literal("get_tasks"),
});

/**
 * Client requests to toggle a task's checkbox state.
 * If newState is provided, sets task to that state directly.
 * Otherwise cycles through states: ' ' -> 'x' -> '/' -> '?' -> 'b' -> 'f' -> ' '
 */
export const ToggleTaskMessageSchema = z.object({
  type: z.literal("toggle_task"),
  filePath: z.string().min(1, "File path is required"),
  lineNumber: z.number().int().min(1, "Line number must be at least 1"),
  /** Optional: set task to this specific state instead of cycling */
  newState: z.string().length(1, "State must be a single character").optional(),
});

/**
 * Client requests to delete a session
 */
export const DeleteSessionMessageSchema = z.object({
  type: z.literal("delete_session"),
  sessionId: z.string().min(1, "Session ID is required"),
});

/**
 * Client responds to a tool permission request
 * Sent in response to tool_permission_request from server
 */
export const ToolPermissionResponseMessageSchema = z.object({
  type: z.literal("tool_permission_response"),
  /** The tool use ID from the permission request */
  toolUseId: z.string().min(1, "Tool use ID is required"),
  /** Whether the user allows the tool to run */
  allowed: z.boolean(),
});

/**
 * Client requests to run vault setup (install commands, create PARA dirs, update CLAUDE.md)
 */
export const SetupVaultMessageSchema = z.object({
  type: z.literal("setup_vault"),
  vaultId: z.string().min(1, "Vault ID is required"),
});

/**
 * Client requests file name search with fuzzy matching
 * Results are sorted by match quality score
 */
export const SearchFilesMessageSchema = z.object({
  type: z.literal("search_files"),
  query: z.string().min(1, "Search query is required"),
  /** Maximum number of results to return (default: 50) */
  limit: z.number().int().positive().optional(),
});

/**
 * Client requests content search across markdown files
 * Results show files with match counts
 */
export const SearchContentMessageSchema = z.object({
  type: z.literal("search_content"),
  query: z.string().min(1, "Search query is required"),
  /** Maximum number of results to return (default: 50) */
  limit: z.number().int().positive().optional(),
});

/**
 * Client requests context snippets for a specific file in content search results
 * Used for lazy loading of match context when expanding a result
 */
export const GetSnippetsMessageSchema = z.object({
  type: z.literal("get_snippets"),
  /** File path to get snippets for */
  path: z.string().min(1, "File path is required"),
  /** Original search query to find matches */
  query: z.string().min(1, "Search query is required"),
});

/**
 * Client requests to delete a file from the vault
 * Path is relative to vault content root
 */
export const DeleteFileMessageSchema = z.object({
  type: z.literal("delete_file"),
  path: z.string().min(1, "File path is required"),
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
  GetInspirationMessageSchema,
  WriteFileMessageSchema,
  GetTasksMessageSchema,
  ToggleTaskMessageSchema,
  DeleteSessionMessageSchema,
  ToolPermissionResponseMessageSchema,
  SetupVaultMessageSchema,
  SearchFilesMessageSchema,
  SearchContentMessageSchema,
  GetSnippetsMessageSchema,
  DeleteFileMessageSchema,
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
  slashCommands: z.array(SlashCommandSchema).optional(), // Available slash commands
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
 * Schema for an inspiration item (used for both contextual prompts and quotes)
 */
export const InspirationItemSchema = z.object({
  text: z.string().min(1, "Inspiration text is required"),
  attribution: z.string().optional(),
});

/**
 * Server sends inspiration (contextual prompt and quote)
 * contextual is null if the prompts file is missing/empty
 */
export const InspirationMessageSchema = z.object({
  type: z.literal("inspiration"),
  contextual: InspirationItemSchema.nullable(),
  quote: InspirationItemSchema,
});

/**
 * Server confirms file was written successfully
 */
export const FileWrittenMessageSchema = z.object({
  type: z.literal("file_written"),
  path: z.string().min(1, "File path is required"),
  success: z.literal(true),
});

/**
 * Server sends task list from configured directories
 */
export const TasksMessageSchema = z.object({
  type: z.literal("tasks"),
  tasks: z.array(TaskEntrySchema),
  /** Count of incomplete tasks (state = ' ') for rollup display */
  incomplete: z.number().int().min(0),
  /** Total task count for rollup display */
  total: z.number().int().min(0),
});

/**
 * Server confirms task toggle was successful
 */
export const TaskToggledMessageSchema = z.object({
  type: z.literal("task_toggled"),
  filePath: z.string().min(1, "File path is required"),
  lineNumber: z.number().int().min(1, "Line number must be at least 1"),
  /** The new checkbox state character after toggle */
  newState: z.string().length(1, "State must be a single character"),
});

/**
 * Server confirms session was deleted successfully
 */
export const SessionDeletedMessageSchema = z.object({
  type: z.literal("session_deleted"),
  sessionId: z.string().min(1, "Session ID is required"),
});

/**
 * Server requests permission from the user before running a tool
 * The client should display a dialog and respond with tool_permission_response
 */
export const ToolPermissionRequestMessageSchema = z.object({
  type: z.literal("tool_permission_request"),
  /** Unique identifier for this tool invocation */
  toolUseId: z.string().min(1, "Tool use ID is required"),
  /** Name of the tool being requested */
  toolName: z.string().min(1, "Tool name is required"),
  /** Tool input parameters for user review */
  input: z.unknown(),
});

/**
 * Server reports vault setup completion (commands installed, PARA created, CLAUDE.md updated)
 */
export const SetupCompleteMessageSchema = z.object({
  type: z.literal("setup_complete"),
  vaultId: z.string().min(1, "Vault ID is required"),
  success: z.boolean(),
  /** Human-readable summary of actions taken */
  summary: z.array(z.string()),
  /** Details of any errors that occurred during setup */
  errors: z.array(z.string()).optional(),
});

/**
 * Server sends search results (for both file name and content search)
 * Query is echoed back for client-side correlation with requests
 */
export const SearchResultsMessageSchema = z.object({
  type: z.literal("search_results"),
  /** Search mode: 'files' for file name search, 'content' for full-text search */
  mode: z.enum(["files", "content"]),
  /** Original query (echoed for correlation) */
  query: z.string(),
  /** Search results (type depends on mode) */
  results: z.union([
    z.array(FileSearchResultSchema),
    z.array(ContentSearchResultSchema),
  ]),
  /** Total matches before limit was applied */
  totalMatches: z.number().int().min(0),
  /** Search execution time in milliseconds (for monitoring) */
  searchTimeMs: z.number().min(0),
});

/**
 * Server sends context snippets for a specific file
 * Response to get_snippets request
 */
export const SnippetsMessageSchema = z.object({
  type: z.literal("snippets"),
  /** File path the snippets are from */
  path: z.string().min(1, "File path is required"),
  /** Context snippets showing matched lines */
  snippets: z.array(ContextSnippetSchema),
});

/**
 * Server reports index building progress for large vaults
 * Sent during initial index build or rebuild
 */
export const IndexProgressMessageSchema = z.object({
  type: z.literal("index_progress"),
  /** Current indexing stage */
  stage: z.enum(["scanning", "indexing", "complete"]),
  /** Number of files processed so far */
  filesProcessed: z.number().int().min(0),
  /** Total number of files to process */
  totalFiles: z.number().int().min(0),
});

/**
 * Server confirms file was deleted successfully
 */
export const FileDeletedMessageSchema = z.object({
  type: z.literal("file_deleted"),
  path: z.string().min(1, "File path is required"),
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
  InspirationMessageSchema,
  FileWrittenMessageSchema,
  TasksMessageSchema,
  TaskToggledMessageSchema,
  SessionDeletedMessageSchema,
  ToolPermissionRequestMessageSchema,
  SetupCompleteMessageSchema,
  SearchResultsMessageSchema,
  SnippetsMessageSchema,
  IndexProgressMessageSchema,
  FileDeletedMessageSchema,
]);

// =============================================================================
// Inferred TypeScript Types
// =============================================================================

// File browser types
export type FileEntry = z.infer<typeof FileEntrySchema>;

// Task types
export type TaskEntry = z.infer<typeof TaskEntrySchema>;

// Recent notes types
export type RecentNoteEntry = z.infer<typeof RecentNoteEntrySchema>;

// Recent discussion types
export type RecentDiscussionEntry = z.infer<typeof RecentDiscussionEntrySchema>;

// Slash command type
export type SlashCommand = z.infer<typeof SlashCommandSchema>;

// Tool invocation type
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;

// Conversation message type
export type ConversationMessageProtocol = z.infer<typeof ConversationMessageSchema>;

// Search result types
export type FileSearchResult = z.infer<typeof FileSearchResultSchema>;
export type ContentSearchResult = z.infer<typeof ContentSearchResultSchema>;
export type ContextSnippet = z.infer<typeof ContextSnippetSchema>;

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
export type GetInspirationMessage = z.infer<typeof GetInspirationMessageSchema>;
export type WriteFileMessage = z.infer<typeof WriteFileMessageSchema>;
export type GetTasksMessage = z.infer<typeof GetTasksMessageSchema>;
export type ToggleTaskMessage = z.infer<typeof ToggleTaskMessageSchema>;
export type DeleteSessionMessage = z.infer<typeof DeleteSessionMessageSchema>;
export type ToolPermissionResponseMessage = z.infer<typeof ToolPermissionResponseMessageSchema>;
export type SetupVaultMessage = z.infer<typeof SetupVaultMessageSchema>;
export type SearchFilesMessage = z.infer<typeof SearchFilesMessageSchema>;
export type SearchContentMessage = z.infer<typeof SearchContentMessageSchema>;
export type GetSnippetsMessage = z.infer<typeof GetSnippetsMessageSchema>;
export type DeleteFileMessage = z.infer<typeof DeleteFileMessageSchema>;
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
export type InspirationItem = z.infer<typeof InspirationItemSchema>;
export type InspirationMessage = z.infer<typeof InspirationMessageSchema>;
export type FileWrittenMessage = z.infer<typeof FileWrittenMessageSchema>;
export type TasksMessage = z.infer<typeof TasksMessageSchema>;
export type TaskToggledMessage = z.infer<typeof TaskToggledMessageSchema>;
export type SessionDeletedMessage = z.infer<typeof SessionDeletedMessageSchema>;
export type ToolPermissionRequestMessage = z.infer<typeof ToolPermissionRequestMessageSchema>;
export type SetupCompleteMessage = z.infer<typeof SetupCompleteMessageSchema>;
export type SearchResultsMessage = z.infer<typeof SearchResultsMessageSchema>;
export type SnippetsMessage = z.infer<typeof SnippetsMessageSchema>;
export type IndexProgressMessage = z.infer<typeof IndexProgressMessageSchema>;
export type FileDeletedMessage = z.infer<typeof FileDeletedMessageSchema>;
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

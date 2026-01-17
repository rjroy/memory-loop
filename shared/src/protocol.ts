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

/**
 * Schema for Badge with strict validation for editable config.
 * Used when validating user input for badge editing (max 20 chars).
 */
export const EditableBadgeSchema = z.object({
  text: z.string().min(1, "Badge text is required").max(20, "Badge text must be 20 characters or less"),
  color: BadgeColorSchema,
});

// =============================================================================
// Editable Vault Config Schema
// =============================================================================

/**
 * Schema for discussion model selection - the three Claude model tiers
 */
export const DiscussionModelSchema = z.enum(["opus", "sonnet", "haiku"]);

/**
 * Schema for editable vault configuration fields.
 * All fields are optional to support partial updates.
 * Constraints match the spec requirements.
 */
export const EditableVaultConfigSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  discussionModel: DiscussionModelSchema.optional(),
  promptsPerGeneration: z.number().int().min(1).max(20).optional(),
  maxPoolSize: z.number().int().min(10).max(200).optional(),
  quotesPerWeek: z.number().int().min(0).max(7).optional(),
  recentCaptures: z.number().int().min(1).max(20).optional(),
  recentDiscussions: z.number().int().min(1).max(20).optional(),
  badges: z.array(EditableBadgeSchema).max(5).optional(),
  order: z.number().int().min(1).optional(),
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
  hasSyncConfig: z.boolean(),
  discussionModel: DiscussionModelSchema.optional(),
  promptsPerGeneration: z.number().int().positive(),
  maxPoolSize: z.number().int().positive(),
  quotesPerWeek: z.number().int().positive(),
  recentCaptures: z.number().int().positive().optional(),
  recentDiscussions: z.number().int().positive().optional(),
  badges: z.array(BadgeSchema),
  order: z.number(), // Can be Infinity for unset vaults
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
 * Schema for task category - indicates which directory the task was found in
 */
export const TaskCategorySchema = z.enum(["inbox", "projects", "areas"]);

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
  /** Category indicating source directory (inbox, projects, or areas) */
  category: TaskCategorySchema,
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
  contextUsage: z.number().min(0).max(100).optional(),
  durationMs: z.number().int().min(0).optional(),
});

// =============================================================================
// Widget Display Schemas
// =============================================================================

/**
 * Display types for widgets (REQ-F-18).
 * - summary-card: Key-value pairs for collection stats
 * - table: Rows/columns for ranked lists
 * - list: Ordered items for similar items
 * - meter: Single value with scale (e.g., HEPCAT score)
 */
export const WidgetDisplayTypeSchema = z.enum(["summary-card", "table", "list", "meter"]);

/**
 * Widget type schema for computation type (REQ-F-4).
 * - aggregate: Collection-level statistics (sum, avg, count, etc.)
 * - similarity: Per-item similarity ranking against other items
 */
export const WidgetTypeSchema = z.enum(["aggregate", "similarity"]);

/**
 * Widget location schema (REQ-F-16, REQ-F-17).
 * - ground: Appears on Home/Ground view (global dashboard)
 * - recall: Appears on Browse/Recall view when viewing a matching file
 */
export const WidgetLocationSchema = z.enum(["ground", "recall"]);

/**
 * Display configuration for widget rendering.
 * Type-specific fields are validated at runtime.
 */
export const WidgetDisplayConfigSchema = z.object({
  /** Display component type */
  type: WidgetDisplayTypeSchema,
  /** Optional custom title (defaults to widget name) */
  title: z.string().optional(),
  /** Column names for table display */
  columns: z.array(z.string()).optional(),
  /** Maximum items for list display */
  limit: z.number().int().positive().optional(),
  /** Minimum value for meter display */
  min: z.number().optional(),
  /** Maximum value for meter display */
  max: z.number().optional(),
});

/**
 * Input types for editable frontmatter fields (REQ-F-20).
 */
export const WidgetEditableTypeSchema = z.enum(["slider", "number", "text", "date", "select"]);

/**
 * Configuration for an editable frontmatter field (REQ-F-20, REQ-F-21).
 * Widgets can declare editable fields that users can modify.
 */
export const WidgetEditableFieldSchema = z.object({
  /** Frontmatter field path to edit (e.g., "rating" or "status") */
  field: z.string().min(1, "Editable field path is required"),
  /** Input type for editing */
  type: WidgetEditableTypeSchema,
  /** User-facing label for the input */
  label: z.string().min(1, "Editable field label is required"),
  /** Options for select type */
  options: z.array(z.string()).optional(),
  /** Minimum value for slider/number types */
  min: z.number().optional(),
  /** Maximum value for slider/number types */
  max: z.number().optional(),
  /** Step increment for slider/number types */
  step: z.number().positive().optional(),
  /** Current value of the field (populated at runtime) */
  currentValue: z.unknown().optional(),
});

/**
 * Widget computation result (TD-13, REQ-F-27).
 * Represents the computed output of a widget for display.
 */
export const WidgetResultSchema = z.object({
  /** Unique identifier for the widget */
  widgetId: z.string().min(1, "Widget ID is required"),
  /** Human-readable widget name */
  name: z.string().min(1, "Widget name is required"),
  /** Computation type */
  type: WidgetTypeSchema,
  /** Display location */
  location: WidgetLocationSchema,
  /** Display configuration */
  display: WidgetDisplayConfigSchema,
  /** Computed data (structure depends on widget type) */
  data: z.unknown(),
  /** True when glob matches zero files (REQ-F-27) */
  isEmpty: z.boolean(),
  /** Reason for empty state (e.g., "No files match pattern") */
  emptyReason: z.string().optional(),
  /** Optional editable fields (REQ-F-20) */
  editable: z.array(WidgetEditableFieldSchema).optional(),
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

// =============================================================================
// Meeting Capture Schemas
// =============================================================================

/**
 * Schema for active meeting state sent from server to client.
 * Tracks the current meeting session if one is active.
 */
export const MeetingStateSchema = z.object({
  /** Whether a meeting is currently active */
  isActive: z.boolean(),
  /** Meeting title (set when meeting started) */
  title: z.string().optional(),
  /** Path to the meeting file (relative to content root) */
  filePath: z.string().optional(),
  /** ISO 8601 timestamp when meeting started */
  startedAt: z.string().optional(),
});

/**
 * Client requests to start a meeting capture session.
 * Creates a new meeting file and routes subsequent captures there.
 */
export const StartMeetingMessageSchema = z.object({
  type: z.literal("start_meeting"),
  /** Meeting title (used in filename and frontmatter) */
  title: z.string().min(1, "Meeting title is required"),
});

/**
 * Client requests to stop the current meeting capture session.
 * Returns to normal daily note capture mode.
 */
export const StopMeetingMessageSchema = z.object({
  type: z.literal("stop_meeting"),
});

/**
 * Client requests current meeting state.
 * Used to sync state after reconnection.
 */
export const GetMeetingStateMessageSchema = z.object({
  type: z.literal("get_meeting_state"),
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

// =============================================================================
// AskUserQuestion Schemas
// =============================================================================

/**
 * Schema for a single option in an AskUserQuestion question
 */
export const AskUserQuestionOptionSchema = z.object({
  /** Display text for this option */
  label: z.string().min(1, "Option label is required"),
  /** Description explaining what this option means */
  description: z.string(),
});

/**
 * Schema for a single question in an AskUserQuestion request
 */
export const AskUserQuestionItemSchema = z.object({
  /** The full question text to display */
  question: z.string().min(1, "Question text is required"),
  /** Short label for the question (max 12 chars) */
  header: z.string().max(12, "Header must be 12 characters or less"),
  /** Available choices (2-4 options) */
  options: z.array(AskUserQuestionOptionSchema).min(2).max(4),
  /** If true, users can select multiple options */
  multiSelect: z.boolean(),
});

/**
 * Client responds to an AskUserQuestion request
 * Sent in response to ask_user_question_request from server
 */
export const AskUserQuestionResponseMessageSchema = z.object({
  type: z.literal("ask_user_question_response"),
  /** The tool use ID from the request */
  toolUseId: z.string().min(1, "Tool use ID is required"),
  /** Map of question text to selected answer(s) */
  answers: z.record(z.string(), z.string()),
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
 * Client requests to archive a directory from the vault
 * Path is relative to vault content root
 * Only valid for: chats directory, project directories, area directories
 */
export const ArchiveFileMessageSchema = z.object({
  type: z.literal("archive_file"),
  path: z.string().min(1, "File path is required"),
});

/**
 * Client requests to create a new directory in the vault
 * Path is relative to vault content root (parent directory)
 * Name must be alphanumeric with - and _ only
 */
export const CreateDirectoryMessageSchema = z.object({
  type: z.literal("create_directory"),
  path: z.string(), // Parent directory path (empty string for root)
  name: z.string().min(1, "Directory name is required").regex(/^[a-zA-Z0-9_-]+$/, "Directory name must be alphanumeric with - and _ only"),
});

/**
 * Client requests to create a new markdown file in the vault
 * Path is relative to vault content root (parent directory)
 * Name must be alphanumeric with - and _ only (extension added automatically)
 */
export const CreateFileMessageSchema = z.object({
  type: z.literal("create_file"),
  path: z.string(), // Parent directory path (empty string for root)
  name: z.string().min(1, "File name is required").regex(/^[a-zA-Z0-9_-]+$/, "File name must be alphanumeric with - and _ only"),
});

/**
 * Client requests to rename a file or directory in the vault
 * Path is the current path relative to vault content root
 * NewName is the new name (alphanumeric with - and _ only)
 * For files, the extension is preserved automatically
 */
export const RenameFileMessageSchema = z.object({
  type: z.literal("rename_file"),
  path: z.string().min(1, "File path is required"),
  newName: z.string().min(1, "New name is required").regex(/^[a-zA-Z0-9_-]+$/, "New name must be alphanumeric with - and _ only"),
});

/**
 * Client requests to move a file or directory to a new location in the vault
 * Path is the current path relative to vault content root
 * NewPath is the destination path relative to vault content root
 * References in markdown files will be updated automatically
 */
export const MoveFileMessageSchema = z.object({
  type: z.literal("move_file"),
  path: z.string().min(1, "File path is required"),
  newPath: z.string().min(1, "New path is required"),
});

/**
 * Client requests ground widgets for current vault (REQ-F-16).
 * Ground widgets appear on the Home/Ground view.
 */
export const GetGroundWidgetsMessageSchema = z.object({
  type: z.literal("get_ground_widgets"),
});

/**
 * Client requests recall widgets for a specific file (REQ-F-17).
 * Recall widgets appear on the Browse/Recall view when viewing a matching file.
 */
export const GetRecallWidgetsMessageSchema = z.object({
  type: z.literal("get_recall_widgets"),
  /** Path to the file being viewed (relative to content root) */
  path: z.string().min(1, "File path is required"),
});

/**
 * Client requests to edit a frontmatter field via widget (REQ-F-20, REQ-F-21, REQ-F-22).
 * The edit modifies a single frontmatter field in the source file.
 */
export const WidgetEditMessageSchema = z.object({
  type: z.literal("widget_edit"),
  /** File path (relative to content root) */
  path: z.string().min(1, "File path is required"),
  /** Frontmatter field path (dot-notation, e.g., "rating" or "bgg.play_count") */
  field: z.string().min(1, "Field path is required"),
  /** New value for the field */
  value: z.unknown(),
});

/**
 * Client requests to dismiss a health issue.
 * Dismissed issues won't reappear until vault is reselected.
 */
export const DismissHealthIssueMessageSchema = z.object({
  type: z.literal("dismiss_health_issue"),
  /** ID of the issue to dismiss */
  issueId: z.string().min(1, "Issue ID is required"),
});

/**
 * Client requests pinned assets for current vault
 * Returns paths stored in .memory-loop.json
 */
export const GetPinnedAssetsMessageSchema = z.object({
  type: z.literal("get_pinned_assets"),
});

/**
 * Client updates pinned assets for current vault
 * Saves paths to .memory-loop.json
 */
export const SetPinnedAssetsMessageSchema = z.object({
  type: z.literal("set_pinned_assets"),
  /** Array of paths (relative to content root) to pin */
  paths: z.array(z.string()),
});

/**
 * Client requests to update vault configuration.
 * Partial updates are supported (only provided fields are updated).
 */
export const UpdateVaultConfigMessageSchema = z.object({
  type: z.literal("update_vault_config"),
  /** Configuration fields to update */
  config: EditableVaultConfigSchema,
  /** Optional vault ID for editing before vault selection (VaultSelect use case) */
  vaultId: z.string().optional(),
});

/**
 * Client triggers sync of external data pipelines (REQ-F-16, REQ-F-17).
 * Manual trigger only - no automatic/scheduled sync.
 */
export const TriggerSyncMessageSchema = z.object({
  type: z.literal("trigger_sync"),
  /** Sync mode: full re-syncs all files, incremental skips recently synced */
  mode: z.enum(["full", "incremental"]),
  /** Optional specific pipeline name; if omitted, all pipelines run */
  pipeline: z.string().optional(),
});

/**
 * Client requests to create a new vault.
 * The title will be converted to a safe directory name.
 */
export const CreateVaultMessageSchema = z.object({
  type: z.literal("create_vault"),
  /** User-provided vault title (will become CLAUDE.md heading) */
  title: z.string().min(1, "Vault title is required"),
});

/**
 * Discriminated union of all client message types
 */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  SelectVaultMessageSchema,
  CaptureNoteMessageSchema,
  StartMeetingMessageSchema,
  StopMeetingMessageSchema,
  GetMeetingStateMessageSchema,
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
  AskUserQuestionResponseMessageSchema,
  SetupVaultMessageSchema,
  SearchFilesMessageSchema,
  SearchContentMessageSchema,
  GetSnippetsMessageSchema,
  DeleteFileMessageSchema,
  ArchiveFileMessageSchema,
  CreateDirectoryMessageSchema,
  CreateFileMessageSchema,
  RenameFileMessageSchema,
  MoveFileMessageSchema,
  GetGroundWidgetsMessageSchema,
  GetRecallWidgetsMessageSchema,
  WidgetEditMessageSchema,
  DismissHealthIssueMessageSchema,
  GetPinnedAssetsMessageSchema,
  SetPinnedAssetsMessageSchema,
  UpdateVaultConfigMessageSchema,
  TriggerSyncMessageSchema,
  CreateVaultMessageSchema,
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

// =============================================================================
// Meeting Server Messages
// =============================================================================

/**
 * Server confirms meeting has started.
 * Client should switch to meeting capture mode.
 */
export const MeetingStartedMessageSchema = z.object({
  type: z.literal("meeting_started"),
  /** Meeting title */
  title: z.string().min(1, "Meeting title is required"),
  /** Path to the meeting file (relative to content root) */
  filePath: z.string().min(1, "File path is required"),
  /** ISO 8601 timestamp when meeting started */
  startedAt: z.string().min(1, "Start time is required"),
});

/**
 * Server confirms meeting has stopped.
 * Includes the file content for Claude Code integration.
 */
export const MeetingStoppedMessageSchema = z.object({
  type: z.literal("meeting_stopped"),
  /** Path to the meeting file (relative to content root) */
  filePath: z.string().min(1, "File path is required"),
  /** Full content of the meeting file for Claude Code */
  content: z.string(),
  /** Number of entries captured during the meeting */
  entryCount: z.number().int().min(0),
});

/**
 * Server sends current meeting state.
 * Response to get_meeting_state request or sent on vault selection.
 */
export const MeetingStateMessageSchema = z.object({
  type: z.literal("meeting_state"),
  /** Current meeting state */
  state: MeetingStateSchema,
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
  contextUsage: z.number().min(0).max(100).optional(),
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
 * Server sends goals from the vault's goals.md file
 * Returns null for content if the file doesn't exist
 */
export const GoalsMessageSchema = z.object({
  type: z.literal("goals"),
  content: z.string().nullable(),
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
 * Server requests user input via AskUserQuestion tool
 * The client should display a multi-question dialog and respond with ask_user_question_response
 */
export const AskUserQuestionRequestMessageSchema = z.object({
  type: z.literal("ask_user_question_request"),
  /** Unique identifier for this tool invocation */
  toolUseId: z.string().min(1, "Tool use ID is required"),
  /** Array of questions to present to the user (1-4 questions) */
  questions: z.array(AskUserQuestionItemSchema).min(1).max(4),
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
 * Server confirms directory was archived successfully
 */
export const FileArchivedMessageSchema = z.object({
  type: z.literal("file_archived"),
  /** Original path that was archived */
  path: z.string().min(1, "File path is required"),
  /** Destination path in archive */
  archivePath: z.string().min(1, "Archive path is required"),
});

/**
 * Server confirms directory was created successfully
 */
export const DirectoryCreatedMessageSchema = z.object({
  type: z.literal("directory_created"),
  /** Full path of the created directory (relative to content root) */
  path: z.string().min(1, "Directory path is required"),
});

/**
 * Server confirms file was created successfully
 */
export const FileCreatedMessageSchema = z.object({
  type: z.literal("file_created"),
  /** Full path of the created file (relative to content root) */
  path: z.string().min(1, "File path is required"),
});

/**
 * Server confirms file or directory was renamed successfully
 */
export const FileRenamedMessageSchema = z.object({
  type: z.literal("file_renamed"),
  /** Original path (relative to content root) */
  oldPath: z.string().min(1, "Old path is required"),
  /** New path (relative to content root) */
  newPath: z.string().min(1, "New path is required"),
  /** Number of references updated in .md files */
  referencesUpdated: z.number().int().min(0),
});

/**
 * Server confirms file or directory was moved successfully
 */
export const FileMovedMessageSchema = z.object({
  type: z.literal("file_moved"),
  /** Original path (relative to content root) */
  oldPath: z.string().min(1, "Old path is required"),
  /** New path (relative to content root) */
  newPath: z.string().min(1, "New path is required"),
  /** Number of references updated in .md files */
  referencesUpdated: z.number().int().min(0),
});

/**
 * Server sends ground widgets for the current vault (REQ-F-16).
 * Response to get_ground_widgets request.
 */
export const GroundWidgetsMessageSchema = z.object({
  type: z.literal("ground_widgets"),
  /** Array of computed widget results for Home/Ground view */
  widgets: z.array(WidgetResultSchema),
});

/**
 * Server sends recall widgets for a specific file (REQ-F-17).
 * Response to get_recall_widgets request.
 */
export const RecallWidgetsMessageSchema = z.object({
  type: z.literal("recall_widgets"),
  /** Path to the file these widgets are for */
  path: z.string().min(1, "File path is required"),
  /** Array of computed widget results for Browse/Recall view */
  widgets: z.array(WidgetResultSchema),
});

/**
 * Server sends updated widgets after edit or file change (REQ-F-22).
 * Pushed to client when widget recomputation completes.
 */
export const WidgetUpdateMessageSchema = z.object({
  type: z.literal("widget_update"),
  /** Updated widget results */
  widgets: z.array(WidgetResultSchema),
});

/**
 * Server reports a widget configuration or computation error (REQ-F-3).
 * Sent when widget config is invalid or computation fails.
 */
export const WidgetErrorMessageSchema = z.object({
  type: z.literal("widget_error"),
  /** Optional widget ID if error is specific to one widget */
  widgetId: z.string().optional(),
  /** Human-readable error message */
  error: z.string().min(1, "Error message is required"),
  /** Optional file path if error is specific to a file */
  filePath: z.string().optional(),
});

// =============================================================================
// Health Reporting Schemas
// =============================================================================

/**
 * Severity level for health issues.
 * - error: Blocking issues that prevent functionality
 * - warning: Degraded functionality (partial success)
 */
export const HealthSeveritySchema = z.enum(["error", "warning"]);

/**
 * Category for health issues, used for grouping and filtering.
 */
export const HealthCategorySchema = z.enum([
  "widget_config",   // Widget YAML parse/validation errors
  "widget_compute",  // Widget computation failures
  "vault_config",    // .memory-loop.json issues
  "file_watcher",    // File watcher issues
  "cache",           // Cache failures
  "sync",            // External data sync failures
  "general",         // Other issues
]);

/**
 * Individual health issue reported by the backend.
 */
export const HealthIssueSchema = z.object({
  /** Unique identifier for dismissal */
  id: z.string().min(1, "Issue ID is required"),
  /** Severity level */
  severity: HealthSeveritySchema,
  /** Issue category */
  category: HealthCategorySchema,
  /** Human-readable error message */
  message: z.string().min(1, "Message is required"),
  /** Technical details (file path, stack trace, etc.) */
  details: z.string().optional(),
  /** When the issue was reported (ISO 8601) */
  timestamp: z.string().min(1, "Timestamp is required"),
  /** Whether user can dismiss this issue */
  dismissible: z.boolean(),
});

/**
 * Server sends health report with all current issues.
 * Sent on vault selection and when issues change.
 */
export const HealthReportMessageSchema = z.object({
  type: z.literal("health_report"),
  /** Array of current health issues */
  issues: z.array(HealthIssueSchema),
});

/**
 * Server sends pinned assets for the current vault.
 * Response to get_pinned_assets or set_pinned_assets request.
 */
export const PinnedAssetsMessageSchema = z.object({
  type: z.literal("pinned_assets"),
  /** Array of pinned asset paths (relative to content root) */
  paths: z.array(z.string()),
});

/**
 * Server confirms vault configuration update.
 * Response to update_vault_config request.
 */
export const ConfigUpdatedMessageSchema = z.object({
  type: z.literal("config_updated"),
  /** Whether the update was successful */
  success: z.boolean(),
  /** Error message if success is false */
  error: z.string().optional(),
});

// =============================================================================
// Sync Status Schemas
// =============================================================================

/**
 * Schema for sync status enum values (REQ-F-30, REQ-F-31)
 */
export const SyncStatusValueSchema = z.enum(["idle", "syncing", "success", "error"]);

/**
 * Schema for sync progress information during active sync
 */
export const SyncProgressSchema = z.object({
  /** Number of files processed so far */
  current: z.number().int().min(0),
  /** Total number of files to process */
  total: z.number().int().min(0),
  /** Path of file currently being processed */
  currentFile: z.string().optional(),
});

/**
 * Schema for per-file sync error (REQ-F-32)
 */
export const SyncFileErrorSchema = z.object({
  /** Path of file that failed */
  file: z.string().min(1, "File path is required"),
  /** Error description */
  error: z.string().min(1, "Error message is required"),
});

/**
 * Server sends sync status updates (REQ-F-30, REQ-F-31, REQ-F-32).
 * Sent in response to trigger_sync and during sync progress.
 */
export const SyncStatusMessageSchema = z.object({
  type: z.literal("sync_status"),
  /** Current sync status */
  status: SyncStatusValueSchema,
  /** Progress information when status is "syncing" */
  progress: SyncProgressSchema.optional(),
  /** Summary message (e.g., "Synced 8/10 files") or error description */
  message: z.string().optional(),
  /** Per-file errors when some files failed (REQ-F-32) */
  errors: z.array(SyncFileErrorSchema).optional(),
});

/**
 * Server confirms vault was created successfully.
 * Response to create_vault request.
 */
export const VaultCreatedMessageSchema = z.object({
  type: z.literal("vault_created"),
  /** The newly created vault info */
  vault: VaultInfoSchema,
});

/**
 * Discriminated union of all server message types
 */
export const ServerMessageSchema = z.discriminatedUnion("type", [
  VaultListMessageSchema,
  SessionReadyMessageSchema,
  NoteCapturedMessageSchema,
  MeetingStartedMessageSchema,
  MeetingStoppedMessageSchema,
  MeetingStateMessageSchema,
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
  AskUserQuestionRequestMessageSchema,
  SetupCompleteMessageSchema,
  SearchResultsMessageSchema,
  SnippetsMessageSchema,
  IndexProgressMessageSchema,
  FileDeletedMessageSchema,
  FileArchivedMessageSchema,
  DirectoryCreatedMessageSchema,
  FileCreatedMessageSchema,
  FileRenamedMessageSchema,
  FileMovedMessageSchema,
  GroundWidgetsMessageSchema,
  RecallWidgetsMessageSchema,
  WidgetUpdateMessageSchema,
  WidgetErrorMessageSchema,
  HealthReportMessageSchema,
  PinnedAssetsMessageSchema,
  ConfigUpdatedMessageSchema,
  SyncStatusMessageSchema,
  VaultCreatedMessageSchema,
]);

// =============================================================================
// Inferred TypeScript Types
// =============================================================================

// File browser types
export type FileEntry = z.infer<typeof FileEntrySchema>;

// Task types
export type TaskCategory = z.infer<typeof TaskCategorySchema>;
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

// Widget types
export type WidgetDisplayType = z.infer<typeof WidgetDisplayTypeSchema>;
export type WidgetType = z.infer<typeof WidgetTypeSchema>;
export type WidgetLocation = z.infer<typeof WidgetLocationSchema>;
export type WidgetDisplayConfig = z.infer<typeof WidgetDisplayConfigSchema>;
export type WidgetEditableType = z.infer<typeof WidgetEditableTypeSchema>;
export type WidgetEditableField = z.infer<typeof WidgetEditableFieldSchema>;
export type WidgetResult = z.infer<typeof WidgetResultSchema>;

// Health types
export type HealthSeverity = z.infer<typeof HealthSeveritySchema>;
export type HealthCategory = z.infer<typeof HealthCategorySchema>;
export type HealthIssue = z.infer<typeof HealthIssueSchema>;
export type HealthReportMessage = z.infer<typeof HealthReportMessageSchema>;

// Badge types
export type Badge = z.infer<typeof BadgeSchema>;
export type BadgeColor = z.infer<typeof BadgeColorSchema>;
export type EditableBadge = z.infer<typeof EditableBadgeSchema>;

// Vault config types
export type DiscussionModel = z.infer<typeof DiscussionModelSchema>;
export type EditableVaultConfig = z.infer<typeof EditableVaultConfigSchema>;

// Meeting types
export type MeetingState = z.infer<typeof MeetingStateSchema>;

// Client message types
export type SelectVaultMessage = z.infer<typeof SelectVaultMessageSchema>;
export type CaptureNoteMessage = z.infer<typeof CaptureNoteMessageSchema>;
export type StartMeetingMessage = z.infer<typeof StartMeetingMessageSchema>;
export type StopMeetingMessage = z.infer<typeof StopMeetingMessageSchema>;
export type GetMeetingStateMessage = z.infer<typeof GetMeetingStateMessageSchema>;
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
export type AskUserQuestionOption = z.infer<typeof AskUserQuestionOptionSchema>;
export type AskUserQuestionItem = z.infer<typeof AskUserQuestionItemSchema>;
export type AskUserQuestionResponseMessage = z.infer<typeof AskUserQuestionResponseMessageSchema>;
export type SetupVaultMessage = z.infer<typeof SetupVaultMessageSchema>;
export type SearchFilesMessage = z.infer<typeof SearchFilesMessageSchema>;
export type SearchContentMessage = z.infer<typeof SearchContentMessageSchema>;
export type GetSnippetsMessage = z.infer<typeof GetSnippetsMessageSchema>;
export type DeleteFileMessage = z.infer<typeof DeleteFileMessageSchema>;
export type ArchiveFileMessage = z.infer<typeof ArchiveFileMessageSchema>;
export type CreateDirectoryMessage = z.infer<typeof CreateDirectoryMessageSchema>;
export type CreateFileMessage = z.infer<typeof CreateFileMessageSchema>;
export type RenameFileMessage = z.infer<typeof RenameFileMessageSchema>;
export type MoveFileMessage = z.infer<typeof MoveFileMessageSchema>;
export type GetGroundWidgetsMessage = z.infer<typeof GetGroundWidgetsMessageSchema>;
export type GetRecallWidgetsMessage = z.infer<typeof GetRecallWidgetsMessageSchema>;
export type WidgetEditMessage = z.infer<typeof WidgetEditMessageSchema>;
export type DismissHealthIssueMessage = z.infer<typeof DismissHealthIssueMessageSchema>;
export type GetPinnedAssetsMessage = z.infer<typeof GetPinnedAssetsMessageSchema>;
export type SetPinnedAssetsMessage = z.infer<typeof SetPinnedAssetsMessageSchema>;
export type UpdateVaultConfigMessage = z.infer<typeof UpdateVaultConfigMessageSchema>;
export type TriggerSyncMessage = z.infer<typeof TriggerSyncMessageSchema>;
export type CreateVaultMessage = z.infer<typeof CreateVaultMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Server message types
export type VaultListMessage = z.infer<typeof VaultListMessageSchema>;
export type SessionReadyMessage = z.infer<typeof SessionReadyMessageSchema>;
export type NoteCapturedMessage = z.infer<typeof NoteCapturedMessageSchema>;
export type MeetingStartedMessage = z.infer<typeof MeetingStartedMessageSchema>;
export type MeetingStoppedMessage = z.infer<typeof MeetingStoppedMessageSchema>;
export type MeetingStateMessage = z.infer<typeof MeetingStateMessageSchema>;
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
export type GoalsMessage = z.infer<typeof GoalsMessageSchema>;
export type InspirationItem = z.infer<typeof InspirationItemSchema>;
export type InspirationMessage = z.infer<typeof InspirationMessageSchema>;
export type FileWrittenMessage = z.infer<typeof FileWrittenMessageSchema>;
export type TasksMessage = z.infer<typeof TasksMessageSchema>;
export type TaskToggledMessage = z.infer<typeof TaskToggledMessageSchema>;
export type SessionDeletedMessage = z.infer<typeof SessionDeletedMessageSchema>;
export type ToolPermissionRequestMessage = z.infer<typeof ToolPermissionRequestMessageSchema>;
export type AskUserQuestionRequestMessage = z.infer<typeof AskUserQuestionRequestMessageSchema>;
export type SetupCompleteMessage = z.infer<typeof SetupCompleteMessageSchema>;
export type SearchResultsMessage = z.infer<typeof SearchResultsMessageSchema>;
export type SnippetsMessage = z.infer<typeof SnippetsMessageSchema>;
export type IndexProgressMessage = z.infer<typeof IndexProgressMessageSchema>;
export type FileDeletedMessage = z.infer<typeof FileDeletedMessageSchema>;
export type FileArchivedMessage = z.infer<typeof FileArchivedMessageSchema>;
export type DirectoryCreatedMessage = z.infer<typeof DirectoryCreatedMessageSchema>;
export type FileCreatedMessage = z.infer<typeof FileCreatedMessageSchema>;
export type FileRenamedMessage = z.infer<typeof FileRenamedMessageSchema>;
export type FileMovedMessage = z.infer<typeof FileMovedMessageSchema>;
export type GroundWidgetsMessage = z.infer<typeof GroundWidgetsMessageSchema>;
export type RecallWidgetsMessage = z.infer<typeof RecallWidgetsMessageSchema>;
export type WidgetUpdateMessage = z.infer<typeof WidgetUpdateMessageSchema>;
export type WidgetErrorMessage = z.infer<typeof WidgetErrorMessageSchema>;
export type PinnedAssetsMessage = z.infer<typeof PinnedAssetsMessageSchema>;
export type ConfigUpdatedMessage = z.infer<typeof ConfigUpdatedMessageSchema>;
export type SyncStatusValue = z.infer<typeof SyncStatusValueSchema>;
export type SyncProgress = z.infer<typeof SyncProgressSchema>;
export type SyncFileError = z.infer<typeof SyncFileErrorSchema>;
export type SyncStatusMessage = z.infer<typeof SyncStatusMessageSchema>;
export type VaultCreatedMessage = z.infer<typeof VaultCreatedMessageSchema>;
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

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
  cardsEnabled: z.boolean().optional(),
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
  discussionModel: DiscussionModelSchema.optional(),
  promptsPerGeneration: z.number().int().positive(),
  maxPoolSize: z.number().int().positive(),
  quotesPerWeek: z.number().int().positive(),
  recentCaptures: z.number().int().positive().optional(),
  recentDiscussions: z.number().int().positive().optional(),
  badges: z.array(BadgeSchema),
  order: z.number(), // Can be Infinity for unset vaults
  cardsEnabled: z.boolean(),
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
// REST API Data Schemas
// =============================================================================

/**
 * Schema for an inspiration item (used for both contextual prompts and quotes).
 * Used by REST API responses.
 */
export const InspirationItemSchema = z.object({
  text: z.string().min(1, "Inspiration text is required"),
  attribution: z.string().optional(),
});

/**
 * Schema for active meeting state.
 * Tracks the current meeting session if one is active.
 * Used by REST API responses.
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

// =============================================================================
// Spaced Repetition Card Schemas
// =============================================================================

/**
 * Valid review responses for spaced repetition cards.
 * Maps to SM-2 algorithm quality ratings:
 * - again: Complete failure (q=0)
 * - hard: Correct but with difficulty (q=3)
 * - good: Correct with some effort (q=4)
 * - easy: Perfect recall (q=5)
 */
export const ReviewResponseSchema = z.enum(["again", "hard", "good", "easy"]);

/**
 * Schema for a due card preview (question only, no answer).
 * Used in GET /cards/due response items.
 */
export const DueCardSchema = z.object({
  /** Unique card identifier (UUID) */
  id: z.string().uuid(),
  /** The question to display */
  question: z.string().min(1, "Question is required"),
  /** ISO 8601 date when card is due for review */
  next_review: z.string(),
  /** Path to the card file (relative to vault, e.g., 06_Metadata/memory-loop/cards/{id}.md) */
  card_file: z.string(),
});

/**
 * Schema for full card detail with answer.
 * Used in GET /cards/:cardId response after revealing answer.
 */
export const CardDetailSchema = z.object({
  /** Unique card identifier (UUID) */
  id: z.string().uuid(),
  /** The question to display */
  question: z.string().min(1, "Question is required"),
  /** The answer to reveal */
  answer: z.string().min(1, "Answer is required"),
  /** SM-2 ease factor (default 2.5, adjusted based on performance) */
  ease_factor: z.number().min(1.3),
  /** Days until next review */
  interval: z.number().int().min(0),
  /** Number of successful reviews in a row */
  repetitions: z.number().int().min(0),
  /** ISO 8601 timestamp of last review, null if never reviewed */
  last_reviewed: z.string().nullable(),
  /** ISO 8601 date when card is due for review */
  next_review: z.string(),
  /** Source file path if card was extracted from a note */
  source_file: z.string().optional(),
});

/**
 * Schema for review request body.
 * Used in POST /cards/:cardId/review request.
 */
export const ReviewRequestSchema = z.object({
  /** User's self-assessment of recall quality */
  response: ReviewResponseSchema,
});

/**
 * Schema for review result response.
 * Used in POST /cards/:cardId/review response.
 */
export const ReviewResultSchema = z.object({
  /** Card identifier */
  id: z.string().uuid(),
  /** Updated next review date (ISO 8601) */
  next_review: z.string(),
  /** Updated interval in days */
  interval: z.number().int().min(0),
  /** Updated ease factor */
  ease_factor: z.number().min(1.3),
});

/**
 * Schema for archive response.
 * Used in POST /cards/:cardId/archive response.
 */
export const ArchiveResponseSchema = z.object({
  /** Card identifier */
  id: z.string().uuid(),
  /** Confirmation that card was archived */
  archived: z.literal(true),
});

/**
 * Schema for due cards list response.
 * Used in GET /cards/due response.
 */
export const DueCardsResponseSchema = z.object({
  /** Array of due card previews */
  cards: z.array(DueCardSchema),
  /** Total count of due cards */
  count: z.number().int().min(0),
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
 * Client requests to dismiss a health issue.
 * Dismissed issues won't reappear until vault is reselected.
 */
export const DismissHealthIssueMessageSchema = z.object({
  type: z.literal("dismiss_health_issue"),
  /** ID of the issue to dismiss */
  issueId: z.string().min(1, "Issue ID is required"),
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

// =============================================================================
// Pair Writing Mode Client Messages
// =============================================================================

/**
 * Action types for Quick Actions (transformative, all platforms)
 * - tighten: Make more concise without losing meaning
 * - embellish: Add detail, nuance, or context
 * - correct: Fix typos and grammar only
 * - polish: Correct + improve prose
 */
export const QuickActionTypeSchema = z.enum(["tighten", "embellish", "correct", "polish"]);

/**
 * Action types for Advisory Actions (Pair Writing Mode, desktop only)
 * - validate: Fact-check the claim
 * - critique: Analyze clarity, voice, structure
 * - compare: Compare current text to snapshot
 * - discuss: Discuss improvements or alternatives
 */
export const AdvisoryActionTypeSchema = z.enum(["validate", "critique", "compare", "discuss"]);

/**
 * Client requests a Quick Action on selected text (all platforms)
 * Claude uses Read/Edit tools to modify the file directly
 */
export const QuickActionRequestMessageSchema = z.object({
  type: z.literal("quick_action_request"),
  /** The action to perform */
  action: QuickActionTypeSchema,
  /** The selected text to transform */
  selection: z.string().min(1, "Selection is required"),
  /** Paragraph before the selection (for context) */
  contextBefore: z.string(),
  /** Paragraph after the selection (for context) */
  contextAfter: z.string(),
  /** Path to the file being edited (relative to content root) */
  filePath: z.string().min(1, "File path is required"),
  /** 1-indexed line number where selection starts */
  selectionStartLine: z.number().int().min(1, "Selection start line must be at least 1"),
  /** 1-indexed line number where selection ends */
  selectionEndLine: z.number().int().min(1, "Selection end line must be at least 1"),
  /** Total lines in the document (for position hint calculation) */
  totalLines: z.number().int().min(1, "Total lines must be at least 1"),
});

/**
 * Client requests an Advisory Action on selected text (Pair Writing Mode, desktop)
 * Response appears in conversation pane; user manually applies changes
 */
export const AdvisoryActionRequestMessageSchema = z.object({
  type: z.literal("advisory_action_request"),
  /** The advisory action to perform */
  action: AdvisoryActionTypeSchema,
  /** The selected text to analyze */
  selection: z.string().min(1, "Selection is required"),
  /** Paragraph before the selection (for context) */
  contextBefore: z.string(),
  /** Paragraph after the selection (for context) */
  contextAfter: z.string(),
  /** Path to the file being edited (relative to content root) */
  filePath: z.string().min(1, "File path is required"),
  /** 1-indexed line number where selection starts */
  selectionStartLine: z.number().int().min(1, "Selection start line must be at least 1"),
  /** 1-indexed line number where selection ends */
  selectionEndLine: z.number().int().min(1, "Selection end line must be at least 1"),
  /** Total lines in the document (for position hint calculation) */
  totalLines: z.number().int().min(1, "Total lines must be at least 1"),
  /** For compare action: the corresponding text from the snapshot */
  snapshotSelection: z.string().optional(),
});

// =============================================================================
// Memory Extraction Client Messages
// =============================================================================

/**
 * Client requests current extraction prompt with override status (REQ-F-15)
 * Response: extraction_prompt_content message
 */
export const GetExtractionPromptMessageSchema = z.object({
  type: z.literal("get_extraction_prompt"),
});

/**
 * Client requests to save extraction prompt (REQ-F-16)
 * Creates user override at ~/.config/memory-loop/extraction-prompt.md if needed
 * Response: extraction_prompt_saved message
 */
export const SaveExtractionPromptMessageSchema = z.object({
  type: z.literal("save_extraction_prompt"),
  /** Updated extraction prompt content */
  content: z.string(),
});

/**
 * Client requests to reset extraction prompt to default (REQ-F-16)
 * Removes user override at ~/.config/memory-loop/extraction-prompt.md
 * Response: extraction_prompt_reset message
 */
export const ResetExtractionPromptMessageSchema = z.object({
  type: z.literal("reset_extraction_prompt"),
});

/**
 * Client requests to manually trigger extraction (for testing/debug)
 * Response: extraction_status messages with progress updates
 */
export const TriggerExtractionMessageSchema = z.object({
  type: z.literal("trigger_extraction"),
});

// =============================================================================
// Card Generator Client Messages
// =============================================================================

/**
 * Client requests current card generator config with requirements override status
 * Response: card_generator_config_content message
 */
export const GetCardGeneratorConfigMessageSchema = z.object({
  type: z.literal("get_card_generator_config"),
});

/**
 * Client requests to save card generator requirements (creates user override)
 * Response: card_generator_requirements_saved message
 */
export const SaveCardGeneratorRequirementsMessageSchema = z.object({
  type: z.literal("save_card_generator_requirements"),
  /** Updated requirements content */
  content: z.string(),
});

/**
 * Client requests to save card generator config (byte limit)
 * Response: card_generator_config_saved message
 */
export const SaveCardGeneratorConfigMessageSchema = z.object({
  type: z.literal("save_card_generator_config"),
  /** Weekly byte limit for card generation */
  weeklyByteLimit: z.number().int().min(102400).max(10485760), // 100KB - 10MB
});

/**
 * Client requests to reset card generator requirements to default
 * Removes user override at ~/.config/memory-loop/card-generator-requirements.md
 * Response: card_generator_requirements_reset message
 */
export const ResetCardGeneratorRequirementsMessageSchema = z.object({
  type: z.literal("reset_card_generator_requirements"),
});

/**
 * Client requests to manually trigger card generation
 * Bypasses "already ran this week" check, uses remaining weekly budget
 * Response: card_generation_status messages with progress updates
 */
export const TriggerCardGenerationMessageSchema = z.object({
  type: z.literal("trigger_card_generation"),
});

/**
 * Client requests current card generation status
 * Response: card_generation_status message
 */
export const GetCardGenerationStatusMessageSchema = z.object({
  type: z.literal("get_card_generation_status"),
});

/**
 * Discriminated union of all client message types
 */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  SelectVaultMessageSchema,
  CreateVaultMessageSchema,
  DiscussionMessageSchema,
  ResumeSessionMessageSchema,
  NewSessionMessageSchema,
  AbortMessageSchema,
  PingMessageSchema,
  ToolPermissionResponseMessageSchema,
  AskUserQuestionResponseMessageSchema,
  DismissHealthIssueMessageSchema,
  // Pair Writing Mode
  QuickActionRequestMessageSchema,
  AdvisoryActionRequestMessageSchema,
  // Memory Extraction
  GetExtractionPromptMessageSchema,
  SaveExtractionPromptMessageSchema,
  ResetExtractionPromptMessageSchema,
  TriggerExtractionMessageSchema,
  // Card Generator
  GetCardGeneratorConfigMessageSchema,
  SaveCardGeneratorRequirementsMessageSchema,
  SaveCardGeneratorConfigMessageSchema,
  ResetCardGeneratorRequirementsMessageSchema,
  TriggerCardGenerationMessageSchema,
  GetCardGenerationStatusMessageSchema,
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
  durationMs: z.number().int().min(0).optional(),
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
  "vault_config",    // .memory-loop.json issues
  "file_watcher",    // File watcher issues
  "cache",           // Cache failures
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
 * Server confirms vault was created successfully.
 * Response to create_vault request.
 */
export const VaultCreatedMessageSchema = z.object({
  type: z.literal("vault_created"),
  /** The newly created vault info */
  vault: VaultInfoSchema,
});

// =============================================================================
// Memory Extraction Schemas
// =============================================================================

/**
 * Schema for extraction status enum values
 * - idle: No extraction running
 * - running: Extraction in progress
 * - complete: Extraction finished successfully
 * - error: Extraction failed
 */
export const ExtractionStatusValueSchema = z.enum(["idle", "running", "complete", "error"]);

/**
 * Server sends extraction prompt content (REQ-F-15)
 * Response to get_extraction_prompt request
 */
export const ExtractionPromptContentMessageSchema = z.object({
  type: z.literal("extraction_prompt_content"),
  /** Extraction prompt content */
  content: z.string(),
  /** True if using user override at ~/.config/memory-loop/extraction-prompt.md */
  isOverride: z.boolean(),
});

/**
 * Server confirms extraction prompt was saved (REQ-F-16)
 * Response to save_extraction_prompt request
 */
export const ExtractionPromptSavedMessageSchema = z.object({
  type: z.literal("extraction_prompt_saved"),
  /** Whether the save was successful */
  success: z.boolean(),
  /** True if this created/updated user override */
  isOverride: z.boolean(),
  /** Error message if success is false */
  error: z.string().optional(),
});

/**
 * Server confirms extraction prompt was reset to default (REQ-F-16)
 * Response to reset_extraction_prompt request
 */
export const ExtractionPromptResetMessageSchema = z.object({
  type: z.literal("extraction_prompt_reset"),
  /** Whether the reset was successful */
  success: z.boolean(),
  /** The default prompt content (sent so UI can update without fetching again) */
  content: z.string(),
  /** Error message if success is false */
  error: z.string().optional(),
});

/**
 * Server sends extraction status updates
 * Sent during extraction run (triggered manually or scheduled)
 */
export const ExtractionStatusMessageSchema = z.object({
  type: z.literal("extraction_status"),
  /** Current extraction status */
  status: ExtractionStatusValueSchema,
  /** Progress percentage (0-100) when status is "running" */
  progress: z.number().min(0).max(100).optional(),
  /** Human-readable status message */
  message: z.string().optional(),
  /** Error details when status is "error" */
  error: z.string().optional(),
  /** Number of transcripts processed (on completion) */
  transcriptsProcessed: z.number().int().min(0).optional(),
  /** Number of facts extracted (on completion) */
  factsExtracted: z.number().int().min(0).optional(),
});

// =============================================================================
// Card Generator Server Messages
// =============================================================================

/**
 * Schema for card generation status enum values
 * - idle: No generation running
 * - running: Generation in progress
 * - complete: Generation finished successfully
 * - error: Generation failed
 */
export const CardGenerationStatusValueSchema = z.enum(["idle", "running", "complete", "error"]);

/**
 * Server sends card generator config content
 * Response to get_card_generator_config request
 */
export const CardGeneratorConfigContentMessageSchema = z.object({
  type: z.literal("card_generator_config_content"),
  /** Requirements prompt content */
  requirements: z.string(),
  /** True if using user override for requirements */
  isOverride: z.boolean(),
  /** Weekly byte limit for card generation */
  weeklyByteLimit: z.number().int().min(0),
  /** Bytes used this week */
  weeklyBytesUsed: z.number().int().min(0),
});

/**
 * Server confirms card generator requirements were saved
 * Response to save_card_generator_requirements request
 */
export const CardGeneratorRequirementsSavedMessageSchema = z.object({
  type: z.literal("card_generator_requirements_saved"),
  /** Whether the save was successful */
  success: z.boolean(),
  /** True if this created/updated user override */
  isOverride: z.boolean(),
  /** Error message if success is false */
  error: z.string().optional(),
});

/**
 * Server confirms card generator config was saved
 * Response to save_card_generator_config request
 */
export const CardGeneratorConfigSavedMessageSchema = z.object({
  type: z.literal("card_generator_config_saved"),
  /** Whether the save was successful */
  success: z.boolean(),
  /** Error message if success is false */
  error: z.string().optional(),
});

/**
 * Server confirms card generator requirements were reset to default
 * Response to reset_card_generator_requirements request
 */
export const CardGeneratorRequirementsResetMessageSchema = z.object({
  type: z.literal("card_generator_requirements_reset"),
  /** Whether the reset was successful */
  success: z.boolean(),
  /** The default requirements content */
  content: z.string(),
  /** Error message if success is false */
  error: z.string().optional(),
});

/**
 * Server sends card generation status updates
 * Sent during generation run (triggered manually or scheduled)
 */
export const CardGenerationStatusMessageSchema = z.object({
  type: z.literal("card_generation_status"),
  /** Current generation status */
  status: CardGenerationStatusValueSchema,
  /** Human-readable status message */
  message: z.string().optional(),
  /** Error details when status is "error" */
  error: z.string().optional(),
  /** Number of files processed (on completion) */
  filesProcessed: z.number().int().min(0).optional(),
  /** Number of cards created (on completion) */
  cardsCreated: z.number().int().min(0).optional(),
  /** Bytes processed (on completion) */
  bytesProcessed: z.number().int().min(0).optional(),
});

/**
 * Discriminated union of all server message types
 */
export const ServerMessageSchema = z.discriminatedUnion("type", [
  VaultListMessageSchema,
  VaultCreatedMessageSchema,
  SessionReadyMessageSchema,
  ResponseStartMessageSchema,
  ResponseChunkMessageSchema,
  ResponseEndMessageSchema,
  ToolStartMessageSchema,
  ToolInputMessageSchema,
  ToolEndMessageSchema,
  ErrorMessageSchema,
  PongMessageSchema,
  ToolPermissionRequestMessageSchema,
  AskUserQuestionRequestMessageSchema,
  HealthReportMessageSchema,
  // Memory Extraction
  ExtractionPromptContentMessageSchema,
  ExtractionPromptSavedMessageSchema,
  ExtractionPromptResetMessageSchema,
  ExtractionStatusMessageSchema,
  // Card Generator
  CardGeneratorConfigContentMessageSchema,
  CardGeneratorRequirementsSavedMessageSchema,
  CardGeneratorConfigSavedMessageSchema,
  CardGeneratorRequirementsResetMessageSchema,
  CardGenerationStatusMessageSchema,
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

// Inspiration types (used by REST API)
export type InspirationItem = z.infer<typeof InspirationItemSchema>;

// Spaced repetition card types (used by REST API)
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;
export type DueCard = z.infer<typeof DueCardSchema>;
export type CardDetail = z.infer<typeof CardDetailSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export type ArchiveResponse = z.infer<typeof ArchiveResponseSchema>;
export type DueCardsResponse = z.infer<typeof DueCardsResponseSchema>;

// Client message types
export type SelectVaultMessage = z.infer<typeof SelectVaultMessageSchema>;
export type CreateVaultMessage = z.infer<typeof CreateVaultMessageSchema>;
export type DiscussionMessage = z.infer<typeof DiscussionMessageSchema>;
export type ResumeSessionMessage = z.infer<typeof ResumeSessionMessageSchema>;
export type NewSessionMessage = z.infer<typeof NewSessionMessageSchema>;
export type AbortMessage = z.infer<typeof AbortMessageSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;
export type ToolPermissionResponseMessage = z.infer<typeof ToolPermissionResponseMessageSchema>;
export type AskUserQuestionOption = z.infer<typeof AskUserQuestionOptionSchema>;
export type AskUserQuestionItem = z.infer<typeof AskUserQuestionItemSchema>;
export type AskUserQuestionResponseMessage = z.infer<typeof AskUserQuestionResponseMessageSchema>;
export type DismissHealthIssueMessage = z.infer<typeof DismissHealthIssueMessageSchema>;
// Pair Writing Mode types
export type QuickActionType = z.infer<typeof QuickActionTypeSchema>;
export type AdvisoryActionType = z.infer<typeof AdvisoryActionTypeSchema>;
export type QuickActionRequestMessage = z.infer<typeof QuickActionRequestMessageSchema>;
export type AdvisoryActionRequestMessage = z.infer<typeof AdvisoryActionRequestMessageSchema>;
export type GetExtractionPromptMessage = z.infer<typeof GetExtractionPromptMessageSchema>;
export type SaveExtractionPromptMessage = z.infer<typeof SaveExtractionPromptMessageSchema>;
export type ResetExtractionPromptMessage = z.infer<typeof ResetExtractionPromptMessageSchema>;
export type TriggerExtractionMessage = z.infer<typeof TriggerExtractionMessageSchema>;
// Card Generator client message types
export type GetCardGeneratorConfigMessage = z.infer<typeof GetCardGeneratorConfigMessageSchema>;
export type SaveCardGeneratorRequirementsMessage = z.infer<typeof SaveCardGeneratorRequirementsMessageSchema>;
export type SaveCardGeneratorConfigMessage = z.infer<typeof SaveCardGeneratorConfigMessageSchema>;
export type ResetCardGeneratorRequirementsMessage = z.infer<typeof ResetCardGeneratorRequirementsMessageSchema>;
export type TriggerCardGenerationMessage = z.infer<typeof TriggerCardGenerationMessageSchema>;
export type GetCardGenerationStatusMessage = z.infer<typeof GetCardGenerationStatusMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Server message types
export type VaultListMessage = z.infer<typeof VaultListMessageSchema>;
export type VaultCreatedMessage = z.infer<typeof VaultCreatedMessageSchema>;
export type SessionReadyMessage = z.infer<typeof SessionReadyMessageSchema>;
export type ResponseStartMessage = z.infer<typeof ResponseStartMessageSchema>;
export type ResponseChunkMessage = z.infer<typeof ResponseChunkMessageSchema>;
export type ResponseEndMessage = z.infer<typeof ResponseEndMessageSchema>;
export type ToolStartMessage = z.infer<typeof ToolStartMessageSchema>;
export type ToolInputMessage = z.infer<typeof ToolInputMessageSchema>;
export type ToolEndMessage = z.infer<typeof ToolEndMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type PongMessage = z.infer<typeof PongMessageSchema>;
export type ToolPermissionRequestMessage = z.infer<typeof ToolPermissionRequestMessageSchema>;
export type AskUserQuestionRequestMessage = z.infer<typeof AskUserQuestionRequestMessageSchema>;
export type ExtractionStatusValue = z.infer<typeof ExtractionStatusValueSchema>;
export type ExtractionPromptContentMessage = z.infer<typeof ExtractionPromptContentMessageSchema>;
export type ExtractionPromptSavedMessage = z.infer<typeof ExtractionPromptSavedMessageSchema>;
export type ExtractionPromptResetMessage = z.infer<typeof ExtractionPromptResetMessageSchema>;
export type ExtractionStatusMessage = z.infer<typeof ExtractionStatusMessageSchema>;
// Card Generator server message types
export type CardGenerationStatusValue = z.infer<typeof CardGenerationStatusValueSchema>;
export type CardGeneratorConfigContentMessage = z.infer<typeof CardGeneratorConfigContentMessageSchema>;
export type CardGeneratorRequirementsSavedMessage = z.infer<typeof CardGeneratorRequirementsSavedMessageSchema>;
export type CardGeneratorConfigSavedMessage = z.infer<typeof CardGeneratorConfigSavedMessageSchema>;
export type CardGeneratorRequirementsResetMessage = z.infer<typeof CardGeneratorRequirementsResetMessageSchema>;
export type CardGenerationStatusMessage = z.infer<typeof CardGenerationStatusMessageSchema>;
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

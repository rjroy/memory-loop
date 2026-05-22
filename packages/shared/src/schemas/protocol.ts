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

export const BadgeSchema = z.object({
  text: z.string().min(1, "Badge text is required"),
  color: BadgeColorSchema,
});

// Stricter version used when validating user input for badge editing.
export const EditableBadgeSchema = z.object({
  text: z.string().min(1, "Badge text is required").max(20, "Badge text must be 20 characters or less"),
  color: BadgeColorSchema,
});

// =============================================================================
// Editable Vault Config Schema
// =============================================================================

// All fields optional to support partial updates. Constraints match the spec.
export const EditableVaultConfigSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  discussionModel: z.string().optional(),
  promptsPerGeneration: z.number().int().min(1).max(20).optional(),
  maxPoolSize: z.number().int().min(10).max(200).optional(),
  quotesPerWeek: z.number().int().min(0).max(7).optional(),
  recentCaptures: z.number().int().min(1).max(20).optional(),
  recentDiscussions: z.number().int().min(1).max(20).optional(),
  badges: z.array(EditableBadgeSchema).max(5).optional(),
  order: z.number().int().min(1).optional(),
  cardsEnabled: z.boolean().optional(),
  viMode: z.boolean().optional(),
});

// =============================================================================
// Vault Info Schema
// =============================================================================

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
  discussionModel: z.string().optional(),
  promptsPerGeneration: z.number().int().positive(),
  maxPoolSize: z.number().int().positive(),
  quotesPerWeek: z.number().int().positive(),
  recentCaptures: z.number().int().positive().optional(),
  recentDiscussions: z.number().int().positive().optional(),
  badges: z.array(BadgeSchema),
  order: z.number(), // Can be Infinity for unset vaults
  cardsEnabled: z.boolean(),
  viMode: z.boolean(),
});

// =============================================================================
// Error Code Schema
// =============================================================================

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

export const FileEntrySchema = z.object({
  name: z.string().min(1, "Entry name is required"),
  type: z.enum(["file", "directory"]),
  path: z.string(), // Can be empty string for root entries
});

export const TaskCategorySchema = z.enum(["inbox", "projects", "areas"]);

// Tasks are lines matching /^\s*- \[(.)\] (.+)$/
export const TaskEntrySchema = z.object({
  text: z.string(),
  // Checkbox state character: ' ', 'x', '/', '?', 'b', 'f'
  state: z.string().length(1, "State must be a single character"),
  filePath: z.string().min(1, "File path is required"),
  lineNumber: z.number().int().min(1, "Line number must be at least 1"),
  fileMtime: z.number().int().min(0),
  category: TaskCategorySchema,
});

export const RecentNoteEntrySchema = z.object({
  id: z.string().min(1, "Entry ID is required"),
  text: z.string(),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM format"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
});

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

// Sent from server to client in session_ready.
export const SlashCommandSchema = z.object({
  // Includes "/" prefix (e.g., "/commit").
  name: z.string().min(2, "Command name must include / prefix and at least one character"),
  description: z.string().min(1, "Description is required"),
  // Optional hint for expected arguments (e.g., "<message>").
  argumentHint: z.string().optional(),
});

// =============================================================================
// Tool Invocation Schema
// =============================================================================

export const ToolInvocationSchema = z.object({
  toolUseId: z.string().min(1, "Tool use ID is required"),
  toolName: z.string().min(1, "Tool name is required"),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  status: z.enum(["running", "complete"]),
});

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

export const FileSearchResultSchema = z.object({
  path: z.string(),
  name: z.string(),
  score: z.number(),
  matchPositions: z.array(z.number()),
});

export const ContentSearchResultSchema = z.object({
  path: z.string(),
  name: z.string(),
  matchCount: z.number().int().min(1),
  // Populated on demand via get_snippets.
  snippets: z.array(z.lazy(() => ContextSnippetSchema)).optional(),
});

export const ContextSnippetSchema = z.object({
  lineNumber: z.number().int().min(1),
  line: z.string(),
  // Up to 2 lines before/after the match.
  contextBefore: z.array(z.string()),
  contextAfter: z.array(z.string()),
});

// =============================================================================
// REST API Data Schemas
// =============================================================================

// Used for both contextual prompts and quotes.
export const InspirationItemSchema = z.object({
  text: z.string().min(1, "Inspiration text is required"),
  attribution: z.string().optional(),
});

export const MeetingStateSchema = z.object({
  isActive: z.boolean(),
  title: z.string().optional(),
  filePath: z.string().optional(),
  startedAt: z.string().optional(),
});

// =============================================================================
// Spaced Repetition Card Schemas
// =============================================================================

// Maps to SM-2 algorithm quality ratings:
//   again (q=0), hard (q=3), good (q=4), easy (q=5).
export const ReviewResponseSchema = z.enum(["again", "hard", "good", "easy"]);

// Question-only preview (used in GET /cards/due response items).
export const DueCardSchema = z.object({
  id: z.string().uuid(),
  question: z.string().min(1, "Question is required"),
  next_review: z.string(),
  card_file: z.string(),
});

// Full card with answer (used in GET /cards/:cardId response).
export const CardDetailSchema = z.object({
  id: z.string().uuid(),
  question: z.string().min(1, "Question is required"),
  answer: z.string().min(1, "Answer is required"),
  // SM-2 ease factor (default 2.5, adjusted based on performance).
  ease_factor: z.number().min(1.3),
  interval: z.number().int().min(0),
  repetitions: z.number().int().min(0),
  last_reviewed: z.string().nullable(),
  next_review: z.string(),
  source_file: z.string().optional(),
});

export const ReviewRequestSchema = z.object({
  response: ReviewResponseSchema,
});

export const ReviewResultSchema = z.object({
  id: z.string().uuid(),
  next_review: z.string(),
  interval: z.number().int().min(0),
  ease_factor: z.number().min(1.3),
});

export const ArchiveResponseSchema = z.object({
  id: z.string().uuid(),
  archived: z.literal(true),
});

export const DueCardsResponseSchema = z.object({
  cards: z.array(DueCardSchema),
  count: z.number().int().min(0),
});

// =============================================================================
// Client -> Server Message Schemas
// =============================================================================

export const SelectVaultMessageSchema = z.object({
  type: z.literal("select_vault"),
  vaultId: z.string().min(1, "Vault ID is required"),
});

export const DiscussionMessageSchema = z.object({
  type: z.literal("discussion_message"),
  text: z.string().min(1, "Message text is required"),
});

export const ResumeSessionMessageSchema = z.object({
  type: z.literal("resume_session"),
  sessionId: z.string().min(1, "Session ID is required"),
});

export const NewSessionMessageSchema = z.object({
  type: z.literal("new_session"),
});

export const AbortMessageSchema = z.object({
  type: z.literal("abort"),
});

export const PingMessageSchema = z.object({
  type: z.literal("ping"),
});

// Response to tool_permission_request.
export const ToolPermissionResponseMessageSchema = z.object({
  type: z.literal("tool_permission_response"),
  toolUseId: z.string().min(1, "Tool use ID is required"),
  allowed: z.boolean(),
});

// =============================================================================
// AskUserQuestion Schemas
// =============================================================================

export const AskUserQuestionOptionSchema = z.object({
  label: z.string().min(1, "Option label is required"),
  description: z.string(),
});

export const AskUserQuestionItemSchema = z.object({
  question: z.string().min(1, "Question text is required"),
  header: z.string().min(1, "Header is required"),
  // 2-4 options per question.
  options: z.array(AskUserQuestionOptionSchema).min(2).max(4),
  multiSelect: z.boolean(),
});

// Response to ask_user_question_request. `answers` maps question text -> answer.
export const AskUserQuestionResponseMessageSchema = z.object({
  type: z.literal("ask_user_question_response"),
  toolUseId: z.string().min(1, "Tool use ID is required"),
  answers: z.record(z.string(), z.string()),
});

// Title becomes the CLAUDE.md heading and is converted to a safe directory name.
export const CreateVaultMessageSchema = z.object({
  type: z.literal("create_vault"),
  title: z.string().min(1, "Vault title is required"),
});

// =============================================================================
// Pair Writing Mode Client Messages
// =============================================================================

// Quick actions (transformative, all platforms):
//   tighten   - more concise without losing meaning
//   embellish - add detail, nuance, or context
//   correct   - fix typos and grammar only
//   polish    - correct + improve prose
export const QuickActionTypeSchema = z.enum(["tighten", "embellish", "correct", "polish"]);

// Advisory actions (Pair Writing Mode, desktop only):
//   validate - fact-check the claim
//   critique - analyze clarity, voice, structure
//   compare  - compare current text to snapshot
//   discuss  - discuss improvements or alternatives
export const AdvisoryActionTypeSchema = z.enum(["validate", "critique", "compare", "discuss"]);

// Claude uses Read/Edit tools to modify the file directly.
export const QuickActionRequestMessageSchema = z.object({
  type: z.literal("quick_action_request"),
  action: QuickActionTypeSchema,
  selection: z.string().min(1, "Selection is required"),
  contextBefore: z.string(),
  contextAfter: z.string(),
  filePath: z.string().min(1, "File path is required"),
  selectionStartLine: z.number().int().min(1, "Selection start line must be at least 1"),
  selectionEndLine: z.number().int().min(1, "Selection end line must be at least 1"),
  // Used for position hint calculation.
  totalLines: z.number().int().min(1, "Total lines must be at least 1"),
});

// Response appears in conversation pane; user manually applies changes.
export const AdvisoryActionRequestMessageSchema = z.object({
  type: z.literal("advisory_action_request"),
  action: AdvisoryActionTypeSchema,
  selection: z.string().min(1, "Selection is required"),
  contextBefore: z.string(),
  contextAfter: z.string(),
  filePath: z.string().min(1, "File path is required"),
  selectionStartLine: z.number().int().min(1, "Selection start line must be at least 1"),
  selectionEndLine: z.number().int().min(1, "Selection end line must be at least 1"),
  totalLines: z.number().int().min(1, "Total lines must be at least 1"),
  // For compare action: the corresponding text from the snapshot.
  snapshotSelection: z.string().optional(),
});

// =============================================================================
// Memory Extraction Client Messages
// =============================================================================

// REQ-F-15: response is extraction_prompt_content.
export const GetExtractionPromptMessageSchema = z.object({
  type: z.literal("get_extraction_prompt"),
});

// REQ-F-16: creates user override at ~/.config/memory-loop/extraction-prompt.md
// if needed. Response is extraction_prompt_saved.
export const SaveExtractionPromptMessageSchema = z.object({
  type: z.literal("save_extraction_prompt"),
  content: z.string(),
});

// REQ-F-16: removes the user override file. Response is extraction_prompt_reset.
export const ResetExtractionPromptMessageSchema = z.object({
  type: z.literal("reset_extraction_prompt"),
});

// Manually triggers extraction (for testing/debug). Response stream is
// extraction_status messages with progress updates.
export const TriggerExtractionMessageSchema = z.object({
  type: z.literal("trigger_extraction"),
});

// =============================================================================
// Card Generator Client Messages
// =============================================================================

export const GetCardGeneratorConfigMessageSchema = z.object({
  type: z.literal("get_card_generator_config"),
});

export const SaveCardGeneratorRequirementsMessageSchema = z.object({
  type: z.literal("save_card_generator_requirements"),
  content: z.string(),
});

export const SaveCardGeneratorConfigMessageSchema = z.object({
  type: z.literal("save_card_generator_config"),
  // 100KB - 10MB.
  weeklyByteLimit: z.number().int().min(102400).max(10485760),
});

// Removes user override at ~/.config/memory-loop/card-generator-requirements.md.
export const ResetCardGeneratorRequirementsMessageSchema = z.object({
  type: z.literal("reset_card_generator_requirements"),
});

// Bypasses "already ran this week" check, uses remaining weekly budget.
export const TriggerCardGenerationMessageSchema = z.object({
  type: z.literal("trigger_card_generation"),
});

export const GetCardGenerationStatusMessageSchema = z.object({
  type: z.literal("get_card_generation_status"),
});

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

export const VaultListMessageSchema = z.object({
  type: z.literal("vault_list"),
  vaults: z.array(VaultInfoSchema),
});

// `sessionId` may be empty when a vault is first selected; the session is
// created on the first discussion_message. On resume, `messages` carries
// the conversation history.
export const SessionReadyMessageSchema = z.object({
  type: z.literal("session_ready"),
  sessionId: z.string(),
  vaultId: z.string().min(1),
  messages: z.array(ConversationMessageSchema).optional(),
  createdAt: z.string().optional(),
  slashCommands: z.array(SlashCommandSchema).optional(),
});

export const ResponseStartMessageSchema = z.object({
  type: z.literal("response_start"),
  messageId: z.string().min(1),
});

export const ResponseChunkMessageSchema = z.object({
  type: z.literal("response_chunk"),
  messageId: z.string().min(1),
  content: z.string(), // Can be empty for whitespace-only chunks
});

export const ResponseEndMessageSchema = z.object({
  type: z.literal("response_end"),
  messageId: z.string().min(1),
  contextUsage: z.number().min(0).max(100).optional(),
  durationMs: z.number().int().min(0).optional(),
});

export const ToolStartMessageSchema = z.object({
  type: z.literal("tool_start"),
  toolName: z.string().min(1),
  toolUseId: z.string().min(1),
});

export const ToolInputMessageSchema = z.object({
  type: z.literal("tool_input"),
  toolUseId: z.string().min(1),
  input: z.unknown(),
});

export const ToolEndMessageSchema = z.object({
  type: z.literal("tool_end"),
  toolUseId: z.string().min(1),
  output: z.unknown(),
});

export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  code: ErrorCodeSchema,
  message: z.string().min(1, "Error message is required"),
});

export const PongMessageSchema = z.object({
  type: z.literal("pong"),
});

// Client should display a dialog and respond with tool_permission_response.
export const ToolPermissionRequestMessageSchema = z.object({
  type: z.literal("tool_permission_request"),
  toolUseId: z.string().min(1, "Tool use ID is required"),
  toolName: z.string().min(1, "Tool name is required"),
  input: z.unknown(),
});

// Client should display a multi-question dialog and respond with
// ask_user_question_response.
export const AskUserQuestionRequestMessageSchema = z.object({
  type: z.literal("ask_user_question_request"),
  toolUseId: z.string().min(1, "Tool use ID is required"),
  // 1-4 questions.
  questions: z.array(AskUserQuestionItemSchema).min(1).max(4),
});

// Response to create_vault.
export const VaultCreatedMessageSchema = z.object({
  type: z.literal("vault_created"),
  vault: VaultInfoSchema,
});

// =============================================================================
// Memory Extraction Schemas
// =============================================================================

export const ExtractionStatusValueSchema = z.enum(["idle", "running", "complete", "error"]);

// REQ-F-15: response to get_extraction_prompt.
// `isOverride` is true when reading from ~/.config/memory-loop/extraction-prompt.md.
export const ExtractionPromptContentMessageSchema = z.object({
  type: z.literal("extraction_prompt_content"),
  content: z.string(),
  isOverride: z.boolean(),
});

// REQ-F-16: response to save_extraction_prompt.
export const ExtractionPromptSavedMessageSchema = z.object({
  type: z.literal("extraction_prompt_saved"),
  success: z.boolean(),
  isOverride: z.boolean(),
  error: z.string().optional(),
});

// REQ-F-16: response to reset_extraction_prompt.
// `content` carries the default prompt so the UI can update without refetching.
export const ExtractionPromptResetMessageSchema = z.object({
  type: z.literal("extraction_prompt_reset"),
  success: z.boolean(),
  content: z.string(),
  error: z.string().optional(),
});

// Sent during extraction run (triggered manually or scheduled).
export const ExtractionStatusMessageSchema = z.object({
  type: z.literal("extraction_status"),
  status: ExtractionStatusValueSchema,
  progress: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  transcriptsProcessed: z.number().int().min(0).optional(),
  factsExtracted: z.number().int().min(0).optional(),
});

// =============================================================================
// Card Generator Server Messages
// =============================================================================

export const CardGenerationStatusValueSchema = z.enum(["idle", "running", "complete", "error"]);

export const CardGeneratorConfigContentMessageSchema = z.object({
  type: z.literal("card_generator_config_content"),
  requirements: z.string(),
  isOverride: z.boolean(),
  weeklyByteLimit: z.number().int().min(0),
  weeklyBytesUsed: z.number().int().min(0),
});

export const CardGeneratorRequirementsSavedMessageSchema = z.object({
  type: z.literal("card_generator_requirements_saved"),
  success: z.boolean(),
  isOverride: z.boolean(),
  error: z.string().optional(),
});

export const CardGeneratorConfigSavedMessageSchema = z.object({
  type: z.literal("card_generator_config_saved"),
  success: z.boolean(),
  error: z.string().optional(),
});

export const CardGeneratorRequirementsResetMessageSchema = z.object({
  type: z.literal("card_generator_requirements_reset"),
  success: z.boolean(),
  content: z.string(),
  error: z.string().optional(),
});

export const CardGenerationStatusMessageSchema = z.object({
  type: z.literal("card_generation_status"),
  status: CardGenerationStatusValueSchema,
  message: z.string().optional(),
  error: z.string().optional(),
  filesProcessed: z.number().int().min(0).optional(),
  cardsCreated: z.number().int().min(0).optional(),
  bytesProcessed: z.number().int().min(0).optional(),
});

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

export type FileEntry = z.infer<typeof FileEntrySchema>;

export type TaskCategory = z.infer<typeof TaskCategorySchema>;
export type TaskEntry = z.infer<typeof TaskEntrySchema>;

export type RecentNoteEntry = z.infer<typeof RecentNoteEntrySchema>;
export type RecentDiscussionEntry = z.infer<typeof RecentDiscussionEntrySchema>;

export type SlashCommand = z.infer<typeof SlashCommandSchema>;

export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;
export type ConversationMessageProtocol = z.infer<typeof ConversationMessageSchema>;

export type FileSearchResult = z.infer<typeof FileSearchResultSchema>;
export type ContentSearchResult = z.infer<typeof ContentSearchResultSchema>;
export type ContextSnippet = z.infer<typeof ContextSnippetSchema>;

export type Badge = z.infer<typeof BadgeSchema>;
export type BadgeColor = z.infer<typeof BadgeColorSchema>;
export type EditableBadge = z.infer<typeof EditableBadgeSchema>;

export type EditableVaultConfig = z.infer<typeof EditableVaultConfigSchema>;

export type MeetingState = z.infer<typeof MeetingStateSchema>;

export type InspirationItem = z.infer<typeof InspirationItemSchema>;

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

// Pair Writing Mode types
export type QuickActionType = z.infer<typeof QuickActionTypeSchema>;
export type AdvisoryActionType = z.infer<typeof AdvisoryActionTypeSchema>;
export type QuickActionRequestMessage = z.infer<typeof QuickActionRequestMessageSchema>;
export type AdvisoryActionRequestMessage = z.infer<typeof AdvisoryActionRequestMessageSchema>;

// Memory Extraction client message types
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

// Memory Extraction server message types
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

/** Parse a client message. Throws ZodError if validation fails. */
export function parseClientMessage(data: unknown): ClientMessage {
  return ClientMessageSchema.parse(data);
}

/** Parse a server message. Throws ZodError if validation fails. */
export function parseServerMessage(data: unknown): ServerMessage {
  return ServerMessageSchema.parse(data);
}

export function safeParseClientMessage(data: unknown) {
  return ClientMessageSchema.safeParse(data);
}

export function safeParseServerMessage(data: unknown) {
  return ServerMessageSchema.safeParse(data);
}

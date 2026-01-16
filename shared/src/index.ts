/**
 * Memory Loop Shared Types and Protocols
 *
 * This package contains:
 * - Zod schemas for WebSocket protocol validation
 * - TypeScript types for Vault, Session, and Message models
 * - Shared utilities for frontend and backend
 */

export const VERSION = "0.1.0";

// Core types
export type { VaultInfo, SessionMetadata, ErrorCode, StoredToolInvocation, ConversationMessage, Badge, BadgeColor } from "./types.js";

// Editable vault config types (from protocol)
export type { EditableVaultConfig, DiscussionModel } from "./protocol.js";
export { EditableVaultConfigSchema, DiscussionModelSchema, EditableBadgeSchema } from "./protocol.js";

// Protocol schemas
export {
  // Vault Info
  VaultInfoSchema,
  ErrorCodeSchema,
  // File browser schemas
  FileEntrySchema,
  // Task schemas
  TaskCategorySchema,
  TaskEntrySchema,
  // Recent notes schemas
  RecentNoteEntrySchema,
  // Recent discussion schemas
  RecentDiscussionEntrySchema,
  // Tool invocation schema
  ToolInvocationSchema,
  // Inspiration schemas
  InspirationItemSchema,
  GetInspirationMessageSchema,
  InspirationMessageSchema,
  // Slash command schemas
  SlashCommandSchema,
  // Search result schemas
  FileSearchResultSchema,
  ContentSearchResultSchema,
  ContextSnippetSchema,
  // Widget schemas
  WidgetDisplayTypeSchema,
  WidgetTypeSchema,
  WidgetLocationSchema,
  WidgetDisplayConfigSchema,
  WidgetEditableTypeSchema,
  WidgetEditableFieldSchema,
  WidgetResultSchema,
  // Health schemas
  HealthSeveritySchema,
  HealthCategorySchema,
  HealthIssueSchema,
  HealthReportMessageSchema,
  DismissHealthIssueMessageSchema,
  // Meeting schemas
  MeetingStateSchema,
  StartMeetingMessageSchema,
  StopMeetingMessageSchema,
  GetMeetingStateMessageSchema,
  MeetingStartedMessageSchema,
  MeetingStoppedMessageSchema,
  MeetingStateMessageSchema,
  // Client -> Server schemas
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
  ClientMessageSchema,
  // Server -> Client schemas
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
  ServerMessageSchema,
  // Validation utilities
  parseClientMessage,
  parseServerMessage,
  safeParseClientMessage,
  safeParseServerMessage,
} from "./protocol.js";

// Protocol message types (inferred from Zod schemas)
export type {
  // Conversation message type (for session messages)
  ConversationMessageProtocol,
  // File browser types
  FileEntry,
  // Task types
  TaskCategory,
  TaskEntry,
  // Recent notes types
  RecentNoteEntry,
  // Recent discussion types
  RecentDiscussionEntry,
  // Tool invocation type
  ToolInvocation,
  // Inspiration types
  InspirationItem,
  GetInspirationMessage,
  InspirationMessage,
  // Slash command types
  SlashCommand,
  // Search result types
  FileSearchResult,
  ContentSearchResult,
  ContextSnippet,
  // Widget types
  WidgetDisplayType,
  WidgetType,
  WidgetLocation,
  WidgetDisplayConfig,
  WidgetEditableType,
  WidgetEditableField,
  WidgetResult,
  // Health types
  HealthSeverity,
  HealthCategory,
  HealthIssue,
  HealthReportMessage,
  DismissHealthIssueMessage,
  // Meeting types
  MeetingState,
  StartMeetingMessage,
  StopMeetingMessage,
  GetMeetingStateMessage,
  MeetingStartedMessage,
  MeetingStoppedMessage,
  MeetingStateMessage,
  // AskUserQuestion types
  AskUserQuestionOption,
  AskUserQuestionItem,
  AskUserQuestionResponseMessage,
  AskUserQuestionRequestMessage,
  // Client message types
  SelectVaultMessage,
  CaptureNoteMessage,
  DiscussionMessage,
  ResumeSessionMessage,
  NewSessionMessage,
  AbortMessage,
  PingMessage,
  ListDirectoryMessage,
  ReadFileMessage,
  GetRecentNotesMessage,
  GetRecentActivityMessage,
  GetGoalsMessage,
  ClientMessage,
  // Server message types
  VaultListMessage,
  SessionReadyMessage,
  NoteCapturedMessage,
  ResponseStartMessage,
  ResponseChunkMessage,
  ResponseEndMessage,
  ToolStartMessage,
  ToolInputMessage,
  ToolEndMessage,
  ErrorMessage,
  PongMessage,
  DirectoryListingMessage,
  FileContentMessage,
  RecentNotesMessage,
  RecentActivityMessage,
  GoalsMessage,
  ServerMessage,
} from "./protocol.js";

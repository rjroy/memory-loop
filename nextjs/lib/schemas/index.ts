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
export type { VaultInfo, SessionMetadata, ErrorCode, StoredToolInvocation, ConversationMessage, Badge, BadgeColor } from "./types";

// Editable vault config types (from protocol)
export type { EditableVaultConfig, DiscussionModel } from "./protocol";
export { EditableVaultConfigSchema, DiscussionModelSchema, EditableBadgeSchema } from "./protocol";

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
  // Conversation message schema
  ConversationMessageSchema,
  // Inspiration schemas (used by REST API)
  InspirationItemSchema,
  // Slash command schemas
  SlashCommandSchema,
  // Search result schemas
  FileSearchResultSchema,
  ContentSearchResultSchema,
  ContextSnippetSchema,

  // Meeting state schema (used by REST API)
  MeetingStateSchema,
  // Spaced repetition card schemas (used by REST API)
  ReviewResponseSchema,
  DueCardSchema,
  CardDetailSchema,
  ReviewRequestSchema,
  ReviewResultSchema,
  ArchiveResponseSchema,
  DueCardsResponseSchema,
  // Client -> Server schemas (WebSocket only)
  SelectVaultMessageSchema,
  CreateVaultMessageSchema,
  DiscussionMessageSchema,
  ResumeSessionMessageSchema,
  NewSessionMessageSchema,
  AbortMessageSchema,
  PingMessageSchema,
  ClientMessageSchema,
  // Server -> Client schemas (WebSocket only)
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
  ServerMessageSchema,
  // Validation utilities
  parseClientMessage,
  parseServerMessage,
  safeParseClientMessage,
  safeParseServerMessage,
} from "./protocol";

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
  // Inspiration types (used by REST API)
  InspirationItem,
  // Slash command types
  SlashCommand,
  // Search result types
  FileSearchResult,
  ContentSearchResult,
  ContextSnippet,

  // Meeting types (used by REST API)
  MeetingState,
  // Spaced repetition card types (used by REST API)
  ReviewResponse,
  DueCard,
  CardDetail,
  ReviewRequest,
  ReviewResult,
  ArchiveResponse,
  DueCardsResponse,
  // AskUserQuestion types
  AskUserQuestionOption,
  AskUserQuestionItem,
  AskUserQuestionResponseMessage,
  AskUserQuestionRequestMessage,
  // Pair Writing types
  QuickActionType,
  QuickActionRequestMessage,
  AdvisoryActionType,
  AdvisoryActionRequestMessage,
  // Client message types (WebSocket only)
  SelectVaultMessage,
  CreateVaultMessage,
  DiscussionMessage,
  ResumeSessionMessage,
  NewSessionMessage,
  AbortMessage,
  PingMessage,
  ClientMessage,
  // Server message types (WebSocket only)
  VaultListMessage,
  VaultCreatedMessage,
  SessionReadyMessage,
  ResponseStartMessage,
  ResponseChunkMessage,
  ResponseEndMessage,
  ToolStartMessage,
  ToolInputMessage,
  ToolEndMessage,
  ErrorMessage,
  PongMessage,
  ServerMessage,
} from "./protocol";

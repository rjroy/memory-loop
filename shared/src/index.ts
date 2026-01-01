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
export type { VaultInfo, SessionMetadata, ErrorCode, StoredToolInvocation, ConversationMessage } from "./types.js";

// Protocol schemas
export {
  // Vault Info
  VaultInfoSchema,
  ErrorCodeSchema,
  // File browser schemas
  FileEntrySchema,
  // Task schemas
  TaskEntrySchema,
  // Recent notes schemas
  RecentNoteEntrySchema,
  // Recent discussion schemas
  RecentDiscussionEntrySchema,
  // Tool invocation schema
  ToolInvocationSchema,
  // Goals schemas
  GoalSectionSchema,
  // Inspiration schemas
  InspirationItemSchema,
  GetInspirationMessageSchema,
  InspirationMessageSchema,
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
  TaskEntry,
  // Recent notes types
  RecentNoteEntry,
  // Recent discussion types
  RecentDiscussionEntry,
  // Tool invocation type
  ToolInvocation,
  // Goal types
  GoalSection,
  // Inspiration types
  InspirationItem,
  GetInspirationMessage,
  InspirationMessage,
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

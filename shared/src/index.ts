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
export type { VaultInfo, SessionMetadata, ErrorCode } from "./types.js";

// Protocol schemas
export {
  // Vault Info
  VaultInfoSchema,
  ErrorCodeSchema,
  // File browser schemas
  FileEntrySchema,
  // Recent notes schemas
  RecentNoteEntrySchema,
  // Recent discussion schemas
  RecentDiscussionEntrySchema,
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
  // Recent notes types
  RecentNoteEntry,
  // Recent discussion types
  RecentDiscussionEntry,
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
  ServerMessage,
} from "./protocol.js";

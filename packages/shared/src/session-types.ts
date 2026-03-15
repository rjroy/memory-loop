/**
 * Session Types
 *
 * Type definitions for the session lifecycle and streaming infrastructure.
 * Used by daemon (producer) and Next.js/browser (consumer).
 */

import type { AskUserQuestionItem, ConversationMessage, SlashCommand, StoredToolInvocation } from "./schemas/index";

// =============================================================================
// Session Events (emitted to subscribers)
// =============================================================================

/**
 * Events emitted by the Active Session Controller.
 * Subscribers receive these to update UI via SSE transport.
 */
export type SessionEvent =
  | { type: "response_start"; messageId: string }
  | { type: "response_chunk"; messageId: string; content: string }
  | {
      type: "response_end";
      messageId: string;
      contextUsage?: number;
      durationMs: number;
    }
  | { type: "tool_start"; toolUseId: string; toolName: string }
  | { type: "tool_input"; toolUseId: string; input: unknown }
  | { type: "tool_end"; toolUseId: string; output: unknown }
  | { type: "prompt_pending"; prompt: PendingPrompt }
  | { type: "prompt_resolved"; promptId: string }
  | {
      type: "prompt_response_rejected";
      promptId: string;
      reason: "not_found" | "already_resolved";
    }
  | { type: "error"; code: string; message: string }
  | { type: "session_cleared" }
  | {
      type: "session_ready";
      sessionId: string;
      vaultId: string;
      createdAt?: string;
      messages?: ConversationMessage[];
      slashCommands?: SlashCommand[];
    };

// =============================================================================
// Pending Prompts
// =============================================================================

/**
 * A prompt waiting for user response.
 * Stored in pendingPrompts map, keyed by id.
 */
export interface PendingPrompt {
  /** Unique identifier (matches toolUseId from SDK) */
  id: string;
  /** Type of prompt */
  type: "tool_permission" | "ask_user_question";
  /** Tool name (for tool_permission type) */
  toolName?: string;
  /** Tool input (for tool_permission type) */
  input?: unknown;
  /** Questions to ask (for ask_user_question type) */
  questions?: AskUserQuestionItem[];
}

/**
 * Response to a pending prompt.
 */
export type PromptResponse =
  | { type: "tool_permission"; allowed: boolean }
  | { type: "ask_user_question"; answers: Record<string, string> };

// =============================================================================
// Session State
// =============================================================================

/**
 * Current state of the active session.
 * Exposed via getState() for reconnecting clients.
 */
export interface SessionState {
  /** Current session ID (null if no session) */
  sessionId: string | null;
  /** Current vault ID (null if no session) */
  vaultId: string | null;
  /** Cumulative token count across all turns */
  cumulativeTokens: number;
  /** Context window size for the active model */
  contextWindow: number | null;
  /** Active model name */
  activeModel: string | null;
  /** Whether a streaming response is in progress */
  isStreaming: boolean;
}

/**
 * Point-in-time snapshot of session processing state.
 * Used for reconnecting clients (REQ-SDC-8).
 */
export interface SessionSnapshot {
  sessionId: string | null;
  isProcessing: boolean;
  content: string;
  toolInvocations: StoredToolInvocation[];
  pendingPrompts: PendingPrompt[];
  contextUsage?: number;
  cumulativeTokens: number;
  contextWindow: number | null;
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when a message is sent while the controller is already processing.
 * Callers should catch this and return an appropriate error response.
 */
export class AlreadyProcessingError extends Error {
  readonly code = "ALREADY_PROCESSING" as const;
  constructor() {
    super("A message is currently being processed. Please wait for it to complete.");
    this.name = "AlreadyProcessingError";
  }
}

// =============================================================================
// Callback
// =============================================================================

/**
 * Callback type for session event subscribers.
 */
export type SessionEventCallback = (event: SessionEvent) => void;

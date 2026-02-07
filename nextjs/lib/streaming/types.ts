/**
 * Streaming Types
 *
 * Type definitions for the Active Session Controller and streaming infrastructure.
 * Based on the spec in .lore/design/active-session-controller.md
 */

import type { AskUserQuestionItem, ConversationMessage, SlashCommand } from "@/lib/schemas";

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

// =============================================================================
// Controller Interface
// =============================================================================

/**
 * Callback type for session event subscribers.
 */
export type SessionEventCallback = (event: SessionEvent) => void;

/**
 * Active Session Controller interface.
 * Owns the live SDK connection and manages streaming state.
 */
export interface ActiveSessionController {
  // Lifecycle
  sendMessage(params: {
    vaultId: string;
    vaultPath: string;
    sessionId: string | null;
    prompt: string;
  }): Promise<void>;
  clearSession(): Promise<void>;

  // Subscription (push)
  subscribe(callback: SessionEventCallback): () => void;

  // State queries (pull, for reconnect)
  getPendingPrompts(): PendingPrompt[];
  getState(): SessionState;
  isStreaming(): boolean;

  // Prompts
  respondToPrompt(promptId: string, response: PromptResponse): void;
}

// =============================================================================
// Internal Types (used by controller implementation)
// =============================================================================

/**
 * Internal pending permission request.
 * Wraps the SDK's canUseTool callback promise.
 */
export interface PendingPermissionRequest {
  prompt: PendingPrompt;
  resolve: (allowed: boolean) => void;
  reject: (error: Error) => void;
}

/**
 * Internal pending AskUserQuestion request.
 * Wraps the SDK's canUseTool callback promise for AskUserQuestion.
 */
export interface PendingQuestionRequest {
  prompt: PendingPrompt;
  resolve: (answers: Record<string, string>) => void;
  reject: (error: Error) => void;
}

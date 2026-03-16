/**
 * Streaming Types (Daemon-Internal)
 *
 * Internal types used by the active session controller implementation.
 * Shared types (SessionEvent, PendingPrompt, etc.) come from @memory-loop/shared.
 */

import type { PendingPrompt } from "@memory-loop/shared";

/**
 * Token usage data extracted from a completed SDK turn.
 * The controller uses these raw values to compute contextUsage percentage.
 */
export interface TurnUsageData {
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
  model?: string;
}

/**
 * Intermediate event schema for SDK event translation.
 *
 * The event translator converts raw SDKMessage events into this discriminated
 * union. The controller then maps these to SessionEvents for the UI. This
 * separation keeps translation (stateful but side-effect-free) separate from
 * domain logic (state accumulation, event emission, persistence).
 */
export type SdkRunnerEvent =
  | { type: "session"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; name: string; id: string }
  | { type: "tool_input"; toolUseId: string; input: unknown }
  | { type: "tool_result"; name: string; output: string; toolUseId?: string }
  | { type: "turn_end"; cost?: number; usage?: TurnUsageData }
  | { type: "error"; reason: string }
  | { type: "aborted" }
  | { type: "compact_boundary"; preTokens: number; trigger: string };

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

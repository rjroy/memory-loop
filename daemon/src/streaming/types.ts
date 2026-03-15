/**
 * Streaming Types (Daemon-Internal)
 *
 * Internal types used by the active session controller implementation.
 * Shared types (SessionEvent, PendingPrompt, etc.) come from @memory-loop/shared.
 */

import type { PendingPrompt } from "@memory-loop/shared";

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

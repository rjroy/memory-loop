/**
 * Active Session Controller
 *
 * Owns the live pi-agent session and manages streaming state.
 * Implements the session-viewport separation spec (REQ-6).
 *
 * Key responsibilities:
 * - Hold the active pi-agent AgentSession for the current turn
 * - Manage pendingPermissions and pendingQuestions maps
 * - Track cumulativeTokens, contextWindow, activeModel
 * - Emit events to subscribers (pub-sub pattern)
 * - Translate pi-agent events via createPiEventAdapter() (REQ-ESS-4)
 */

import type {
  VaultInfo,
  ConversationMessage,
  SlashCommand,
  SessionEvent,
  SessionState,
  SessionSnapshot,
  PendingPrompt,
  PromptResponse,
  SessionEventCallback,
  AskUserQuestionItem,
  StoredToolInvocation,
} from "@memory-loop/shared";
import { AlreadyProcessingError } from "@memory-loop/shared";
import type {
  PendingPermissionRequest,
  PendingQuestionRequest,
} from "./types";
import { createPiEventAdapter } from "./event-translator";
import {
  createSession as sdkCreateSession,
  resumeSession as sdkResumeSession,
  appendMessage as sdkAppendMessage,
  SessionError,
  type SessionQueryResult,
  type ToolPermissionCallback,
  type AskUserQuestionCallback,
} from "../session-manager";
import { createLogger } from "@memory-loop/shared";
const log = createLogger("Session");

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
  clearSession(): void;
  /** Abort current processing, persist partial result. Session remains valid. */
  abortProcessing(): void;

  // Subscription (push)
  subscribe(callback: SessionEventCallback): () => void;

  // State queries (pull, for reconnect)
  getPendingPrompts(): PendingPrompt[];
  getState(): SessionState;
  /** Get a point-in-time snapshot of processing state (for reconnecting clients) */
  getSnapshot(): SessionSnapshot;
  isStreaming(): boolean;

  // Prompts
  respondToPrompt(promptId: string, response: PromptResponse): void;
}

/**
 * Generates a unique message ID.
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Mutable state tracked across turns for token accumulation.
 */
interface StreamerState {
  cumulativeTokens: number;
  contextWindow: number | null;
  activeModel: string | null;
}

/**
 * Creates an Active Session Controller instance.
 *
 * This is a singleton per server - only one active session at a time (REQ-4).
 */
export function createActiveSessionController(): ActiveSessionController {
  // Session state
  let currentSessionId: string | null = null;
  let currentVaultId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained for future getState() exposure
  let currentVaultPath: string | null = null;
  let queryResult: SessionQueryResult | null = null;
  let isStreamingActive = false;
  let isProcessing = false;
  let currentGeneration = 0;

  // Streaming state (cumulative across turns, REQ-ESS-13)
  const streamerState: StreamerState = {
    cumulativeTokens: 0,
    contextWindow: null,
    activeModel: null,
  };

  // Per-turn snapshot state (accumulated during runStreaming, read by getSnapshot)
  let currentResponseChunks: string[] = [];
  let currentToolsMap = new Map<string, StoredToolInvocation>();
  let currentContextUsage: number | undefined;

  // Pending prompts
  const pendingPermissions = new Map<string, PendingPermissionRequest>();
  const pendingQuestions = new Map<string, PendingQuestionRequest>();

  // Subscribers
  const subscribers = new Set<SessionEventCallback>();

  // Slash commands cache (sent to client in session_ready)
  let slashCommands: SlashCommand[] = [];

  /**
   * Emits an event to all subscribers.
   * Wraps each callback in try/catch per spec (errors logged, not propagated).
   */
  function emit(event: SessionEvent): void {
    for (const callback of subscribers) {
      try {
        callback(event);
      } catch (err) {
        log.error("Subscriber callback threw error", err);
      }
    }
  }

  /**
   * Creates a tool permission callback for the SDK.
   * Stores the pending request and emits prompt_pending event.
   */
  function createToolPermissionCallback(): ToolPermissionCallback {
    return async (
      toolUseId: string,
      toolName: string,
      input: unknown
    ): Promise<boolean> => {
      log.info(`Requesting tool permission: ${toolName} (${toolUseId})`);

      return new Promise<boolean>((resolve, reject) => {
        const prompt: PendingPrompt = {
          id: toolUseId,
          type: "tool_permission",
          toolName,
          input,
        };

        pendingPermissions.set(toolUseId, { prompt, resolve, reject });

        emit({ type: "prompt_pending", prompt });
      });
    };
  }

  /**
   * Creates an AskUserQuestion callback for the SDK.
   * Stores the pending request and emits prompt_pending event.
   */
  function createAskUserQuestionCallback(): AskUserQuestionCallback {
    return async (
      toolUseId: string,
      questions: AskUserQuestionItem[]
    ): Promise<Record<string, string>> => {
      log.info(`Requesting user input via AskUserQuestion: ${toolUseId}`);

      return new Promise<Record<string, string>>((resolve, reject) => {
        const prompt: PendingPrompt = {
          id: toolUseId,
          type: "ask_user_question",
          questions,
        };

        pendingQuestions.set(toolUseId, { prompt, resolve, reject });

        emit({ type: "prompt_pending", prompt });
      });
    };
  }

  /**
   * Discards all pending prompts without resolving them.
   * Called when session is cleared (REQ-5).
   */
  function discardPendingPrompts(): void {
    const reason = new Error("Session cleared");
    function drain<T extends { reject: (err: Error) => void }>(
      label: string,
      map: Map<string, T>
    ): void {
      for (const [id, request] of map) {
        log.info(`Discarding pending ${label}: ${id}`);
        request.reject(reason);
      }
      map.clear();
    }
    drain("permission", pendingPermissions);
    drain("question", pendingQuestions);
  }

  /**
   * Returns whether any pending prompts are active.
   */
  function hasPendingPrompts(): boolean {
    return pendingPermissions.size > 0 || pendingQuestions.size > 0;
  }

  /**
   * Collects all pending prompts (permissions and questions) as a flat array.
   * Used by both getPendingPrompts() and getSnapshot().
   */
  function collectPendingPrompts(): PendingPrompt[] {
    return [
      ...Array.from(pendingPermissions.values(), (r) => r.prompt),
      ...Array.from(pendingQuestions.values(), (r) => r.prompt),
    ];
  }

  /**
   * Reads current accumulated streaming state as a snapshot.
   */
  function getStreamingSnapshot(): {
    content: string;
    toolInvocations: StoredToolInvocation[];
    contextUsage: number | undefined;
  } {
    return {
      content: currentResponseChunks.join(""),
      toolInvocations: Array.from(currentToolsMap.values()),
      contextUsage: currentContextUsage,
    };
  }

  /**
   * Builds the assistant ConversationMessage for persistence. Returns null
   * when there's nothing worth saving (no text and no tool invocations).
   */
  function buildAssistantMessage(
    messageId: string,
    snapshot: { content: string; toolInvocations: StoredToolInvocation[]; contextUsage: number | undefined },
    durationMs: number
  ): ConversationMessage | null {
    if (snapshot.content.length === 0 && snapshot.toolInvocations.length === 0) {
      return null;
    }
    return {
      id: messageId,
      role: "assistant",
      content: snapshot.content,
      timestamp: new Date().toISOString(),
      toolInvocations: snapshot.toolInvocations.length > 0 ? snapshot.toolInvocations : undefined,
      contextUsage: snapshot.contextUsage,
      durationMs,
    };
  }

  /**
   * Internal clear session logic. Terminates the SDK process, discards
   * pending prompts, resets all state, and emits session_cleared.
   *
   * Used by both the public clearSession() method and sendMessage()
   * when a new session replaces an active one.
   */
  function performClearSession(): void {
    log.info("Clearing session");

    // Abort the pi-agent session to stop any in-progress turn
    if (queryResult) {
      try {
        void queryResult.piSession.abort();
      } catch (err) {
        log.warn("Failed to abort pi-agent session", err);
      }
      queryResult = null;
    }

    // Discard pending prompts (REQ-5)
    discardPendingPrompts();

    // Reset state
    currentSessionId = null;
    currentVaultId = null;
    currentVaultPath = null;
    streamerState.cumulativeTokens = 0;
    streamerState.contextWindow = null;
    streamerState.activeModel = null;
    isStreamingActive = false;
    isProcessing = false;
    currentResponseChunks = [];
    currentToolsMap = new Map();
    currentContextUsage = undefined;
    slashCommands = [];

    // Invalidate any running generation so its finally block skips cleanup
    currentGeneration++;

    emit({ type: "session_cleared" });
  }

  /**
   * Runs the streaming loop for a turn using the pi-agent session.
   *
   * Subscribes to pi-agent events via createPiEventAdapter, appends the user
   * message, then calls session.prompt(). Cleanup is handled in the finally block.
   */
  async function runStreaming(
    vaultId: string,
    vaultPath: string,
    prompt: string,
    result: SessionQueryResult,
    isNewSession: boolean
  ): Promise<void> {
    queryResult = result;
    currentSessionId = result.sessionId;
    currentVaultId = vaultId;
    currentVaultPath = vaultPath;
    isStreamingActive = true;
    isProcessing = true;
    currentGeneration++;
    const gen = currentGeneration;

    // Reset per-turn snapshot state
    currentResponseChunks = [];
    currentToolsMap = new Map();
    currentContextUsage = undefined;

    let messageId = "";
    let queryStartTime = 0;
    let unsubscribe: (() => void) | null = null;

    try {
      // Pi-agent has no slash commands API — emit empty list (Phase 7 may revisit)
      slashCommands = [];

      if (isNewSession) {
        // Reset cumulative tokens for new session
        streamerState.cumulativeTokens = 0;
        streamerState.contextWindow = null;

        emit({
          type: "session_ready",
          sessionId: result.sessionId,
          vaultId,
          createdAt: new Date().toISOString(),
          slashCommands,
        });
      } else {
        // Resume: send session_ready with previous messages so the UI
        // can restore conversation history before streaming the new response
        emit({
          type: "session_ready",
          sessionId: result.sessionId,
          vaultId,
          messages: result.previousMessages,
          slashCommands,
        });
      }

      // Append user message to session
      const userMessageId = generateMessageId();
      await sdkAppendMessage(vaultPath, result.sessionId, {
        id: userMessageId,
        role: "user",
        content: prompt,
        timestamp: new Date().toISOString(),
      });

      // Start response streaming
      messageId = generateMessageId();
      queryStartTime = Date.now();

      emit({ type: "response_start", messageId });

      // Subscribe to pi-agent events through the adapter (REQ-ESS-4).
      // Must subscribe before calling prompt() so no events are missed.
      unsubscribe = result.piSession.subscribe(
        createPiEventAdapter((event) => {
          switch (event.type) {
            case "session":
              // Session ID comes from the factory. Ignore here.
              break;

            case "text_delta":
              currentResponseChunks.push(event.text);
              emit({ type: "response_chunk", messageId, content: event.text });
              break;

            case "tool_use":
              log.info(`Tool started: ${event.name} (${event.id})`);
              currentToolsMap.set(event.id, {
                toolUseId: event.id,
                toolName: event.name,
                status: "running",
              });
              emit({ type: "tool_start", toolName: event.name, toolUseId: event.id });
              break;

            case "tool_input": {
              log.debug(`Tool input complete for ${event.toolUseId}`);
              const tracked = currentToolsMap.get(event.toolUseId);
              if (tracked) {
                tracked.input = event.input;
              }
              emit({ type: "tool_input", toolUseId: event.toolUseId, input: event.input });
              break;
            }

            case "tool_result": {
              log.info(`Tool completed: ${event.toolUseId ?? "unknown"}`);
              if (event.toolUseId) {
                const trackedTool = currentToolsMap.get(event.toolUseId);
                if (trackedTool) {
                  trackedTool.output = event.output ?? null;
                  trackedTool.status = "complete";
                }
                emit({ type: "tool_end", toolUseId: event.toolUseId, output: event.output ?? null });
              }
              break;
            }

            case "turn_end": {
              // Pi-agent does not expose per-turn token usage in subscription events.
              // Context bar remains at zero until Phase 7 revisits this with extension hooks.
              break;
            }

            case "compact_boundary": {
              // Reset cumulative tokens on context compaction
              const estimatedPostCompact = Math.round(event.preTokens * 0.3);
              log.info(
                `Compact boundary: pre_tokens=${event.preTokens}, ` +
                `trigger=${event.trigger}, ` +
                `resetting cumulative from ${streamerState.cumulativeTokens} to ~${estimatedPostCompact}`
              );
              streamerState.cumulativeTokens = estimatedPostCompact;
              break;
            }

            case "error":
              emit({ type: "error", code: "SDK_ERROR", message: event.reason });
              break;

            case "aborted":
              emit({ type: "aborted" });
              break;
          }
        })
      );

      // Drive the turn. prompt() resolves when the agent finishes (all tool calls complete).
      await result.piSession.prompt(prompt);

      const durationMs = Date.now() - queryStartTime;
      log.info(`Query completed in ${durationMs}ms`);

      emit({
        type: "response_end",
        messageId,
        contextUsage: currentContextUsage,
        durationMs,
      });

      // Persist assistant message on normal completion
      const assistantMessage = buildAssistantMessage(messageId, getStreamingSnapshot(), durationMs);
      if (assistantMessage) {
        await sdkAppendMessage(vaultPath, result.sessionId, assistantMessage);
      }
    } catch (err) {
      // REQ-ESS-10: Detect pending prompts during crash
      const hadPendingPrompts = hasPendingPrompts();
      discardPendingPrompts();

      if (hadPendingPrompts) {
        log.error("Pi-agent session crashed while waiting for user response", err);
        emit({
          type: "error",
          code: "SDK_ERROR",
          message: "Processing crashed while waiting for your response. Please try again.",
        });
      } else {
        log.error("Streaming failed", err);
        emit({
          type: "error",
          code: "SDK_ERROR",
          message: err instanceof Error ? err.message : "Streaming failed",
        });
      }

      // Persist partial result from snapshot on error/abort
      if (messageId && queryStartTime) {
        const durationMs = Date.now() - queryStartTime;
        const snapshot = getStreamingSnapshot();
        const assistantMessage = buildAssistantMessage(messageId, snapshot, durationMs);
        if (assistantMessage) {
          try {
            emit({
              type: "response_end",
              messageId,
              contextUsage: snapshot.contextUsage,
              durationMs,
            });
            await sdkAppendMessage(vaultPath, result.sessionId, assistantMessage);
          } catch (persistErr) {
            log.error("Failed to persist partial result", persistErr);
          }
        }
      }
    } finally {
      // Always unsubscribe from pi-agent events
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }

      if (gen === currentGeneration) {
        isProcessing = false;
        isStreamingActive = false;
        queryResult = null;
      } else {
        log.warn(`Stale generation ${gen} (current: ${currentGeneration}), skipping cleanup`);
      }
    }
  }

  // =============================================================================
  // Public Interface
  // =============================================================================

  return {
    async sendMessage({ vaultId, vaultPath, sessionId, prompt }): Promise<void> {
      const isNewSession = !sessionId;
      log.info(
        `sendMessage: vault=${vaultId}, session=${sessionId ?? "new"}, ` +
        `isNew=${isNewSession}`
      );

      // REQ-SDC-2: Reject messages during processing for same session
      if (isProcessing && sessionId) {
        throw new AlreadyProcessingError();
      }

      // REQ-SDC-6: New session clears existing processing
      if (isProcessing && !sessionId) {
        performClearSession();
      }

      try {
        const permCallback = createToolPermissionCallback();
        const questionCallback = createAskUserQuestionCallback();

        let result: SessionQueryResult;

        if (sessionId) {
          // Resume existing session (message 2+, or resume from ground tab)
          result = await sdkResumeSession(
            vaultPath,
            sessionId,
            permCallback,
            questionCallback
          );
        } else {
          // Create new session (first message)
          const vault = { id: vaultId, path: vaultPath } as VaultInfo;
          result = await sdkCreateSession(
            vault,
            permCallback,
            questionCallback
          );
        }

        // Set session identity before fire-and-forget so getState().sessionId
        // is available to callers immediately after sendMessage() returns.
        currentSessionId = result.sessionId;
        currentVaultId = vaultId;
        currentVaultPath = vaultPath;

        // Fire and forget - processing continues independently.
        // runStreaming has its own try/catch for streaming errors.
        void runStreaming(vaultId, vaultPath, prompt, result, isNewSession);
      } catch (err) {
        log.error("sendMessage failed", err);
        const code =
          err instanceof SessionError && err.code === "RESUME_FAILED"
            ? "RESUME_FAILED"
            : "SDK_ERROR";
        emit({
          type: "error",
          code,
          message: err instanceof Error ? err.message : "Failed to send message",
        });
        throw err; // Re-throw so POST handler returns HTTP error
      }
    },

    clearSession(): void {
      performClearSession();
    },

    abortProcessing(): void {
      log.info("Aborting processing");

      if (!isProcessing) {
        log.warn("No active processing to abort");
        return;
      }

      // REQ-ESS-19: Check for pending prompts before aborting
      const hadPendingPrompts = hasPendingPrompts();

      // Abort the pi-agent session (graceful abort, not kill)
      if (queryResult) {
        try {
          queryResult.piSession.abort().catch((err: unknown) => {
            log.error("Async abort failed", err);
          });
        } catch (err) {
          log.warn("Failed to abort pi-agent session", err);
        }
      }

      // Discard pending prompts
      discardPendingPrompts();

      // REQ-ESS-19: If prompts were pending, emit aborted (not error)
      if (hadPendingPrompts) {
        emit({ type: "aborted" });
      }
    },

    subscribe(callback: SessionEventCallback): () => void {
      subscribers.add(callback);
      log.debug(`Subscriber added, total: ${subscribers.size}`);

      return () => {
        subscribers.delete(callback);
        log.debug(`Subscriber removed, total: ${subscribers.size}`);
      };
    },

    getPendingPrompts(): PendingPrompt[] {
      return collectPendingPrompts();
    },

    getState(): SessionState {
      return {
        sessionId: currentSessionId,
        vaultId: currentVaultId,
        cumulativeTokens: streamerState.cumulativeTokens,
        contextWindow: streamerState.contextWindow,
        activeModel: streamerState.activeModel,
        isStreaming: isStreamingActive,
      };
    },

    getSnapshot(): SessionSnapshot {
      const snapshot = getStreamingSnapshot();
      return {
        sessionId: currentSessionId,
        isProcessing,
        content: snapshot.content,
        toolInvocations: snapshot.toolInvocations,
        pendingPrompts: collectPendingPrompts(),
        contextUsage: snapshot.contextUsage,
        cumulativeTokens: streamerState.cumulativeTokens,
        contextWindow: streamerState.contextWindow,
      };
    },

    isStreaming(): boolean {
      return isStreamingActive;
    },

    respondToPrompt(promptId: string, response: PromptResponse): void {
      log.info(`Responding to prompt: ${promptId}`);

      // Resolve the matching pending request, then dispatch the response value.
      // Each branch knows its own map and the shape of `pending.resolve`.
      let resolved = false;
      if (response.type === "tool_permission") {
        const pending = pendingPermissions.get(promptId);
        if (pending) {
          pendingPermissions.delete(promptId);
          pending.resolve(response.allowed);
          resolved = true;
        }
      } else if (response.type === "ask_user_question") {
        const pending = pendingQuestions.get(promptId);
        if (pending) {
          pendingQuestions.delete(promptId);
          pending.resolve(response.answers);
          resolved = true;
        }
      }

      if (resolved) {
        emit({ type: "prompt_resolved", promptId });
      } else {
        log.warn(`Prompt not found: ${promptId}`);
        emit({ type: "prompt_response_rejected", promptId, reason: "not_found" });
      }
    },
  };
}

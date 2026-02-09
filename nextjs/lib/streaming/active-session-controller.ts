/**
 * Active Session Controller
 *
 * Owns the live SDK connection and manages streaming state.
 * Implements the session-viewport separation spec (REQ-6).
 *
 * Key responsibilities:
 * - Hold queryResult (live SDK connection)
 * - Manage pendingPermissions and pendingQuestions maps
 * - Track cumulativeTokens, contextWindow, activeModel
 * - Emit events to subscribers (pub-sub pattern)
 */

import type { VaultInfo, ConversationMessage, SlashCommand } from "@/lib/schemas";
import type {
  SessionEvent,
  SessionState,
  SessionSnapshot,
  PendingPrompt,
  PromptResponse,
  SessionEventCallback,
  PendingPermissionRequest,
  PendingQuestionRequest,
  ActiveSessionController as IActiveSessionController,
} from "./types";
import { AlreadyProcessingError } from "./types";
import type { StreamerState, StreamerEmitter, StreamerHandle } from "./session-streamer";
import { startStreamSdkEvents } from "./session-streamer";
import {
  createSession as sdkCreateSession,
  resumeSession as sdkResumeSession,
  appendMessage as sdkAppendMessage,
  type SessionQueryResult,
  type ToolPermissionCallback,
  type AskUserQuestionCallback,
  type AskUserQuestionItem,
} from "../session-manager";
import { sessionLog as log } from "../logger";

/**
 * Generates a unique message ID.
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Creates an Active Session Controller instance.
 *
 * This is a singleton per server - only one active session at a time (REQ-4).
 */
export function createActiveSessionController(): IActiveSessionController {
  // Session state
  let currentSessionId: string | null = null;
  let currentVaultId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained for future getState() exposure
  let currentVaultPath: string | null = null;
  let queryResult: SessionQueryResult | null = null;
  let isStreamingActive = false;
  let isProcessing = false;
  let abortController: AbortController | null = null;
  let currentStreamerHandle: StreamerHandle | null = null;
  let currentGeneration = 0;

  // Streaming state (mutable, passed to streamer)
  const streamerState: StreamerState = {
    cumulativeTokens: 0,
    contextWindow: null,
    activeModel: null,
  };

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
   * Emitter interface for session-streamer.
   */
  const emitter: StreamerEmitter = { emit };

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
    for (const [id, request] of pendingPermissions) {
      log.info(`Discarding pending permission: ${id}`);
      request.reject(new Error("Session cleared"));
    }
    pendingPermissions.clear();

    for (const [id, request] of pendingQuestions) {
      log.info(`Discarding pending question: ${id}`);
      request.reject(new Error("Session cleared"));
    }
    pendingQuestions.clear();
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

    // Abort any active streaming
    if (abortController) {
      abortController.abort();
      abortController = null;
    }

    // Close the SDK query to terminate the child process
    if (queryResult) {
      try {
        queryResult.close();
      } catch (err) {
        log.warn("Failed to close query", err);
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
    isStreamingActive = false;
    isProcessing = false;
    currentStreamerHandle = null;
    slashCommands = [];

    // Invalidate any running generation so its finally block skips cleanup
    currentGeneration++;

    emit({ type: "session_cleared" });
  }

  /**
   * Runs the streaming loop for a query.
   *
   * This is the single code path for both new and resumed sessions.
   * The only difference is whether session_ready includes createdAt
   * (new) or messages (resume). Processing continues independently
   * after sendMessage() kicks it off (fire-and-forget).
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
    abortController = new AbortController();
    currentGeneration++;
    const gen = currentGeneration;

    let messageId = "";
    let queryStartTime = 0;

    try {
      // Fetch slash commands for both new and resumed sessions
      try {
        const sdkCommands = await result.supportedCommands();
        slashCommands = sdkCommands.map((cmd) => ({
          name: cmd.name.startsWith("/") ? cmd.name : `/${cmd.name}`,
          description: cmd.description,
          argumentHint: cmd.argumentHint || undefined,
        }));
      } catch (err) {
        log.warn("Failed to fetch slash commands", err);
        slashCommands = [];
      }

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

      // Stream SDK events
      currentStreamerHandle = startStreamSdkEvents(
        result.events,
        messageId,
        emitter,
        streamerState,
        abortController.signal
      );
      const streamResult = await currentStreamerHandle.result;

      const durationMs = Date.now() - queryStartTime;
      log.info(`Query completed in ${durationMs}ms`);

      emit({
        type: "response_end",
        messageId,
        contextUsage: streamResult.contextUsage,
        durationMs,
      });

      // Persist assistant message on normal completion
      if (
        streamResult.content.length > 0 ||
        streamResult.toolInvocations.length > 0
      ) {
        const assistantMessage: ConversationMessage = {
          id: messageId,
          role: "assistant",
          content: streamResult.content,
          timestamp: new Date().toISOString(),
          toolInvocations:
            streamResult.toolInvocations.length > 0
              ? streamResult.toolInvocations
              : undefined,
          contextUsage: streamResult.contextUsage,
          durationMs,
        };
        await sdkAppendMessage(vaultPath, result.sessionId, assistantMessage);
      }
    } catch (err) {
      log.error("Streaming failed", err);
      emit({
        type: "error",
        code: "SDK_ERROR",
        message: err instanceof Error ? err.message : "Streaming failed",
      });

      // Persist partial result from snapshot on error/abort
      if (messageId && queryStartTime) {
        const snapshot = currentStreamerHandle?.getSnapshot();
        if (snapshot && (snapshot.content.length > 0 || snapshot.toolInvocations.length > 0)) {
          try {
            const durationMs = Date.now() - queryStartTime;
            emit({ type: "response_end", messageId, contextUsage: snapshot.contextUsage, durationMs });
            const assistantMessage: ConversationMessage = {
              id: messageId,
              role: "assistant",
              content: snapshot.content,
              timestamp: new Date().toISOString(),
              toolInvocations:
                snapshot.toolInvocations.length > 0
                  ? snapshot.toolInvocations
                  : undefined,
              contextUsage: snapshot.contextUsage,
              durationMs,
            };
            await sdkAppendMessage(vaultPath, result.sessionId, assistantMessage);
          } catch (persistErr) {
            log.error("Failed to persist partial result", persistErr);
          }
        }
      }
    } finally {
      if (gen === currentGeneration) {
        isProcessing = false;
        isStreamingActive = false;
        abortController = null;
        currentStreamerHandle = null;

        if (queryResult) {
          try {
            queryResult.close();
          } catch (err) {
            log.warn("Failed to close query", err);
          }
        }
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
            prompt,
            undefined,
            permCallback,
            questionCallback
          );
        } else {
          // Create new session (first message)
          const vault = { id: vaultId, path: vaultPath } as VaultInfo;
          result = await sdkCreateSession(
            vault,
            prompt,
            undefined,
            permCallback,
            questionCallback
          );
        }

        // If resume returned a different session ID, the SDK couldn't find
        // the original session. Warn the user so they know context was lost.
        if (sessionId && result.sessionId !== sessionId) {
          log.warn(
            `Resume failed: requested ${sessionId}, got ${result.sessionId}`
          );
          emit({
            type: "error",
            code: "SDK_ERROR",
            message: "Could not resume previous session. Starting a new conversation.",
          });
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
        // Only catches SDK session creation errors now
        log.error("sendMessage failed", err);
        emit({
          type: "error",
          code: "SDK_ERROR",
          message: err instanceof Error ? err.message : "Failed to send message",
        });
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

      // Interrupt the SDK cleanly (not close, which kills the process)
      if (queryResult) {
        try {
          queryResult.interrupt().catch((err: unknown) => {
            log.error("Async interrupt failed", err);
          });
        } catch (err) {
          log.warn("Failed to interrupt query", err);
        }
      }

      // Signal the streamer loop to exit
      if (abortController) {
        abortController.abort();
      }

      // Discard pending prompts
      discardPendingPrompts();
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
      const prompts: PendingPrompt[] = [];

      for (const request of pendingPermissions.values()) {
        prompts.push(request.prompt);
      }

      for (const request of pendingQuestions.values()) {
        prompts.push(request.prompt);
      }

      return prompts;
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
      const streamerSnapshot = currentStreamerHandle?.getSnapshot();
      const prompts: PendingPrompt[] = [];
      for (const request of pendingPermissions.values()) {
        prompts.push(request.prompt);
      }
      for (const request of pendingQuestions.values()) {
        prompts.push(request.prompt);
      }

      return {
        sessionId: currentSessionId,
        isProcessing,
        content: streamerSnapshot?.content ?? "",
        toolInvocations: streamerSnapshot?.toolInvocations ?? [],
        pendingPrompts: prompts,
        contextUsage: streamerSnapshot?.contextUsage,
        cumulativeTokens: streamerState.cumulativeTokens,
        contextWindow: streamerState.contextWindow,
      };
    },

    isStreaming(): boolean {
      return isStreamingActive;
    },

    respondToPrompt(promptId: string, response: PromptResponse): void {
      log.info(`Responding to prompt: ${promptId}`);

      if (response.type === "tool_permission") {
        const pending = pendingPermissions.get(promptId);
        if (!pending) {
          log.warn(`Prompt not found: ${promptId}`);
          emit({
            type: "prompt_response_rejected",
            promptId,
            reason: "not_found",
          });
          return;
        }

        pendingPermissions.delete(promptId);
        pending.resolve(response.allowed);
        emit({ type: "prompt_resolved", promptId });
      } else if (response.type === "ask_user_question") {
        const pending = pendingQuestions.get(promptId);
        if (!pending) {
          log.warn(`Question not found: ${promptId}`);
          emit({
            type: "prompt_response_rejected",
            promptId,
            reason: "not_found",
          });
          return;
        }

        pendingQuestions.delete(promptId);
        pending.resolve(response.answers);
        emit({ type: "prompt_resolved", promptId });
      }
    },
  };
}

// Singleton instance
let controller: IActiveSessionController | null = null;

/**
 * Gets the singleton Active Session Controller instance.
 */
export function getActiveSessionController(): IActiveSessionController {
  if (!controller) {
    controller = createActiveSessionController();
  }
  return controller;
}

/**
 * Resets the singleton for testing.
 */
export function resetActiveSessionController(): void {
  if (controller) {
    controller.clearSession();
  }
  controller = null;
}

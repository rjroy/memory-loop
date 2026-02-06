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
  PendingPrompt,
  PromptResponse,
  SessionEventCallback,
  PendingPermissionRequest,
  PendingQuestionRequest,
  ActiveSessionController as IActiveSessionController,
} from "./types";
import type { StreamerState, StreamerEmitter } from "./session-streamer";
import { streamSdkEvents } from "./session-streamer";
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
  let abortController: AbortController | null = null;

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
   * Runs the streaming loop for a query.
   */
  async function runStreaming(
    vault: VaultInfo,
    prompt: string,
    result: SessionQueryResult,
    isNewSession: boolean
  ): Promise<void> {
    queryResult = result;
    currentSessionId = result.sessionId;
    currentVaultId = vault.id;
    currentVaultPath = vault.path;
    isStreamingActive = true;
    abortController = new AbortController();

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
          vaultId: vault.id,
          createdAt: new Date().toISOString(),
          slashCommands,
        });
      } else {
        // Resume: send session_ready with previous messages so the UI
        // can restore conversation history before streaming the new response
        emit({
          type: "session_ready",
          sessionId: result.sessionId,
          vaultId: vault.id,
          messages: result.previousMessages,
          slashCommands,
        });
      }

      // Append user message to session
      const userMessageId = generateMessageId();
      await sdkAppendMessage(vault.path, result.sessionId, {
        id: userMessageId,
        role: "user",
        content: prompt,
        timestamp: new Date().toISOString(),
      });

      // Start response streaming
      const messageId = generateMessageId();
      const queryStartTime = Date.now();

      emit({ type: "response_start", messageId });

      // Stream SDK events
      const streamResult = await streamSdkEvents(
        result.events,
        messageId,
        emitter,
        streamerState,
        abortController.signal
      );

      const durationMs = Date.now() - queryStartTime;
      log.info(`Query completed in ${durationMs}ms`);

      emit({
        type: "response_end",
        messageId,
        contextUsage: streamResult.contextUsage,
        durationMs,
      });

      // Persist assistant message
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
        await sdkAppendMessage(vault.path, result.sessionId, assistantMessage);
      }
    } catch (err) {
      log.error("Streaming failed", err);
      emit({
        type: "error",
        code: "SDK_ERROR",
        message: err instanceof Error ? err.message : "Streaming failed",
      });
    } finally {
      isStreamingActive = false;
      abortController = null;
      // Note: queryResult is kept for potential resume
    }
  }

  // =============================================================================
  // Public Interface
  // =============================================================================

  return {
    async startSession(vault: VaultInfo, prompt: string): Promise<void> {
      log.info(`Starting session for vault: ${vault.id}`);

      // Clear existing session if any (REQ-5)
      if (queryResult || currentSessionId) {
        await this.clearSession();
      }

      try {
        const result = await sdkCreateSession(
          vault,
          prompt,
          undefined, // options
          createToolPermissionCallback(),
          createAskUserQuestionCallback()
        );

        await runStreaming(vault, prompt, result, true);
      } catch (err) {
        log.error("Failed to start session", err);
        emit({
          type: "error",
          code: "SDK_ERROR",
          message: err instanceof Error ? err.message : "Failed to start session",
        });
      }
    },

    async resumeSession(
      vaultPath: string,
      sessionId: string,
      prompt: string
    ): Promise<void> {
      log.info(`Resuming session: ${sessionId}`);

      try {
        const result = await sdkResumeSession(
          vaultPath,
          sessionId,
          prompt,
          undefined, // options
          createToolPermissionCallback(),
          createAskUserQuestionCallback()
        );

        // Get vault info from session result
        const vault: VaultInfo = {
          id: result.sessionId.split("_")[0] || "unknown",
          name: "",
          path: vaultPath,
          hasClaudeMd: true,
          contentRoot: "",
          inboxPath: "",
          metadataPath: "",
          attachmentPath: "",
          setupComplete: true,
          promptsPerGeneration: 10,
          maxPoolSize: 50,
          quotesPerWeek: 3,
          badges: [],
          order: Infinity,
          cardsEnabled: false,
          viMode: false,
        };

        // Update current vault path
        currentVaultPath = vaultPath;
        currentSessionId = sessionId;

        await runStreaming(vault, prompt, result, false);
      } catch (err) {
        log.error("Failed to resume session", err);
        emit({
          type: "error",
          code: "SDK_ERROR",
          message: err instanceof Error ? err.message : "Failed to resume session",
        });
      }
    },

    async clearSession(): Promise<void> {
      log.info("Clearing session");

      // Abort any active streaming
      if (abortController) {
        abortController.abort();
      }

      // Interrupt the SDK query if active
      if (queryResult) {
        try {
          await queryResult.interrupt();
        } catch (err) {
          log.warn("Failed to interrupt query", err);
        }
        queryResult = null;
      }

      // Discard pending prompts (REQ-5)
      discardPendingPrompts();

      // Reset state
      currentSessionId = null;
      currentVaultId = null;
      streamerState.cumulativeTokens = 0;
      streamerState.contextWindow = null;
      isStreamingActive = false;
      slashCommands = [];

      emit({ type: "session_cleared" });
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
    void controller.clearSession();
  }
  controller = null;
}

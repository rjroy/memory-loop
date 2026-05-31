/**
 * Live Session Controller (keyed)
 *
 * Phase 1 of the keyed-sessions refactor (.lore/plans/think-tab-keyed-sessions.md
 * §1–§4). Ports the single-slot ActiveSessionController turn state machine onto
 * the per-session registry from live-session-registry.ts. Every operation is
 * keyed by sessionId and operates on the LiveSession for that id, so two
 * conversations can have live turns concurrently without interfering and a
 * stream for session X always reflects X's state.
 *
 * This module is a set of plain exported functions (NOT a singleton object): the
 * registry holds all state, so there is no per-controller closure. The keyed
 * session routes call these functions directly; the single-slot
 * ActiveSessionController it replaced has been removed.
 *
 * Behavior is ported faithfully from active-session-controller.ts, re-keyed:
 * - REQ-SDC-2: a message for a session already processing throws AlreadyProcessingError.
 * - REQ-SDC-4: client disconnect does not abort the turn (the controller keeps
 *   running and buffering regardless of subscribers — a route concern, honored here).
 * - REQ-SDC-6: a new session is just a new map entry; no cross-session clear.
 * - REQ-ESS-10: pending prompts during a crash emit a clear error message.
 * - REQ-ESS-19: aborting with pending prompts emits `aborted` (terminal, non-error).
 * - Subscriber callback exceptions are caught and logged (registry's emitToSession).
 * - Partial assistant message is persisted on error/abort.
 * - Per-session generation guard skips stale finally-block cleanup.
 *
 * Warm reuse (§4): LiveSession.piSession stays warm across turns. Message 2+
 * reuses it; the first message for an id either creates (no metadata) or
 * resumes (metadata exists, cold-start after restart) the pi session.
 */

import type {
  ConversationMessage,
  SessionEvent,
  SessionState,
  SessionSnapshot,
  PromptResponse,
  SessionEventCallback,
  AskUserQuestionItem,
  PendingPrompt,
  StoredToolInvocation,
  VaultInfo,
} from "@memory-loop/shared";
import { AlreadyProcessingError, createLogger } from "@memory-loop/shared";
import { createPiEventAdapter } from "./event-translator";
import {
  createSession as sdkCreateSession,
  resumeSession as sdkResumeSession,
  appendMessage as sdkAppendMessage,
  loadSession,
  type SessionQueryResult,
  type ToolPermissionCallback,
  type AskUserQuestionCallback,
} from "../session-manager";
import {
  createLiveSession,
  getLiveSession,
  deleteLiveSession,
  emitToSession,
  clearEventBuffer,
  getEventBuffer,
  addSubscriber,
  removeSubscriber,
  collectPendingPrompts as registryCollectPendingPrompts,
  isProcessing as registryIsProcessing,
  type LiveSession,
} from "./live-session-registry";

const log = createLogger("LiveSessionController");

/**
 * Generates a unique message ID. Matches active-session-controller.ts.
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// =============================================================================
// Pending-prompt helpers (per LiveSession)
// =============================================================================

/**
 * Discards all pending prompts for a session without resolving them.
 * Called on clear and on crash (REQ-5 / REQ-ESS-10).
 */
function discardPendingPrompts(live: LiveSession): void {
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
  drain("permission", live.pendingPermissions);
  drain("question", live.pendingQuestions);
}

/** Returns whether any pending prompts are active for the session. */
function hasPendingPrompts(live: LiveSession): boolean {
  return live.pendingPermissions.size > 0 || live.pendingQuestions.size > 0;
}

// =============================================================================
// Snapshot / assistant-message helpers (per LiveSession)
// =============================================================================

/** Reads the session's accumulated per-turn streaming state as a snapshot. */
function getStreamingSnapshot(live: LiveSession): {
  content: string;
  toolInvocations: StoredToolInvocation[];
  contextUsage: number | undefined;
} {
  return {
    content: live.responseChunks.join(""),
    toolInvocations: Array.from(live.toolsMap.values()),
    contextUsage: live.contextUsage,
  };
}

/**
 * Builds the assistant ConversationMessage for persistence. Returns null when
 * there's nothing worth saving (no text and no tool invocations).
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

// =============================================================================
// Prompt callbacks (bound to a session id)
// =============================================================================

/**
 * Creates a tool-permission callback bound to a session id. Stores the pending
 * request on that session and emits prompt_pending to that session only.
 */
function createToolPermissionCallback(id: string): ToolPermissionCallback {
  return async (toolUseId, toolName, input): Promise<boolean> => {
    log.info(`Requesting tool permission: ${toolName} (${toolUseId}) for ${id}`);

    return new Promise<boolean>((resolve, reject) => {
      const prompt: PendingPrompt = {
        id: toolUseId,
        type: "tool_permission",
        toolName,
        input,
      };
      const live = getLiveSession(id);
      if (!live) {
        reject(new Error(`Session ${id} no longer exists`));
        return;
      }
      live.pendingPermissions.set(toolUseId, { prompt, resolve, reject });
      emitToSession(id, { type: "prompt_pending", prompt });
    });
  };
}

/**
 * Creates an AskUserQuestion callback bound to a session id. Stores the pending
 * request on that session and emits prompt_pending to that session only.
 */
function createAskUserQuestionCallback(id: string): AskUserQuestionCallback {
  return async (toolUseId, questions: AskUserQuestionItem[]): Promise<Record<string, string>> => {
    log.info(`Requesting user input via AskUserQuestion: ${toolUseId} for ${id}`);

    return new Promise<Record<string, string>>((resolve, reject) => {
      const prompt: PendingPrompt = {
        id: toolUseId,
        type: "ask_user_question",
        questions,
      };
      const live = getLiveSession(id);
      if (!live) {
        reject(new Error(`Session ${id} no longer exists`));
        return;
      }
      live.pendingQuestions.set(toolUseId, { prompt, resolve, reject });
      emitToSession(id, { type: "prompt_pending", prompt });
    });
  };
}

// =============================================================================
// Turn runner (port of runStreaming, per-id)
// =============================================================================

/**
 * Emits the session_ready event for a turn. New sessions get an empty history;
 * resumed/continued sessions replay previousMessages so the UI can restore the
 * conversation before streaming the new response.
 */
function emitSessionReady(
  live: LiveSession,
  result: SessionQueryResult,
  isNewSession: boolean
): void {
  if (isNewSession) {
    // Reset cumulative tokens for a brand-new conversation.
    live.streamer.cumulativeTokens = 0;
    live.streamer.contextWindow = null;
    emitToSession(live.sessionId, {
      type: "session_ready",
      sessionId: result.sessionId,
      vaultId: live.vaultId,
      createdAt: new Date().toISOString(),
      slashCommands: [],
    });
  } else {
    emitToSession(live.sessionId, {
      type: "session_ready",
      sessionId: result.sessionId,
      vaultId: live.vaultId,
      messages: result.previousMessages,
      slashCommands: [],
    });
  }
}

/**
 * Subscribes to the pi-agent session's events through the adapter and
 * translates them to SessionEvents for this session. Returns the unsubscribe
 * function. Must be called before prompt() so no events are missed.
 */
function subscribeToTurn(live: LiveSession, messageId: string): () => void {
  const id = live.sessionId;
  return live.piSession!.subscribe(
    createPiEventAdapter((event) => {
      switch (event.type) {
        case "session":
          // Session id comes from the factory; ignore here.
          break;

        case "text_delta":
          live.responseChunks.push(event.text);
          emitToSession(id, { type: "response_chunk", messageId, content: event.text });
          break;

        case "tool_use":
          log.info(`Tool started: ${event.name} (${event.id})`);
          live.toolsMap.set(event.id, {
            toolUseId: event.id,
            toolName: event.name,
            status: "running",
          });
          emitToSession(id, { type: "tool_start", toolName: event.name, toolUseId: event.id });
          break;

        case "tool_input": {
          log.debug(`Tool input complete for ${event.toolUseId}`);
          const tracked = live.toolsMap.get(event.toolUseId);
          if (tracked) {
            tracked.input = event.input;
          }
          emitToSession(id, { type: "tool_input", toolUseId: event.toolUseId, input: event.input });
          break;
        }

        case "tool_result": {
          log.info(`Tool completed: ${event.toolUseId ?? "unknown"}`);
          if (event.toolUseId) {
            const trackedTool = live.toolsMap.get(event.toolUseId);
            if (trackedTool) {
              trackedTool.output = event.output ?? null;
              trackedTool.status = "complete";
            }
            emitToSession(id, { type: "tool_end", toolUseId: event.toolUseId, output: event.output ?? null });
          }
          break;
        }

        case "turn_end":
          // Pi-agent does not expose per-turn token usage in subscription events.
          break;

        case "compact_boundary": {
          const estimatedPostCompact = Math.round(event.preTokens * 0.3);
          log.info(
            `Compact boundary: pre_tokens=${event.preTokens}, ` +
            `trigger=${event.trigger}, ` +
            `resetting cumulative from ${live.streamer.cumulativeTokens} to ~${estimatedPostCompact}`
          );
          live.streamer.cumulativeTokens = estimatedPostCompact;
          break;
        }

        case "error":
          emitToSession(id, { type: "error", code: "SDK_ERROR", message: event.reason });
          break;

        case "aborted":
          emitToSession(id, { type: "aborted" });
          break;
      }
    })
  );
}

/**
 * Persists the partial assistant message on error/abort, emitting a final
 * response_end so the client has the duration/usage for what did stream.
 */
async function persistPartialResult(
  live: LiveSession,
  messageId: string,
  queryStartTime: number
): Promise<void> {
  if (!messageId || !queryStartTime) {
    return;
  }
  const durationMs = Date.now() - queryStartTime;
  const snapshot = getStreamingSnapshot(live);
  const assistantMessage = buildAssistantMessage(messageId, snapshot, durationMs);
  if (!assistantMessage) {
    return;
  }
  try {
    emitToSession(live.sessionId, {
      type: "response_end",
      messageId,
      contextUsage: snapshot.contextUsage,
      durationMs,
    });
    await sdkAppendMessage(live.vaultPath, live.sessionId, assistantMessage);
  } catch (persistErr) {
    log.error("Failed to persist partial result", persistErr);
  }
}

/**
 * Runs the streaming loop for a turn on a specific session.
 *
 * Clears the event buffer at turn start (so a reconnecting client replays only
 * this turn), emits session_ready, appends the user message, then drives the pi
 * session via prompt(). On completion persists the assistant message; on
 * error/abort persists the partial. The finally block runs under a per-session
 * generation guard so clearing/superseding this session never suppresses
 * another session's cleanup.
 */
export async function runTurn(
  live: LiveSession,
  result: SessionQueryResult,
  prompt: string,
  isNewSession: boolean
): Promise<void> {
  const id = live.sessionId;

  live.piSession = result.piSession;
  live.isProcessing = true;
  live.generation++;
  const gen = live.generation;

  // Reset per-turn accumulators and the replay buffer for this turn.
  live.responseChunks = [];
  live.toolsMap = new Map();
  live.contextUsage = undefined;
  clearEventBuffer(id);

  let messageId = "";
  let queryStartTime = 0;
  let unsubscribe: (() => void) | null = null;

  try {
    emitSessionReady(live, result, isNewSession);

    // Append the user message before streaming the response.
    const userMessageId = generateMessageId();
    await sdkAppendMessage(live.vaultPath, id, {
      id: userMessageId,
      role: "user",
      content: prompt,
      timestamp: new Date().toISOString(),
    });

    messageId = generateMessageId();
    queryStartTime = Date.now();

    emitToSession(id, { type: "response_start", messageId });

    // Subscribe before prompt() so no events are missed (REQ-ESS-4).
    unsubscribe = subscribeToTurn(live, messageId);

    // Drive the turn. prompt() resolves when the agent finishes.
    await live.piSession.prompt(prompt);

    const durationMs = Date.now() - queryStartTime;
    log.info(`Query completed in ${durationMs}ms for ${id}`);

    emitToSession(id, {
      type: "response_end",
      messageId,
      contextUsage: live.contextUsage,
      durationMs,
    });

    const assistantMessage = buildAssistantMessage(messageId, getStreamingSnapshot(live), durationMs);
    if (assistantMessage) {
      await sdkAppendMessage(live.vaultPath, id, assistantMessage);
    }
  } catch (err) {
    // REQ-ESS-10: detect pending prompts during the crash for a clearer message.
    const hadPendingPrompts = hasPendingPrompts(live);
    discardPendingPrompts(live);

    if (hadPendingPrompts) {
      log.error(`Pi-agent session crashed while waiting for user response (${id})`, err);
      emitToSession(id, {
        type: "error",
        code: "SDK_ERROR",
        message: "Processing crashed while waiting for your response. Please try again.",
      });
    } else {
      log.error(`Streaming failed for ${id}`, err);
      emitToSession(id, {
        type: "error",
        code: "SDK_ERROR",
        message: err instanceof Error ? err.message : "Streaming failed",
      });
    }

    await persistPartialResult(live, messageId, queryStartTime);
  } finally {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    // Per-session generation guard: only the latest turn for THIS session clears
    // its own processing flag. A clear/supersede that bumped generation skips this.
    if (gen === live.generation) {
      live.isProcessing = false;
    } else {
      log.warn(`Stale generation ${gen} (current: ${live.generation}) for ${id}, skipping cleanup`);
    }
  }
}

// =============================================================================
// Public keyed API
// =============================================================================

/**
 * Sends a message to a session, starting a turn. The session id is required and
 * client-minted.
 *
 * Warm reuse + create-vs-resume:
 * - If the LiveSession already has a warm piSession, reuse it (message 2+).
 * - Otherwise obtain one: resume from disk if metadata exists (cold start after
 *   daemon restart, or first message of a session resumed from Ground); create a
 *   new pi session if no metadata exists (a brand-new conversation).
 */
export async function sendMessage(params: {
  vaultId: string;
  vaultPath: string;
  sessionId: string;
  prompt: string;
}): Promise<void> {
  const { vaultId, vaultPath, sessionId, prompt } = params;

  const live = getLiveSession(sessionId) ?? createLiveSession(sessionId, vaultId, vaultPath);

  // REQ-SDC-2: reject a message for a session that is already processing.
  if (live.isProcessing) {
    throw new AlreadyProcessingError();
  }

  // Claim the session SYNCHRONOUSLY, before the first await. The keyed model
  // allows concurrency across sessions, so two sendMessage calls for the SAME
  // id can interleave: the flag must be set here (not in the async runTurn) so
  // the second call's guard above sees it and rejects, rather than both opening
  // a pi session and the second clobbering live.piSession. runTurn sets it true
  // again (idempotent); the catch below resets it on any failure before runTurn.
  live.isProcessing = true;

  log.info(`sendMessage: vault=${vaultId}, session=${sessionId}, warm=${live.piSession !== null}`);

  try {
    let result: SessionQueryResult;
    let isNewSession: boolean;

    if (live.piSession) {
      // Warm reuse: the session is already open, no re-resume needed.
      result = { sessionId, piSession: live.piSession };
      isNewSession = false;
    } else {
      const permCallback = createToolPermissionCallback(sessionId);
      const questionCallback = createAskUserQuestionCallback(sessionId);
      const existingMetadata = await loadSession(vaultPath, sessionId);

      if (existingMetadata) {
        // Cold start / resume from Ground: metadata exists, reopen from disk.
        result = await sdkResumeSession(vaultPath, sessionId, permCallback, questionCallback);
        isNewSession = false;
      } else {
        // Brand-new conversation with a client-minted id.
        const vault = { id: vaultId, path: vaultPath } as VaultInfo;
        result = await sdkCreateSession(vault, permCallback, questionCallback, sessionId);
        isNewSession = true;
      }
      live.piSession = result.piSession;
    }

    // Fire and forget — processing continues independently of the caller.
    void runTurn(live, result, prompt, isNewSession);
  } catch (err) {
    // Setup failed before runTurn took over the flag's lifecycle, so the
    // generation-guarded finally in runTurn will never run for this attempt.
    // Release the claim here so the session is not wedged "processing" forever.
    live.isProcessing = false;

    log.error(`sendMessage failed for ${sessionId}`, err);
    const code =
      err instanceof Error && (err as { code?: string }).code === "RESUME_FAILED"
        ? "RESUME_FAILED"
        : "SDK_ERROR";
    emitToSession(sessionId, {
      type: "error",
      code,
      message: err instanceof Error ? err.message : "Failed to send message",
    });
    throw err; // Re-throw so the POST handler returns an HTTP error.
  }
}

/**
 * Aborts the current turn for a session, persisting any partial result.
 * REQ-ESS-19: aborting while prompts are pending emits `aborted` (not error).
 */
export function abortProcessing(id: string): void {
  log.info(`Aborting processing for ${id}`);

  const live = getLiveSession(id);
  if (!live || !live.isProcessing) {
    log.warn(`No active processing to abort for ${id}`);
    return;
  }

  const hadPendingPrompts = hasPendingPrompts(live);

  if (live.piSession) {
    try {
      live.piSession.abort().catch((err: unknown) => {
        log.error("Async abort failed", err);
      });
    } catch (err) {
      log.warn("Failed to abort pi-agent session", err);
    }
  }

  discardPendingPrompts(live);

  // REQ-ESS-19: if prompts were pending, emit aborted (terminal, non-error).
  if (hadPendingPrompts) {
    emitToSession(id, { type: "aborted" });
  }
}

/**
 * Clears a session: aborts its pi session, discards its pending prompts, bumps
 * its generation (so the running turn's finally skips cleanup), removes it from
 * the registry, and emits session_cleared to that session only.
 *
 * REQ-SDC-6: this is per-id. Clearing A never touches B.
 */
export function clearSession(id: string): void {
  log.info(`Clearing session ${id}`);

  const live = getLiveSession(id);
  if (!live) {
    // Still emit so any stray subscriber resolves; emitToSession is a no-op
    // for an unknown id, so nothing happens — which is the correct outcome.
    return;
  }

  if (live.piSession) {
    try {
      void live.piSession.abort();
    } catch (err) {
      log.warn("Failed to abort pi-agent session", err);
    }
  }

  discardPendingPrompts(live);

  // Invalidate any running generation so its finally block skips cleanup.
  live.generation++;

  // Emit session_cleared BEFORE deleting so the event reaches subscribers.
  emitToSession(id, { type: "session_cleared" });

  deleteLiveSession(id);
}

/**
 * Registers a subscriber for a session. Delegates to the registry.
 */
export function subscribe(
  id: string,
  subscriberId: string,
  callback: SessionEventCallback
): void {
  addSubscriber(id, subscriberId, callback);
}

/**
 * Removes a subscriber for a session. Delegates to the registry.
 */
export function unsubscribe(id: string, subscriberId: string): void {
  removeSubscriber(id, subscriberId);
}

/**
 * Responds to a pending prompt for a session. Resolves the matching pending
 * request then emits prompt_resolved (or prompt_response_rejected if not found).
 */
export function respondToPrompt(
  id: string,
  promptId: string,
  response: PromptResponse
): void {
  log.info(`Responding to prompt ${promptId} for ${id}`);

  const live = getLiveSession(id);
  if (!live) {
    log.warn(`respondToPrompt: no session ${id}`);
    emitToSession(id, { type: "prompt_response_rejected", promptId, reason: "not_found" });
    return;
  }

  let resolved = false;
  if (response.type === "tool_permission") {
    const pending = live.pendingPermissions.get(promptId);
    if (pending) {
      live.pendingPermissions.delete(promptId);
      pending.resolve(response.allowed);
      resolved = true;
    }
  } else if (response.type === "ask_user_question") {
    const pending = live.pendingQuestions.get(promptId);
    if (pending) {
      live.pendingQuestions.delete(promptId);
      pending.resolve(response.answers);
      resolved = true;
    }
  }

  if (resolved) {
    emitToSession(id, { type: "prompt_resolved", promptId });
  } else {
    log.warn(`Prompt not found: ${promptId} for ${id}`);
    emitToSession(id, { type: "prompt_response_rejected", promptId, reason: "not_found" });
  }
}

/** Returns the pending prompts for a session. Delegates to the registry. */
export function getPendingPrompts(id: string): PendingPrompt[] {
  return registryCollectPendingPrompts(id);
}

/** Returns whether a session is currently processing a turn. */
export function isProcessing(id: string): boolean {
  return registryIsProcessing(id);
}

/**
 * Returns the current state for a session. isStreaming derives from
 * isProcessing (the old controller's two near-identical flags collapse to one).
 */
export function getState(id: string): SessionState {
  const live = getLiveSession(id);
  if (!live) {
    return {
      sessionId: null,
      vaultId: null,
      cumulativeTokens: 0,
      contextWindow: null,
      activeModel: null,
      isStreaming: false,
    };
  }
  return {
    sessionId: live.sessionId,
    vaultId: live.vaultId,
    cumulativeTokens: live.streamer.cumulativeTokens,
    contextWindow: live.streamer.contextWindow,
    activeModel: live.streamer.activeModel,
    isStreaming: live.isProcessing,
  };
}

/**
 * Returns a point-in-time snapshot of a session's processing state. Phase 2's
 * stream route primarily replays the event buffer; this is kept for getState
 * parity and any caller that still wants a reconstructed snapshot.
 */
export function getSnapshot(id: string): SessionSnapshot {
  const live = getLiveSession(id);
  if (!live) {
    return {
      sessionId: null,
      isProcessing: false,
      content: "",
      toolInvocations: [],
      pendingPrompts: [],
      cumulativeTokens: 0,
      contextWindow: null,
    };
  }
  const snapshot = getStreamingSnapshot(live);
  return {
    sessionId: live.sessionId,
    isProcessing: live.isProcessing,
    content: snapshot.content,
    toolInvocations: snapshot.toolInvocations,
    pendingPrompts: registryCollectPendingPrompts(id),
    contextUsage: snapshot.contextUsage,
    cumulativeTokens: live.streamer.cumulativeTokens,
    contextWindow: live.streamer.contextWindow,
  };
}

/** Returns a copy of the session's event buffer for replay on reconnect. */
export function getReplayBuffer(id: string): SessionEvent[] {
  return getEventBuffer(id);
}

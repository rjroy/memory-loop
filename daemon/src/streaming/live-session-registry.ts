/**
 * Live Session Registry
 *
 * Replaces the single-slot ActiveSessionController with per-session live state
 * keyed by session id (Phase 0 of the keyed-sessions refactor; see
 * .lore/plans/think-tab-keyed-sessions.md §1).
 *
 * Today `active-session-controller.ts` keeps the live turn as module-level
 * variables (currentSessionId, queryResult, isProcessing, currentResponseChunks,
 * currentToolsMap, currentContextUsage, pendingPermissions, pendingQuestions,
 * subscribers, streamerState, currentGeneration). Those exact fields become the
 * value type of a map, so two conversations can have live turns concurrently
 * without interfering, and a stream for session X always reflects X's state.
 *
 * This module is a pure data-structure + helpers layer. It does NOT drive a
 * pi-agent turn: runStreaming, prompt callbacks, snapshot reconstruction, and
 * the turn state machine arrive in Phase 1. Nothing wires routes into this yet.
 *
 * HMR note: the daemon is a stable long-running process (see the comment in
 * session-controller.ts), so a plain module-level Map is correct here. Unlike
 * oracle-keep, which runs inside Next.js and needs globalThis to survive HMR,
 * the daemon never hot-reloads this module under a live session, so globalThis
 * is unnecessary.
 */

import type {
  SessionEvent,
  SessionEventCallback,
  PendingPrompt,
  StoredToolInvocation,
} from "@memory-loop/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@memory-loop/shared";
import type {
  PendingPermissionRequest,
  PendingQuestionRequest,
} from "./types";

const log = createLogger("LiveSessionRegistry");

/**
 * Per-turn token accumulation state.
 *
 * Mirrors the StreamerState in active-session-controller.ts. Cumulative across
 * turns for a given session (it lives on the LiveSession, which is warm across
 * turns), reset by Phase 1's turn logic when a new session starts.
 */
export interface LiveStreamerState {
  cumulativeTokens: number;
  contextWindow: number | null;
  activeModel: string | null;
}

/**
 * The complete live state for one session, keyed by session id in the registry.
 *
 * These fields are the per-session equivalents of the module-level variables in
 * active-session-controller.ts, plus `eventBuffer`, the new piece that replaces
 * the reconstructed snapshot (see plan §3): the buffer is replayed verbatim to a
 * reconnecting subscriber instead of flattening text+tool ordering into a single
 * content blob.
 */
export interface LiveSession {
  /** Session id; also the registry key. */
  sessionId: string;
  /** Vault this session belongs to. */
  vaultId: string;
  /** Vault root path (for config/session persistence). */
  vaultPath: string;
  /**
   * The warm pi-agent session. Null until the first prompt creates or resumes
   * it. Phase 1 keeps it warm across turns; cold-start after daemon restart
   * reopens it from disk.
   */
  piSession: AgentSession | null;
  /** Whether a turn is currently running for this session. */
  isProcessing: boolean;
  /**
   * Events emitted during the current turn, in order, for replay to a
   * reconnecting subscriber. Cleared at turn start by Phase 1.
   */
  eventBuffer: SessionEvent[];
  /**
   * Active subscribers for this session, keyed by a caller-supplied subscriber
   * id so removal is unambiguous (one stream connection cannot accidentally
   * remove another's callback). Events for this session reach only these
   * callbacks, never another session's.
   */
  subscribers: Map<string, SessionEventCallback>;
  /** Pending tool-permission prompts awaiting a user response, keyed by toolUseId. */
  pendingPermissions: Map<string, PendingPermissionRequest>;
  /** Pending AskUserQuestion prompts awaiting a user response, keyed by toolUseId. */
  pendingQuestions: Map<string, PendingQuestionRequest>;
  /** Accumulated assistant text chunks for the current turn. */
  responseChunks: string[];
  /** Tool invocations tracked during the current turn, keyed by toolUseId. */
  toolsMap: Map<string, StoredToolInvocation>;
  /** Latest reported context-usage percentage for the current turn. */
  contextUsage: number | undefined;
  /** Token/model accumulation across turns for this session. */
  streamer: LiveStreamerState;
  /**
   * Monotonic turn counter. Phase 1 uses it to invalidate stale cleanup when a
   * session is cleared or replaced mid-turn (the same pattern as the current
   * controller's currentGeneration).
   */
  generation: number;
}

/**
 * The live session map. Module-level by design (see file header): the daemon is
 * a stable long-running process, so this survives for the daemon's lifetime and
 * is shared across all callers in this process.
 */
const sessions = new Map<string, LiveSession>();

/**
 * Builds an empty LiveSession with sane defaults and registers it in the map.
 *
 * Idempotent: if a session with this id already exists, the existing instance is
 * returned unchanged rather than throwing or clobbering live state. This is the
 * safer choice because a concurrent request for an already-live session must not
 * discard its in-flight turn, subscribers, or pending prompts. Phase 1's
 * create-vs-resume collision handling lives in session-manager.ts, not here.
 */
export function createLiveSession(
  id: string,
  vaultId: string,
  vaultPath: string
): LiveSession {
  const existing = sessions.get(id);
  if (existing) {
    log.debug(`createLiveSession: ${id} already exists, returning existing`);
    return existing;
  }

  const session: LiveSession = {
    sessionId: id,
    vaultId,
    vaultPath,
    piSession: null,
    isProcessing: false,
    eventBuffer: [],
    subscribers: new Map(),
    pendingPermissions: new Map(),
    pendingQuestions: new Map(),
    responseChunks: [],
    toolsMap: new Map(),
    contextUsage: undefined,
    streamer: {
      cumulativeTokens: 0,
      contextWindow: null,
      activeModel: null,
    },
    generation: 0,
  };

  sessions.set(id, session);
  log.debug(`createLiveSession: registered ${id} (vault=${vaultId})`);
  return session;
}

/**
 * Returns the live session for an id, or undefined if none is registered.
 */
export function getLiveSession(id: string): LiveSession | undefined {
  return sessions.get(id);
}

/**
 * Returns true if a live session is registered for the id.
 */
export function hasLiveSession(id: string): boolean {
  return sessions.has(id);
}

/**
 * Removes a live session from the registry. Safe no-op if the id is unknown.
 */
export function deleteLiveSession(id: string): void {
  if (sessions.delete(id)) {
    log.debug(`deleteLiveSession: removed ${id}`);
  }
}

/**
 * Appends an event to a session's buffer without notifying subscribers.
 * Safe no-op if the id is unknown.
 *
 * Use this for events that should be replayable on reconnect but were not
 * broadcast live. Most call sites should use emitToSession, which buffers AND
 * notifies.
 */
export function bufferEvent(id: string, event: SessionEvent): void {
  const session = sessions.get(id);
  if (!session) {
    log.debug(`bufferEvent: no session ${id}, ignoring`);
    return;
  }
  session.eventBuffer.push(event);
}

/**
 * Clears a session's event buffer (called at turn start). Safe no-op if unknown.
 */
export function clearEventBuffer(id: string): void {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  session.eventBuffer = [];
}

/**
 * Returns a copy of a session's event buffer (so callers cannot mutate internal
 * state). Empty array if the id is unknown.
 */
export function getEventBuffer(id: string): SessionEvent[] {
  const session = sessions.get(id);
  if (!session) {
    return [];
  }
  return [...session.eventBuffer];
}

/**
 * Emits an event to a single session: appends it to that session's buffer AND
 * delivers it to every one of that session's subscribers.
 *
 * Each subscriber callback is wrapped in try/catch (errors logged, never
 * propagated), so one misbehaving subscriber cannot block delivery to the rest
 * or throw out of this function. Events for one session NEVER reach another
 * session's subscribers (the core isolation guarantee). Safe no-op if unknown.
 */
export function emitToSession(id: string, event: SessionEvent): void {
  const session = sessions.get(id);
  if (!session) {
    log.debug(`emitToSession: no session ${id}, ignoring ${event.type}`);
    return;
  }

  session.eventBuffer.push(event);

  for (const callback of session.subscribers.values()) {
    try {
      callback(event);
    } catch (err) {
      log.error(`Subscriber callback threw for session ${id}`, err);
    }
  }
}

/**
 * Registers a subscriber callback for a session under a subscriber id.
 * Safe no-op if the session id is unknown. A repeated subscriber id replaces the
 * previous callback for that id.
 */
export function addSubscriber(
  id: string,
  subscriberId: string,
  callback: SessionEventCallback
): void {
  const session = sessions.get(id);
  if (!session) {
    log.debug(`addSubscriber: no session ${id}, ignoring ${subscriberId}`);
    return;
  }
  session.subscribers.set(subscriberId, callback);
  log.debug(
    `addSubscriber: ${subscriberId} added to ${id}, total: ${session.subscribers.size}`
  );
}

/**
 * Removes a subscriber from a session by subscriber id. Safe no-op if the
 * session id or subscriber id is unknown.
 */
export function removeSubscriber(id: string, subscriberId: string): void {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  if (session.subscribers.delete(subscriberId)) {
    log.debug(
      `removeSubscriber: ${subscriberId} removed from ${id}, total: ${session.subscribers.size}`
    );
  }
}

/**
 * Returns whether a session is currently processing a turn. False for unknown ids.
 */
export function isProcessing(id: string): boolean {
  return sessions.get(id)?.isProcessing ?? false;
}

/**
 * Sets a session's processing flag. Safe no-op if the id is unknown.
 */
export function setProcessing(id: string, value: boolean): void {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  session.isProcessing = value;
}

/**
 * Collects a session's pending prompts (permissions and questions) as a flat
 * array. Empty array if the id is unknown.
 */
export function collectPendingPrompts(id: string): PendingPrompt[] {
  const session = sessions.get(id);
  if (!session) {
    return [];
  }
  return [
    ...Array.from(session.pendingPermissions.values(), (r) => r.prompt),
    ...Array.from(session.pendingQuestions.values(), (r) => r.prompt),
  ];
}

/**
 * Clears the entire registry. Test-only: the map is module-level, so tests need
 * a clean slate between cases.
 */
export function resetForTesting(): void {
  sessions.clear();
}

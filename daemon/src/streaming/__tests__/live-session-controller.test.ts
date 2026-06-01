/**
 * Live Session Controller Tests (keyed)
 *
 * Verifies the per-id turn state machine ported from active-session-controller:
 * happy-path turn + buffer, two-session isolation, warm reuse, REQ-SDC-2,
 * REQ-ESS-19, partial persistence, clearSession, and the client-minted id
 * create-vs-resume branch.
 *
 * Injects a fake pi AgentSession via configurePiSessionForTesting (no
 * mock.module, per CLAUDE.md). The registry is module-level state, so each test
 * resets it via resetForTesting().
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SessionEvent } from "@memory-loop/shared";
import {
  configurePiSessionForTesting,
  _resetPiSessionForTesting,
} from "../../pi-session-factory";
import type { PiSessionResult } from "../../pi-session-factory";
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionEventListener,
} from "@earendil-works/pi-coding-agent";
import {
  sendMessage,
  abortProcessing,
  clearSession,
  subscribe,
  isProcessing,
  getState,
  getSnapshot,
  getReplayBuffer,
} from "../live-session-controller";
import { resetForTesting, getLiveSession, createLiveSession } from "../live-session-registry";
import { saveSession, loadSession } from "../../session-manager";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join("/tmp/claude-1000", "live-controller-test-"));
  await mkdir(join(tempDir, ".memory-loop", "sessions"), { recursive: true });
  await Bun.write(join(tempDir, "CLAUDE.md"), "# Test Vault\n");
  resetForTesting();
});

afterEach(async () => {
  resetForTesting();
  _resetPiSessionForTesting();
  await rm(tempDir, { recursive: true, force: true });
});

// =============================================================================
// Test helpers
// =============================================================================

interface MockSessionOpts {
  onSubscribe?: (listener: AgentSessionEventListener) => () => void;
  promptImpl?: () => Promise<void>;
  abortImpl?: () => Promise<void>;
  sessionFile?: string;
}

function makeMockAgentSession(opts?: MockSessionOpts): AgentSession {
  const subscribers = new Set<AgentSessionEventListener>();
  return {
    sessionFile: opts?.sessionFile ?? "/tmp/mock-session.jsonl",
    sessionId: "mock-session-id",
    sessionName: undefined,
    scopedModels: [],
    isStreaming: false,
    state: { messages: [] },
    messages: [],
    modelRegistry: { find: () => undefined },
    bindExtensions: async () => {},
    setModel: async () => {},
    subscribe: (listener: AgentSessionEventListener) => {
      if (opts?.onSubscribe) return opts.onSubscribe(listener);
      subscribers.add(listener);
      return () => { subscribers.delete(listener); };
    },
    prompt: opts?.promptImpl ?? (() => Promise.resolve()),
    abort: opts?.abortImpl ?? (() => Promise.resolve()),
  } as unknown as AgentSession;
}

function makeMockPiSessionResult(session: AgentSession): PiSessionResult {
  return { session, jsonlPath: session.sessionFile ?? "/tmp/mock-session.jsonl" };
}

/** A fixed UUID-shaped id (validateSessionId requires a path-safe id). */
const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";

/**
 * Collects events for a session until a terminal event or timeout.
 *
 * Pre-creates the live session and attaches the subscriber BEFORE the caller
 * runs sendMessage, so the synchronous early emits of runTurn (session_ready,
 * response_start) are captured. createLiveSession is idempotent, so sendMessage
 * reuses this same entry.
 */
function collectFor(id: string, opts?: { timeout?: number }): { events: SessionEvent[]; done: Promise<SessionEvent[]> } {
  createLiveSession(id, "v1", tempDir);
  const events: SessionEvent[] = [];
  const timeout = opts?.timeout ?? 1000;
  const done = new Promise<SessionEvent[]>((resolve) => {
    const timer = setTimeout(() => resolve(events), timeout);
    subscribe(id, `sub-${id}`, (event) => {
      events.push(event);
      if (
        event.type === "response_end" ||
        event.type === "error" ||
        event.type === "aborted" ||
        event.type === "session_cleared"
      ) {
        clearTimeout(timer);
        setTimeout(() => resolve(events), 30);
      }
    });
  });
  return { events, done };
}

// =============================================================================
// Happy path
// =============================================================================

describe("happy-path turn", () => {
  test("emits response_start, chunks, tool events, response_end and persists the assistant message", async () => {
    let listener: AgentSessionEventListener | null = null;
    const session = makeMockAgentSession({
      onSubscribe: (l) => { listener = l; return () => {}; },
      promptImpl: async () => {
        listener?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Hello" },
        } as AgentSessionEvent);
        listener?.({
          type: "tool_execution_start",
          toolCallId: "tool-1",
          toolName: "Read",
          args: { path: "x.ts" },
        } as unknown as AgentSessionEvent);
        listener?.({
          type: "tool_execution_update",
          toolCallId: "tool-1",
          partialResult: { content: [{ type: "text", text: "file body" }] },
        } as AgentSessionEvent);
      },
    });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    // collectFor pre-creates the session and attaches the subscriber so the
    // fire-and-forget turn's early emits are captured.
    const { done } = collectFor(ID_A);
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "hi" });
    const events = await done;

    const types = events.map((e) => e.type);
    expect(types).toContain("session_ready");
    expect(types).toContain("response_start");

    const chunks = events.filter((e) => e.type === "response_chunk");
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as { content: string }).content).toBe("Hello");

    expect(events.find((e) => e.type === "tool_start")).toBeDefined();
    expect(events.find((e) => e.type === "tool_end")).toBeDefined();
    expect(events.find((e) => e.type === "response_end")).toBeDefined();

    // Event buffer contains the turn's events (terminal already buffered).
    const buffer = getReplayBuffer(ID_A);
    expect(buffer.map((e) => e.type)).toContain("response_end");

    // Assistant message persisted to metadata.
    const meta = await loadSession(tempDir, ID_A);
    expect(meta).not.toBeNull();
    const assistant = meta!.messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.content).toBe("Hello");
  });
});

// =============================================================================
// Two-session isolation
// =============================================================================

describe("two-session isolation", () => {
  test("events for A never reach B's subscribers and both process independently", async () => {
    // Holder objects keep TS from narrowing these to `null` at the call site
    // (the assignments happen inside callbacks TS can't trace).
    const cap: {
      listenerA?: AgentSessionEventListener;
      listenerB?: AgentSessionEventListener;
      resolveA?: () => void;
      resolveB?: () => void;
    } = {};

    const sessionA = makeMockAgentSession({
      onSubscribe: (l) => { cap.listenerA = l; return () => {}; },
      promptImpl: () => new Promise<void>((r) => { cap.resolveA = r; }),
    });
    const sessionB = makeMockAgentSession({
      onSubscribe: (l) => { cap.listenerB = l; return () => {}; },
      promptImpl: () => new Promise<void>((r) => { cap.resolveB = r; }),
    });

    // Return the right fake based on which id is being created.
    // Both are new conversations (no metadata), so createSession path runs.
    let call = 0;
    configurePiSessionForTesting(async () => {
      call++;
      return makeMockPiSessionResult(call === 1 ? sessionA : sessionB);
    });

    const eventsA: SessionEvent[] = [];
    const eventsB: SessionEvent[] = [];

    // Start A, then attach subscriber (live session now exists).
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "a" });
    subscribe(ID_A, "watch-a", (e) => eventsA.push(e));

    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_B, prompt: "b" });
    subscribe(ID_B, "watch-b", (e) => eventsB.push(e));

    // runTurn subscribes to the pi session after its initial awaits, so wait a
    // tick for listenerA/listenerB to be captured before driving events.
    await new Promise((r) => setTimeout(r, 20));

    // Both are processing concurrently.
    expect(isProcessing(ID_A)).toBe(true);
    expect(isProcessing(ID_B)).toBe(true);

    // Drive A's stream only.
    cap.listenerA?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "A-only" },
    } as AgentSessionEvent);
    // Drive B's stream only.
    cap.listenerB?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "B-only" },
    } as AgentSessionEvent);

    await new Promise((r) => setTimeout(r, 20));

    const aChunks = eventsA.filter((e) => e.type === "response_chunk").map((e) => (e as { content: string }).content);
    const bChunks = eventsB.filter((e) => e.type === "response_chunk").map((e) => (e as { content: string }).content);
    expect(aChunks).toEqual(["A-only"]);
    expect(bChunks).toEqual(["B-only"]);

    // Resolve both turns so cleanup runs.
    cap.resolveA?.();
    cap.resolveB?.();
    await new Promise((r) => setTimeout(r, 30));

    expect(isProcessing(ID_A)).toBe(false);
    expect(isProcessing(ID_B)).toBe(false);
  });
});

// =============================================================================
// Warm reuse
// =============================================================================

describe("warm reuse", () => {
  test("second sendMessage for the same id reuses piSession (no re-open)", async () => {
    let openCount = 0;
    const session = makeMockAgentSession({ promptImpl: async () => {} });
    configurePiSessionForTesting(async () => {
      openCount++;
      return makeMockPiSessionResult(session);
    });

    const { done: done1 } = collectFor(ID_A);
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "first" });
    await done1;

    expect(openCount).toBe(1);
    expect(getLiveSession(ID_A)?.piSession).toBe(session);

    const { done: done2 } = collectFor(ID_A, { timeout: 1000 });
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "second" });
    await done2;

    // Warm reuse: the factory was NOT called again.
    expect(openCount).toBe(1);
  });
});

// =============================================================================
// REQ-SDC-2: already processing
// =============================================================================

describe("REQ-SDC-2", () => {
  test("sendMessage on a processing session throws AlreadyProcessingError", async () => {
    // No-op default avoids TS narrowing the var to `never` at the top-level call.
    let resolvePrompt: () => void = () => {};
    const session = makeMockAgentSession({
      promptImpl: () => new Promise<void>((r) => { resolvePrompt = r; }),
    });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "first" });
    expect(isProcessing(ID_A)).toBe(true);

    await expect(
      sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "second" })
    ).rejects.toThrow("currently being processed");

    resolvePrompt();
    await new Promise((r) => setTimeout(r, 20));
  });

  test("two near-simultaneous sends for the SAME id open the pi session exactly once", async () => {
    // Gate the factory so the first send is still mid-setup (before runTurn)
    // when the second send fires. This is the TOCTOU window: if isProcessing is
    // only set inside runTurn, both sends pass the guard and both open a pi
    // session, the second clobbering live.piSession. Setting the flag
    // synchronously in sendMessage closes that window — the second must reject.
    let openCount = 0;
    let releaseFactory: () => void = () => {};
    const factoryGate = new Promise<void>((r) => { releaseFactory = r; });
    let resolvePrompt: () => void = () => {};
    const session = makeMockAgentSession({
      promptImpl: () => new Promise<void>((r) => { resolvePrompt = r; }),
    });
    configurePiSessionForTesting(async () => {
      openCount++;
      await factoryGate; // hold the first send inside setup
      return makeMockPiSessionResult(session);
    });

    // Fire both WITHOUT awaiting the first, so the second's guard runs while the
    // first is parked in the factory.
    const first = sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "first" });
    const second = sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "second" });

    await expect(second).rejects.toThrow("currently being processed");

    // Let the first send complete setup and start its turn.
    releaseFactory();
    await first;
    await new Promise((r) => setTimeout(r, 20));

    // The factory ran for the first send only — no clobber.
    expect(openCount).toBe(1);
    expect(getLiveSession(ID_A)?.piSession).toBe(session);

    resolvePrompt();
    await new Promise((r) => setTimeout(r, 20));
  });

  test("a failed setup resets isProcessing so the session is not wedged", async () => {
    // Factory rejects => sendMessage's catch must clear the flag, otherwise a
    // retry would falsely throw AlreadyProcessingError forever.
    configurePiSessionForTesting(async () => {
      throw new Error("factory boom");
    });

    await expect(
      sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "go" })
    ).rejects.toThrow();

    expect(isProcessing(ID_A)).toBe(false);
  });
});

// =============================================================================
// REQ-ESS-19: abort with pending prompt
// =============================================================================

describe("REQ-ESS-19", () => {
  test("abort with a pending prompt emits aborted, not error", async () => {
    let resolvePrompt: (() => void) | null = null;
    const session = makeMockAgentSession({
      promptImpl: () => new Promise<void>((r) => { resolvePrompt = r; }),
      abortImpl: async () => { resolvePrompt?.(); },
    });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    const events: SessionEvent[] = [];
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "go" });
    subscribe(ID_A, "watch", (e) => events.push(e));

    // Wait for runTurn to attach live.piSession before aborting.
    await new Promise((r) => setTimeout(r, 20));

    // Inject a pending prompt directly onto the live session.
    const live = getLiveSession(ID_A)!;
    live.pendingPermissions.set("p-1", {
      prompt: { id: "p-1", type: "tool_permission", toolName: "Read", input: {} },
      resolve: () => {},
      reject: () => {},
    });

    abortProcessing(ID_A);
    await new Promise((r) => setTimeout(r, 30));

    expect(events.find((e) => e.type === "aborted")).toBeDefined();
    expect(events.find((e) => e.type === "error")).toBeUndefined();
  });

  test("abort with no pending prompts does not emit aborted", async () => {
    let resolvePrompt: (() => void) | null = null;
    const session = makeMockAgentSession({
      promptImpl: () => new Promise<void>((r) => { resolvePrompt = r; }),
      abortImpl: async () => { resolvePrompt?.(); },
    });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    const events: SessionEvent[] = [];
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "go" });
    subscribe(ID_A, "watch", (e) => events.push(e));

    // Wait for runTurn to attach live.piSession before aborting.
    await new Promise((r) => setTimeout(r, 20));

    abortProcessing(ID_A);
    await new Promise((r) => setTimeout(r, 30));

    expect(events.filter((e) => e.type === "aborted")).toHaveLength(0);
    expect(isProcessing(ID_A)).toBe(false);
  });
});

// =============================================================================
// Partial persistence on error
// =============================================================================

describe("partial persistence", () => {
  test("partial assistant content is persisted when prompt() rejects mid-stream", async () => {
    let listener: AgentSessionEventListener | null = null;
    const session = makeMockAgentSession({
      onSubscribe: (l) => { listener = l; return () => {}; },
      promptImpl: async () => {
        listener?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "partial " },
        } as AgentSessionEvent);
        listener?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "answer" },
        } as AgentSessionEvent);
        throw new Error("Subprocess crashed");
      },
    });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    const { done } = collectFor(ID_A);
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "go" });
    const events = await done;

    expect(events.find((e) => e.type === "error")).toBeDefined();

    const meta = await loadSession(tempDir, ID_A);
    const assistant = meta!.messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.content).toBe("partial answer");
  });
});

// =============================================================================
// clearSession isolation
// =============================================================================

describe("clearSession", () => {
  test("removes only the target session, discards its prompts, emits session_cleared", async () => {
    const sessionA = makeMockAgentSession({ promptImpl: async () => {} });
    const sessionB = makeMockAgentSession({ promptImpl: async () => {} });
    let call = 0;
    configurePiSessionForTesting(async () => {
      call++;
      return makeMockPiSessionResult(call === 1 ? sessionA : sessionB);
    });

    const { done: doneA } = collectFor(ID_A);
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "a" });
    await doneA;

    const { done: doneB } = collectFor(ID_B);
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_B, prompt: "b" });
    await doneB;

    // Inject a pending prompt onto A and a reject spy.
    let rejected = false;
    getLiveSession(ID_A)!.pendingPermissions.set("p-1", {
      prompt: { id: "p-1", type: "tool_permission", toolName: "Read", input: {} },
      resolve: () => {},
      reject: () => { rejected = true; },
    });

    const clearEvents: SessionEvent[] = [];
    subscribe(ID_A, "watch-clear", (e) => clearEvents.push(e));

    clearSession(ID_A);

    expect(clearEvents.find((e) => e.type === "session_cleared")).toBeDefined();
    expect(rejected).toBe(true);
    expect(getLiveSession(ID_A)).toBeUndefined();
    // B is untouched.
    expect(getLiveSession(ID_B)).toBeDefined();
  });
});

// =============================================================================
// Client-minted id: create-vs-resume
// =============================================================================

describe("client-minted id", () => {
  test("create path writes metadata under the supplied id", async () => {
    const session = makeMockAgentSession({ promptImpl: async () => {} });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    const { done } = collectFor(ID_A);
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "hi" });
    await done;

    const meta = await loadSession(tempDir, ID_A);
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe(ID_A);
  });

  test("cold-start reopen uses resumeSession when metadata already exists", async () => {
    // Pre-seed metadata WITH a piSessionPath so resumeSession succeeds.
    await saveSession({
      id: ID_A,
      vaultId: "v1",
      vaultPath: tempDir,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      piSessionPath: "/tmp/mock-resume.jsonl",
      messages: [
        { id: "m1", role: "user", content: "earlier", timestamp: new Date().toISOString() },
        { id: "m2", role: "assistant", content: "prior reply", timestamp: new Date().toISOString() },
      ],
    });

    const session = makeMockAgentSession({ promptImpl: async () => {} });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    const { done } = collectFor(ID_A);
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "continue" });
    const events = await done;

    // Resume path => session_ready carries previousMessages.
    const ready = events.find((e) => e.type === "session_ready") as
      | { type: "session_ready"; messages?: unknown[] }
      | undefined;
    expect(ready).toBeDefined();
    expect(ready!.messages).toHaveLength(2);
  });
});

// =============================================================================
// State / snapshot readers
// =============================================================================

describe("state readers", () => {
  test("getState and getSnapshot are idle for an unknown id", () => {
    expect(getState("unknown")).toMatchObject({ sessionId: null, isStreaming: false });
    expect(getSnapshot("unknown")).toMatchObject({ sessionId: null, isProcessing: false });
  });

  test("getState reports the session after a completed turn", async () => {
    const session = makeMockAgentSession({ promptImpl: async () => {} });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    const { done } = collectFor(ID_A);
    await sendMessage({ vaultId: "v1", vaultPath: tempDir, sessionId: ID_A, prompt: "hi" });
    await done;

    const state = getState(ID_A);
    expect(state.sessionId).toBe(ID_A);
    expect(state.vaultId).toBe("v1");
    expect(state.isStreaming).toBe(false);
  });
});

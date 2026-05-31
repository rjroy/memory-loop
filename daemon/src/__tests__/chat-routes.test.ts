/**
 * Chat Routes Integration Tests (keyed)
 *
 * Tests the daemon's keyed session/chat API surface via Hono's test request
 * method. Routes are keyed by `:sessionId` in the path (Phase 2 of the
 * keyed-sessions refactor). Uses an injected fake pi session (no mock.module,
 * per CLAUDE.md) and resets the module-level live registry between tests.
 *
 * Coverage:
 * - POST /session/:id/chat starts a turn and returns { sessionId }; 409 when the
 *   session is already processing.
 * - GET /session/:id/chat replays the buffer then closes when not processing;
 *   stays live when processing.
 * - Route-level isolation: GET /session/:idB/chat while A is the most recently
 *   active returns B's own (empty) state, never A's events. (Regression test for
 *   the original wrong-session bug.)
 * - abort/permission/answer/clear/state keyed correctly; no session-mismatch 409.
 * - Hono route disambiguation: keyed `:sessionId` routes do not collide with
 *   `/session/lookup/:vaultId`, `/session/init/:vaultId`, or DELETE
 *   `/session/:vaultId/:sessionId`.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../server";
import { resetForTesting, createLiveSession } from "../streaming/live-session-registry";
import { subscribe, getReplayBuffer } from "../streaming/live-session-controller";
import {
  configurePiSessionForTesting,
  _resetPiSessionForTesting,
  type PiSessionResult,
} from "../pi-session-factory";
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionEventListener,
} from "@earendil-works/pi-coding-agent";
import type { SessionEvent } from "@memory-loop/shared";

const startTime = Date.now();
let tempDir: string;

// UUID-shaped ids (validateSessionId requires a path-safe id for the create path).
const ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const originalVaultsDir = process.env.VAULTS_DIR;
const originalMockSdk = process.env.MOCK_SDK;

beforeEach(async () => {
  tempDir = await mkdtemp(join("/tmp/claude-1000", "chat-routes-test-"));
  await mkdir(join(tempDir, ".memory-loop", "sessions"), { recursive: true });
  await Bun.write(join(tempDir, "CLAUDE.md"), "# Test Vault\n");
  resetForTesting();
});

afterEach(async () => {
  resetForTesting();
  _resetPiSessionForTesting();
  await rm(tempDir, { recursive: true, force: true });

  if (originalVaultsDir !== undefined) {
    process.env.VAULTS_DIR = originalVaultsDir;
  } else {
    delete process.env.VAULTS_DIR;
  }
  if (originalMockSdk !== undefined) {
    process.env.MOCK_SDK = originalMockSdk;
  } else {
    delete process.env.MOCK_SDK;
  }
});

// =============================================================================
// Test helpers
// =============================================================================

interface MockSessionOpts {
  onSubscribe?: (listener: AgentSessionEventListener) => () => void;
  promptImpl?: () => Promise<void>;
  abortImpl?: () => Promise<void>;
}

function makeMockAgentSession(opts?: MockSessionOpts): AgentSession {
  const subscribers = new Set<AgentSessionEventListener>();
  return {
    sessionFile: "/tmp/mock-session.jsonl",
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

/** A fast-completing session whose prompt resolves immediately. */
function configureCompletingSession(): void {
  const session = makeMockAgentSession({ promptImpl: async () => {} });
  configurePiSessionForTesting(async () => makeMockPiSessionResult(session));
}

/** Parses an SSE response body into an array of JSON event payloads. */
function parseSSEEvents(text: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data) {
        try {
          events.push(JSON.parse(data) as SessionEvent);
        } catch {
          // Skip non-JSON data lines (keep-alive).
        }
      }
    }
  }
  return events;
}

/** Runs a turn to completion via the controller, so the buffer holds the events. */
async function runCompletedTurn(id: string): Promise<void> {
  configureCompletingSession();
  const app = createApp(startTime);
  const res = await app.request(`/session/${id}/chat`, {
    method: "POST",
    body: JSON.stringify({ vaultId: "v1", vaultPath: tempDir, prompt: "hi" }),
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status).toBe(200);
  // Let the fire-and-forget turn finish.
  await new Promise((r) => setTimeout(r, 40));
}

// =============================================================================
// POST /session/:sessionId/chat
// =============================================================================

describe("POST /session/:sessionId/chat", () => {
  test("returns 400 for invalid JSON", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/chat`, {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_JSON");
  });

  test("returns 400 for missing required fields", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/chat`, {
      method: "POST",
      body: JSON.stringify({ vaultId: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns 400 for empty prompt", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/chat`, {
      method: "POST",
      body: JSON.stringify({ vaultId: "test", vaultPath: "/tmp/test", prompt: "" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("starts a turn and returns the path session id", async () => {
    configureCompletingSession();
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/chat`, {
      method: "POST",
      body: JSON.stringify({ vaultId: "v1", vaultPath: tempDir, prompt: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string };
    expect(body.sessionId).toBe(ID_A);
    await new Promise((r) => setTimeout(r, 40));
  });

  test("returns 409 when the session is already processing", async () => {
    // A session whose prompt never resolves keeps the turn in-flight.
    let resolvePrompt: () => void = () => {};
    const session = makeMockAgentSession({
      promptImpl: () => new Promise<void>((r) => { resolvePrompt = r; }),
    });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    const app = createApp(startTime);
    const first = await app.request(`/session/${ID_A}/chat`, {
      method: "POST",
      body: JSON.stringify({ vaultId: "v1", vaultPath: tempDir, prompt: "first" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(first.status).toBe(200);

    const second = await app.request(`/session/${ID_A}/chat`, {
      method: "POST",
      body: JSON.stringify({ vaultId: "v1", vaultPath: tempDir, prompt: "second" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("ALREADY_PROCESSING");
    expect(body.error.message).toContain("currently being processed");

    resolvePrompt();
    await new Promise((r) => setTimeout(r, 20));
  });
});

// =============================================================================
// GET /session/:sessionId/chat (SSE viewport)
// =============================================================================

describe("GET /session/:sessionId/chat", () => {
  test("replays the buffer then closes when the session is not processing", async () => {
    await runCompletedTurn(ID_A);

    // The buffer should hold a completed turn ending in response_end.
    const buffer = getReplayBuffer(ID_A);
    expect(buffer.map((e) => e.type)).toContain("response_end");

    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/chat`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSSEEvents(text);

    // No "snapshot" wrapper anymore — the raw turn events are replayed.
    // (SessionEvent has no "snapshot" variant; the cast documents the absence.)
    expect((events as Array<{ type: string }>).find((e) => e.type === "snapshot")).toBeUndefined();
    expect(events.find((e) => e.type === "session_ready")).toBeDefined();
    expect(events.find((e) => e.type === "response_end")).toBeDefined();
  });

  test("returns an empty stream (no events) for a session that never ran", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/chat`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const events = parseSSEEvents(text);
    expect(events).toHaveLength(0);
  });

  test("streams live events while the session is processing", async () => {
    // Holder object keeps TS from narrowing these to their initializer type at
    // the call site (the assignments happen inside callbacks TS can't trace).
    const cap: { listener?: AgentSessionEventListener; resolvePrompt?: () => void } = {};
    const session = makeMockAgentSession({
      onSubscribe: (l) => { cap.listener = l; return () => {}; },
      promptImpl: () =>
        new Promise<void>((r) => {
          cap.resolvePrompt = r;
        }),
    });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    const app = createApp(startTime);
    await app.request(`/session/${ID_A}/chat`, {
      method: "POST",
      body: JSON.stringify({ vaultId: "v1", vaultPath: tempDir, prompt: "go" }),
      headers: { "Content-Type": "application/json" },
    });

    // Wait for runTurn to attach the pi listener.
    await new Promise((r) => setTimeout(r, 20));

    const res = await app.request(`/session/${ID_A}/chat`);
    expect(res.status).toBe(200);

    // Emit a chunk live, then finish the turn so the stream closes.
    cap.listener?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "live-chunk" },
    } as AgentSessionEvent);
    await new Promise((r) => setTimeout(r, 10));
    cap.resolvePrompt?.();

    const text = await res.text();
    const events = parseSSEEvents(text);
    const chunks = events
      .filter((e) => e.type === "response_chunk")
      .map((e) => (e as { content: string }).content);
    expect(chunks).toContain("live-chunk");
    expect(events.find((e) => e.type === "response_end")).toBeDefined();
  });

  test("preserves strict order when a live event arrives during buffer replay", async () => {
    // Regression test for replay/live interleaving. With the old await-per-event
    // replay, a live event firing mid-replay was written BETWEEN two replayed
    // events (e.g. response_start, LIVE, session_ready, response_chunk...),
    // scrambling order. The fix queues live events during replay and drains them
    // after, so the client sees all buffered events first, then live ones.
    const cap: { listener?: AgentSessionEventListener; resolvePrompt?: () => void } = {};
    const session = makeMockAgentSession({
      onSubscribe: (l) => { cap.listener = l; return () => {}; },
      promptImpl: () =>
        new Promise<void>((r) => {
          cap.resolvePrompt = r;
        }),
    });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    const app = createApp(startTime);
    await app.request(`/session/${ID_A}/chat`, {
      method: "POST",
      body: JSON.stringify({ vaultId: "v1", vaultPath: tempDir, prompt: "go" }),
      headers: { "Content-Type": "application/json" },
    });

    // Wait for runTurn to attach the pi listener.
    await new Promise((r) => setTimeout(r, 20));

    // Buffer several events BEFORE the client connects so replay has multiple
    // entries to write (each replay write awaits, yielding to the event loop).
    cap.listener?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "buffered-1" },
    } as AgentSessionEvent);
    cap.listener?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "buffered-2" },
    } as AgentSessionEvent);
    cap.listener?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "buffered-3" },
    } as AgentSessionEvent);

    // Connect. Do NOT await the body yet — the replay loop is in flight.
    const res = await app.request(`/session/${ID_A}/chat`);
    expect(res.status).toBe(200);

    // Fire a live event DURING replay. The replay loop awaits each write, so this
    // callback runs between two replayed events. The fix must queue it until
    // replay finishes rather than writing it inline.
    cap.listener?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "live-during-replay" },
    } as AgentSessionEvent);

    // Let replay + drain finish, then close the stream by completing the turn.
    await new Promise((r) => setTimeout(r, 20));
    cap.resolvePrompt?.();

    const text = await res.text();
    const events = parseSSEEvents(text);
    const chunks = events
      .filter((e) => e.type === "response_chunk")
      .map((e) => (e as { content: string }).content);

    // All buffered chunks must precede the live one, in order. The old code
    // produced e.g. ["buffered-1", "live-during-replay", "buffered-2", ...].
    expect(chunks).toEqual([
      "buffered-1",
      "buffered-2",
      "buffered-3",
      "live-during-replay",
    ]);
  });

  test("route-level isolation: streaming B never leaks A's events", async () => {
    // Run a turn for A so A is the most recently active session and its buffer
    // holds events. This is the original wrong-session bug scenario.
    await runCompletedTurn(ID_A);
    expect(getReplayBuffer(ID_A).length).toBeGreaterThan(0);

    // B never ran. Its stream must be empty — never A's events.
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_B}/chat`);
    expect(res.status).toBe(200);
    const events = parseSSEEvents(await res.text());

    expect(events).toHaveLength(0);
    // Defensive: even if any event leaked, none would carry A's id.
    for (const e of events) {
      expect((e as { sessionId?: string }).sessionId).not.toBe(ID_A);
    }
  });
});

// =============================================================================
// POST /session/:sessionId/abort
// =============================================================================

describe("POST /session/:sessionId/abort", () => {
  test("returns success (idempotent) for a session that is not processing", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/abort`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; alreadyComplete?: boolean };
    expect(body.success).toBe(true);
    expect(body.alreadyComplete).toBe(true);
  });

  test("aborts a processing session (no session-mismatch 409)", async () => {
    let resolvePrompt: () => void = () => {};
    const session = makeMockAgentSession({
      promptImpl: () => new Promise<void>((r) => { resolvePrompt = r; }),
      abortImpl: async () => { resolvePrompt(); },
    });
    configurePiSessionForTesting(async () => makeMockPiSessionResult(session));

    const app = createApp(startTime);
    await app.request(`/session/${ID_A}/chat`, {
      method: "POST",
      body: JSON.stringify({ vaultId: "v1", vaultPath: tempDir, prompt: "go" }),
      headers: { "Content-Type": "application/json" },
    });
    await new Promise((r) => setTimeout(r, 20));

    const res = await app.request(`/session/${ID_A}/abort`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    resolvePrompt();
    await new Promise((r) => setTimeout(r, 20));
  });
});

// =============================================================================
// POST /session/:sessionId/permission
// =============================================================================

describe("POST /session/:sessionId/permission", () => {
  test("returns 400 for missing fields", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/permission`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("resolves a pending permission for the session (no mismatch 409)", async () => {
    // Pre-create the live session and inject a pending permission to resolve.
    const live = createLiveSession(ID_A, "v1", tempDir);
    // Holder keeps TS from narrowing the captured value at the assertion site.
    const cap: { resolved?: boolean } = {};
    live.pendingPermissions.set("tool-1", {
      prompt: { id: "tool-1", type: "tool_permission", toolName: "Read", input: {} },
      resolve: (v: boolean) => { cap.resolved = v; },
      reject: () => {},
    });

    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/permission`, {
      method: "POST",
      body: JSON.stringify({ toolUseId: "tool-1", allowed: true }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(cap.resolved).toBe(true);
  });
});

// =============================================================================
// POST /session/:sessionId/answer
// =============================================================================

describe("POST /session/:sessionId/answer", () => {
  test("returns 400 for missing fields", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/answer`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("resolves a pending question for the session (no mismatch 409)", async () => {
    const live = createLiveSession(ID_A, "v1", tempDir);
    // Holder keeps TS from narrowing the captured value at the assertion site.
    const cap: { resolved?: Record<string, string> } = {};
    live.pendingQuestions.set("q-1", {
      prompt: { id: "q-1", type: "ask_user_question", questions: [] },
      resolve: (v: Record<string, string>) => { cap.resolved = v; },
      reject: () => {},
    });

    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/answer`, {
      method: "POST",
      body: JSON.stringify({ toolUseId: "q-1", answers: { q1: "a1" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(cap.resolved).toEqual({ q1: "a1" });
  });
});

// =============================================================================
// POST /session/:sessionId/clear
// =============================================================================

describe("POST /session/:sessionId/clear", () => {
  test("returns success and emits session_cleared to subscribers", async () => {
    createLiveSession(ID_A, "v1", tempDir);
    const events: SessionEvent[] = [];
    subscribe(ID_A, "watch", (e) => events.push(e));

    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/clear`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(events.find((e) => e.type === "session_cleared")).toBeDefined();
  });

  test("clearing one session does not touch another", async () => {
    createLiveSession(ID_A, "v1", tempDir);
    createLiveSession(ID_B, "v1", tempDir);
    const eventsB: SessionEvent[] = [];
    subscribe(ID_B, "watch-b", (e) => eventsB.push(e));

    const app = createApp(startTime);
    await app.request(`/session/${ID_A}/clear`, { method: "POST" });

    expect(eventsB.find((e) => e.type === "session_cleared")).toBeUndefined();
  });
});

// =============================================================================
// GET /session/:sessionId/state
// =============================================================================

describe("GET /session/:sessionId/state", () => {
  test("returns idle state for an unknown session", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string | null; isStreaming: boolean };
    expect(body.sessionId).toBeNull();
    expect(body.isStreaming).toBe(false);
  });

  test("returns the session's own state after a turn", async () => {
    await runCompletedTurn(ID_A);
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string | null; isStreaming: boolean };
    expect(body.sessionId).toBe(ID_A);
    expect(body.isStreaming).toBe(false);
  });
});

// =============================================================================
// Hono route disambiguation: keyed routes vs metadata routes
// =============================================================================

describe("route disambiguation", () => {
  test("GET /session/lookup/:vaultId hits the lookup handler, not the keyed state route", async () => {
    // lookup for an unknown vault returns 404 (lookup handler). If this collided
    // with /session/:sessionId/state it would 200 with idle state instead.
    const app = createApp(startTime);
    const res = await app.request("/session/lookup/nonexistent-vault");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code: string } };
    expect(body.error?.code).toBe("VAULT_NOT_FOUND");
  });

  test("POST /session/init/:vaultId hits the init handler, not the keyed chat route", async () => {
    // For an unknown vault the init handler returns 404 with a STRING error
    // ("VAULT_NOT_FOUND"). The chat send handler has no vault lookup and would
    // instead 400 with a nested error object ({ error: { code: ... } }) on this
    // body (missing prompt). Asserting the init-only shape proves init was hit.
    const app = createApp(startTime);
    const res = await app.request("/session/init/nonexistent-vault", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: unknown };
    // init.ts returns error as a STRING; the chat handler returns an object.
    expect(body.error).toBe("VAULT_NOT_FOUND");
  });

  test("DELETE /session/:vaultId/:sessionId hits the delete handler, not a keyed route", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/nonexistent-vault/${ID_A}`, {
      method: "DELETE",
    });
    // Delete handler resolves the vault first → VAULT_NOT_FOUND (404).
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code: string } };
    expect(body.error?.code).toBe("VAULT_NOT_FOUND");
  });

  test("GET /session/:sessionId/state still works for a uuid-shaped id (no collision)", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string | null };
    expect(body).toHaveProperty("sessionId");
  });
});

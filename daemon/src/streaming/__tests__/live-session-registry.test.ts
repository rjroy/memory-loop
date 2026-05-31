/**
 * Tests for the Live Session Registry (Phase 0).
 *
 * The whole point of this module is per-session isolation: events and buffers
 * for session A must never leak into session B. These tests exercise the
 * lifecycle helpers, the isolation guarantee, buffer semantics, subscriber
 * management, and safe-no-op behavior for unknown ids.
 *
 * The registry map is module-level, so resetForTesting() runs before each case.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import type { SessionEvent } from "@memory-loop/shared";
import {
  createLiveSession,
  getLiveSession,
  hasLiveSession,
  deleteLiveSession,
  bufferEvent,
  clearEventBuffer,
  getEventBuffer,
  emitToSession,
  addSubscriber,
  removeSubscriber,
  isProcessing,
  setProcessing,
  collectPendingPrompts,
  resetForTesting,
} from "../live-session-registry";
import type {
  PendingPermissionRequest,
  PendingQuestionRequest,
} from "../types";

beforeEach(() => {
  resetForTesting();
});

/** A simple non-prompt event for buffer/emit tests. */
function chunk(content: string): SessionEvent {
  return { type: "response_chunk", messageId: "m1", content };
}

describe("lifecycle: create / get / has / delete", () => {
  it("creates and registers a session with sane defaults", () => {
    const session = createLiveSession("A", "vault-1", "/vaults/v1");

    expect(session.sessionId).toBe("A");
    expect(session.vaultId).toBe("vault-1");
    expect(session.vaultPath).toBe("/vaults/v1");
    expect(session.piSession).toBeNull();
    expect(session.isProcessing).toBe(false);
    expect(session.eventBuffer).toEqual([]);
    expect(session.subscribers.size).toBe(0);
    expect(session.pendingPermissions.size).toBe(0);
    expect(session.pendingQuestions.size).toBe(0);
    expect(session.responseChunks).toEqual([]);
    expect(session.toolsMap.size).toBe(0);
    expect(session.contextUsage).toBeUndefined();
    expect(session.streamer).toEqual({
      cumulativeTokens: 0,
      contextWindow: null,
      activeModel: null,
    });
    expect(session.generation).toBe(0);
  });

  it("getLiveSession returns the registered instance", () => {
    const created = createLiveSession("A", "vault-1", "/vaults/v1");
    expect(getLiveSession("A")).toBe(created);
  });

  it("hasLiveSession reflects registration", () => {
    expect(hasLiveSession("A")).toBe(false);
    createLiveSession("A", "vault-1", "/vaults/v1");
    expect(hasLiveSession("A")).toBe(true);
  });

  it("createLiveSession is idempotent: returns existing, preserves live state", () => {
    const first = createLiveSession("A", "vault-1", "/vaults/v1");
    first.isProcessing = true;
    first.eventBuffer.push(chunk("hello"));

    const second = createLiveSession("A", "vault-OTHER", "/vaults/other");

    expect(second).toBe(first);
    // State is not clobbered by the second call.
    expect(second.isProcessing).toBe(true);
    expect(second.eventBuffer).toHaveLength(1);
    expect(second.vaultId).toBe("vault-1");
  });

  it("deleteLiveSession removes a session", () => {
    createLiveSession("A", "vault-1", "/vaults/v1");
    expect(hasLiveSession("A")).toBe(true);
    deleteLiveSession("A");
    expect(hasLiveSession("A")).toBe(false);
    expect(getLiveSession("A")).toBeUndefined();
  });

  it("deleteLiveSession is a safe no-op for an absent id", () => {
    expect(() => deleteLiveSession("missing")).not.toThrow();
  });
});

describe("isolation: events and buffers do not cross sessions", () => {
  it("an event emitted to A reaches A's subscribers only, never B's", () => {
    createLiveSession("A", "v", "/v");
    createLiveSession("B", "v", "/v");

    const aReceived: SessionEvent[] = [];
    const bReceived: SessionEvent[] = [];
    addSubscriber("A", "sub-a", (e) => aReceived.push(e));
    addSubscriber("B", "sub-b", (e) => bReceived.push(e));

    emitToSession("A", chunk("for-a"));

    expect(aReceived).toHaveLength(1);
    expect(aReceived[0]).toEqual(chunk("for-a"));
    expect(bReceived).toHaveLength(0);
  });

  it("A's buffer is independent of B's buffer", () => {
    createLiveSession("A", "v", "/v");
    createLiveSession("B", "v", "/v");

    emitToSession("A", chunk("a1"));
    emitToSession("A", chunk("a2"));
    emitToSession("B", chunk("b1"));

    expect(getEventBuffer("A")).toEqual([chunk("a1"), chunk("a2")]);
    expect(getEventBuffer("B")).toEqual([chunk("b1")]);

    clearEventBuffer("A");
    expect(getEventBuffer("A")).toEqual([]);
    // Clearing A does not touch B.
    expect(getEventBuffer("B")).toEqual([chunk("b1")]);
  });
});

describe("emitToSession", () => {
  it("appends to the buffer AND notifies subscribers", () => {
    createLiveSession("A", "v", "/v");
    const received: SessionEvent[] = [];
    addSubscriber("A", "sub-a", (e) => received.push(e));

    emitToSession("A", chunk("x"));

    expect(received).toEqual([chunk("x")]);
    expect(getEventBuffer("A")).toEqual([chunk("x")]);
  });

  it("notifies multiple subscribers of the same session", () => {
    createLiveSession("A", "v", "/v");
    const one: SessionEvent[] = [];
    const two: SessionEvent[] = [];
    addSubscriber("A", "sub-1", (e) => one.push(e));
    addSubscriber("A", "sub-2", (e) => two.push(e));

    emitToSession("A", chunk("x"));

    expect(one).toEqual([chunk("x")]);
    expect(two).toEqual([chunk("x")]);
  });

  it("a throwing subscriber is caught: others still receive, no throw escapes", () => {
    createLiveSession("A", "v", "/v");
    const good: SessionEvent[] = [];
    addSubscriber("A", "bad", () => {
      throw new Error("subscriber boom");
    });
    addSubscriber("A", "good", (e) => good.push(e));

    expect(() => emitToSession("A", chunk("x"))).not.toThrow();
    expect(good).toEqual([chunk("x")]);
    // Buffering still happened despite the throwing subscriber.
    expect(getEventBuffer("A")).toEqual([chunk("x")]);
  });

  it("is a safe no-op for an unknown id", () => {
    expect(() => emitToSession("missing", chunk("x"))).not.toThrow();
    expect(getEventBuffer("missing")).toEqual([]);
  });
});

describe("buffer helpers", () => {
  it("bufferEvent appends without notifying subscribers", () => {
    createLiveSession("A", "v", "/v");
    const received: SessionEvent[] = [];
    addSubscriber("A", "sub-a", (e) => received.push(e));

    bufferEvent("A", chunk("buffered-only"));

    expect(getEventBuffer("A")).toEqual([chunk("buffered-only")]);
    expect(received).toHaveLength(0);
  });

  it("bufferEvent / clearEventBuffer are safe no-ops for unknown ids", () => {
    expect(() => bufferEvent("missing", chunk("x"))).not.toThrow();
    expect(() => clearEventBuffer("missing")).not.toThrow();
    expect(getEventBuffer("missing")).toEqual([]);
  });

  it("getEventBuffer returns a copy: mutating it does not affect internal state", () => {
    createLiveSession("A", "v", "/v");
    bufferEvent("A", chunk("a1"));

    const copy = getEventBuffer("A");
    copy.push(chunk("mutation"));
    copy.length = 0;

    // Internal buffer is unchanged.
    expect(getEventBuffer("A")).toEqual([chunk("a1")]);
  });
});

describe("processing flag", () => {
  it("isProcessing is false for an unknown id", () => {
    expect(isProcessing("missing")).toBe(false);
  });

  it("setProcessing toggles the flag", () => {
    createLiveSession("A", "v", "/v");
    expect(isProcessing("A")).toBe(false);
    setProcessing("A", true);
    expect(isProcessing("A")).toBe(true);
    setProcessing("A", false);
    expect(isProcessing("A")).toBe(false);
  });

  it("setProcessing is a safe no-op for an unknown id", () => {
    expect(() => setProcessing("missing", true)).not.toThrow();
    expect(isProcessing("missing")).toBe(false);
  });
});

describe("subscriber management", () => {
  it("removeSubscriber stops delivery to that subscriber only", () => {
    createLiveSession("A", "v", "/v");
    const a: SessionEvent[] = [];
    const b: SessionEvent[] = [];
    addSubscriber("A", "sub-a", (e) => a.push(e));
    addSubscriber("A", "sub-b", (e) => b.push(e));

    removeSubscriber("A", "sub-a");
    emitToSession("A", chunk("x"));

    expect(a).toHaveLength(0);
    expect(b).toEqual([chunk("x")]);
  });

  it("removeSubscriber is a safe no-op for an unknown subscriber id", () => {
    createLiveSession("A", "v", "/v");
    addSubscriber("A", "sub-a", () => {});
    expect(() => removeSubscriber("A", "never-added")).not.toThrow();
    expect(getLiveSession("A")?.subscribers.size).toBe(1);
  });

  it("removeSubscriber is a safe no-op for an unknown session id", () => {
    expect(() => removeSubscriber("missing", "sub")).not.toThrow();
  });

  it("addSubscriber is a safe no-op for an unknown session id", () => {
    expect(() => addSubscriber("missing", "sub", () => {})).not.toThrow();
  });

  it("re-adding the same subscriber id replaces the callback", () => {
    createLiveSession("A", "v", "/v");
    const first: SessionEvent[] = [];
    const second: SessionEvent[] = [];
    addSubscriber("A", "sub", (e) => first.push(e));
    addSubscriber("A", "sub", (e) => second.push(e));

    emitToSession("A", chunk("x"));

    expect(getLiveSession("A")?.subscribers.size).toBe(1);
    expect(first).toHaveLength(0);
    expect(second).toEqual([chunk("x")]);
  });
});

describe("collectPendingPrompts", () => {
  function permissionRequest(id: string): PendingPermissionRequest {
    return {
      prompt: { id, type: "tool_permission", toolName: "Read" },
      resolve: () => {},
      reject: () => {},
    };
  }

  function questionRequest(id: string): PendingQuestionRequest {
    return {
      prompt: { id, type: "ask_user_question", questions: [] },
      resolve: () => {},
      reject: () => {},
    };
  }

  it("returns an empty array for an unknown id", () => {
    expect(collectPendingPrompts("missing")).toEqual([]);
  });

  it("returns an empty array when no prompts are pending", () => {
    createLiveSession("A", "v", "/v");
    expect(collectPendingPrompts("A")).toEqual([]);
  });

  it("flattens permissions and questions into one array", () => {
    const session = createLiveSession("A", "v", "/v");
    session.pendingPermissions.set("p1", permissionRequest("p1"));
    session.pendingQuestions.set("q1", questionRequest("q1"));

    const prompts = collectPendingPrompts("A");
    const ids = prompts.map((p) => p.id).sort();
    expect(ids).toEqual(["p1", "q1"]);
  });

  it("scopes pending prompts to the requested session", () => {
    const a = createLiveSession("A", "v", "/v");
    const b = createLiveSession("B", "v", "/v");
    a.pendingPermissions.set("pa", permissionRequest("pa"));
    b.pendingPermissions.set("pb", permissionRequest("pb"));

    expect(collectPendingPrompts("A").map((p) => p.id)).toEqual(["pa"]);
    expect(collectPendingPrompts("B").map((p) => p.id)).toEqual(["pb"]);
  });
});

describe("resetForTesting", () => {
  it("clears the entire registry", () => {
    createLiveSession("A", "v", "/v");
    createLiveSession("B", "v", "/v");
    expect(hasLiveSession("A")).toBe(true);
    expect(hasLiveSession("B")).toBe(true);

    resetForTesting();

    expect(hasLiveSession("A")).toBe(false);
    expect(hasLiveSession("B")).toBe(false);
  });
});

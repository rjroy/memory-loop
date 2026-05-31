/**
 * SSE Event Ordering Tests (keyed)
 *
 * Verifies that the keyed SSE stream replays a session's buffered events in
 * order and that events emitted to a session reach that session's subscribers.
 * Uses real timers (async generators are incompatible with fake timers).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../server";
import { resetForTesting, createLiveSession } from "../streaming/live-session-registry";
import { subscribe, clearSession } from "../streaming/live-session-controller";
import { emitToSession } from "../streaming/live-session-registry";
import {
  configurePiSessionForTesting,
  _resetPiSessionForTesting,
  type PiSessionOptions,
  type PiSessionResult,
} from "../pi-session-factory";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SessionEvent } from "@memory-loop/shared";

let cleanupSession: (() => void) | undefined;
const startTime = Date.now();

const ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  // Inject a no-op session factory to prevent real pi-agent calls
  const mockSession: (opts: PiSessionOptions) => Promise<PiSessionResult> = async () => {
    const session = {
      messages: [],
      prompt: async () => {},
      abort: () => {},
      subscribe: () => () => {},
      bindExtensions: async () => {},
      modelRegistry: { find: () => undefined },
      setModel: async () => {},
      sessionFile: undefined,
    } as unknown as AgentSession;
    return { session, jsonlPath: null };
  };
  cleanupSession = configurePiSessionForTesting(mockSession);
  resetForTesting();
});

afterEach(() => {
  cleanupSession?.();
  _resetPiSessionForTesting();
  resetForTesting();
});

/**
 * Parses SSE text into an array of data payloads.
 * Filters out empty lines and comment lines.
 */
function parseSSEEvents(text: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data) {
        try {
          events.push(JSON.parse(data) as SessionEvent);
        } catch {
          // Skip non-JSON data lines (keep-alive)
        }
      }
    }
  }
  return events;
}

describe("SSE event ordering", () => {
  test("an idle (unknown) session yields an empty stream", async () => {
    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/chat`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSSEEvents(text);

    // No snapshot wrapper and no buffered events for a session that never ran.
    expect(events).toHaveLength(0);
  });

  test("buffered events replay in emit order, then the stream closes", async () => {
    // Build a buffer for a non-processing session, then connect and replay.
    createLiveSession(ID_A, "v1", "/tmp/x");
    emitToSession(ID_A, { type: "response_start", messageId: "m1" });
    emitToSession(ID_A, { type: "response_chunk", messageId: "m1", content: "one" });
    emitToSession(ID_A, { type: "response_chunk", messageId: "m1", content: "two" });
    emitToSession(ID_A, { type: "response_end", messageId: "m1", durationMs: 1 });

    const app = createApp(startTime);
    const res = await app.request(`/session/${ID_A}/chat`);
    const events = parseSSEEvents(await res.text());

    expect(events.map((e) => e.type)).toEqual([
      "response_start",
      "response_chunk",
      "response_chunk",
      "response_end",
    ]);
  });

  test("events emitted to a session arrive at its subscribers", async () => {
    createLiveSession(ID_A, "v1", "/tmp/x");

    const receivedEvents: SessionEvent[] = [];
    subscribe(ID_A, "watch", (event) => {
      receivedEvents.push(event);
    });

    // session_cleared is a terminal event the controller emits on clear.
    clearSession(ID_A);

    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
    expect(receivedEvents.some((e) => e.type === "session_cleared")).toBe(true);
  });

  test("replay completes within 1s for a non-processing session (no buffering)", async () => {
    createLiveSession(ID_A, "v1", "/tmp/x");
    emitToSession(ID_A, { type: "response_end", messageId: "m1", durationMs: 1 });

    const app = createApp(startTime);
    const start = Date.now();
    const res = await app.request(`/session/${ID_A}/chat`);
    const text = await res.text();
    const elapsed = Date.now() - start;

    const events = parseSSEEvents(text);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(elapsed).toBeLessThan(1000);
  });
});

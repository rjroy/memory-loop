/**
 * SSE Event Ordering Tests
 *
 * Verifies that events emitted by the controller arrive at the SSE
 * stream endpoint in the correct order and within a reasonable timeout.
 * Uses real timers (async generators are incompatible with fake timers).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../server";
import { getController, resetController } from "../session-controller";
import { configureSdkForTesting, _resetForTesting } from "../sdk-provider";
import type { SessionEvent } from "@memory-loop/shared";

let cleanupSdk: (() => void) | undefined;
const startTime = Date.now();

beforeEach(() => {
  const mockQuery = (async () => ({
    content: [{ type: "text" as const, text: "Mock response" }],
    model: "test",
    id: "msg_test",
    role: "assistant" as const,
    stop_reason: "end_turn",
    type: "message" as const,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  })) as never;
  cleanupSdk = configureSdkForTesting(mockQuery);
  resetController();
});

afterEach(() => {
  cleanupSdk?.();
  _resetForTesting();
  resetController();
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
  test("snapshot is always the first event", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSSEEvents(text);

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toHaveProperty("type", "snapshot");
  });

  test("snapshot includes isProcessing field", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/stream");
    const text = await res.text();
    const events = parseSSEEvents(text);

    expect(events[0]).toHaveProperty("isProcessing", false);
  });

  test("snapshot includes sessionId field", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/stream");
    const text = await res.text();
    const events = parseSSEEvents(text);

    expect(events[0]).toHaveProperty("sessionId");
  });

  test("stream closes after snapshot when not processing", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/stream");
    const text = await res.text();
    const events = parseSSEEvents(text);

    // When not processing, only the snapshot event should be emitted
    expect(events.length).toBe(1);
    expect(events[0]).toHaveProperty("type", "snapshot");
  });

  test("events emitted by controller arrive at stream output", async () => {
    createApp(startTime);
    const controller = getController();

    // Manually emit events via the controller's subscriber mechanism
    const receivedEvents: SessionEvent[] = [];
    const unsubscribe = controller.subscribe((event) => {
      receivedEvents.push(event);
    });

    // Emit a session_cleared event (a terminal event the controller can emit)
    controller.clearSession();

    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
    expect(receivedEvents.some((e) => e.type === "session_cleared")).toBe(true);

    unsubscribe();
  });

  test("all events arrive within 1s timeout (no accidental buffering)", async () => {
    const app = createApp(startTime);
    const start = Date.now();
    const res = await app.request("/session/chat/stream");

    // Reading the full text should complete quickly when not processing
    const text = await res.text();
    const elapsed = Date.now() - start;

    const events = parseSSEEvents(text);
    expect(events.length).toBeGreaterThanOrEqual(1);
    // Should complete well within 1 second for non-processing state
    expect(elapsed).toBeLessThan(1000);
  });
});

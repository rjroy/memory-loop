import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { configureClientForTesting, daemonSSE } from "../client";

/**
 * Create a mock Response with a ReadableStream that emits SSE frames.
 */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("daemonSSE", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  test("parses single-frame SSE events", async () => {
    cleanup = configureClientForTesting(async () =>
      sseResponse([
        'data: {"type":"text_delta","text":"hello"}\n\n',
        'data: {"type":"response_end"}\n\n',
      ]),
    );

    const events = [];
    for await (const event of daemonSSE("/session/chat/stream")) {
      events.push(event);
    }

    expect(events.length).toBe(2);
    expect(events[0].type).toBe("message");
    expect(events[0].data).toBe('{"type":"text_delta","text":"hello"}');
    expect(events[1].data).toBe('{"type":"response_end"}');
  });

  test("handles data split across chunks", async () => {
    cleanup = configureClientForTesting(async () =>
      sseResponse([
        'data: {"type":"tex',
        't_delta","text":"hello"}\n\ndata: {"type":"response_end"}\n\n',
      ]),
    );

    const events = [];
    for await (const event of daemonSSE("/session/chat/stream")) {
      events.push(event);
    }

    expect(events.length).toBe(2);
    expect(events[0].data).toBe('{"type":"text_delta","text":"hello"}');
  });

  test("filters keep-alive comment lines", async () => {
    cleanup = configureClientForTesting(async () =>
      sseResponse([
        ": keep-alive\n\n",
        'data: {"type":"text_delta","text":"hi"}\n\n',
      ]),
    );

    const events = [];
    for await (const event of daemonSSE("/session/chat/stream")) {
      events.push(event);
    }

    // Only the data event, not the comment
    expect(events.length).toBe(1);
    expect(events[0].data).toContain("text_delta");
  });

  test("parses named event types", async () => {
    cleanup = configureClientForTesting(async () =>
      sseResponse([
        'event: custom\ndata: {"payload":"test"}\n\n',
      ]),
    );

    const events = [];
    for await (const event of daemonSSE("/session/chat/stream")) {
      events.push(event);
    }

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("custom");
  });

  test("strips exactly one leading space from data lines", async () => {
    cleanup = configureClientForTesting(async () =>
      sseResponse([
        "data:  indented content\n\n",
      ]),
    );

    const events = [];
    for await (const event of daemonSSE("/session/chat/stream")) {
      events.push(event);
    }

    // Should preserve the second space (only strip one)
    expect(events[0].data).toBe(" indented content");
  });

  test("handles data lines without leading space", async () => {
    cleanup = configureClientForTesting(async () =>
      sseResponse([
        "data:no-space\n\n",
      ]),
    );

    const events = [];
    for await (const event of daemonSSE("/session/chat/stream")) {
      events.push(event);
    }

    expect(events[0].data).toBe("no-space");
  });

  test("joins multi-line data fields", async () => {
    cleanup = configureClientForTesting(async () =>
      sseResponse([
        "data: line1\ndata: line2\n\n",
      ]),
    );

    const events = [];
    for await (const event of daemonSSE("/session/chat/stream")) {
      events.push(event);
    }

    expect(events[0].data).toBe("line1\nline2");
  });

  test("throws DaemonApiError on non-2xx response", async () => {
    cleanup = configureClientForTesting(async () =>
      new Response(
        JSON.stringify({ error: "Not found", code: "NOT_FOUND" }),
        { status: 404 },
      ),
    );

    try {
      for await (const _event of daemonSSE("/session/chat/stream")) {
        // Should not reach here
      }
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).name).toBe("DaemonApiError");
    }
  });

  test("handles empty response body", async () => {
    cleanup = configureClientForTesting(async () =>
      new Response(null, { status: 200 }),
    );

    const events = [];
    for await (const event of daemonSSE("/session/chat/stream")) {
      events.push(event);
    }

    expect(events.length).toBe(0);
  });

  test("exits cleanly on AbortSignal", async () => {
    const controller = new AbortController();

    cleanup = configureClientForTesting(async (_path, init) => {
      // Simulate a stream that blocks until aborted
      const stream = new ReadableStream({
        start() {
          // Check if already aborted
          if (init?.signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
        },
        pull(streamController) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              streamController.close();
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    // Abort after a short delay
    setTimeout(() => controller.abort(), 10);

    const events = [];
    for await (const event of daemonSSE("/session/chat/stream", {
      signal: controller.signal,
    })) {
      events.push(event);
    }

    // Should exit without throwing
    expect(events.length).toBe(0);
  });
});

/**
 * Session Streamer Tests
 *
 * Verifies that startStreamSdkEvents returns a handle with synchronous
 * snapshot access and that the backward-compatible streamSdkEvents wrapper
 * still works.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  startStreamSdkEvents,
  streamSdkEvents,
} from "../session-streamer";
import type {
  StreamerEmitter,
  StreamerState,
} from "../session-streamer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(): StreamerState {
  return { cumulativeTokens: 0, contextWindow: null, activeModel: null };
}

function makeEmitter(): StreamerEmitter {
  return { emit: mock(() => {}) };
}

/**
 * Creates an async generator from a fixed list of SDK events.
 * Useful for tests that don't need mid-stream control.
 */
async function* mockEvents(
  events: SDKMessage[]
): AsyncGenerator<SDKMessage, void> {
  for (const event of events) {
    yield event;
  }
}

/**
 * Creates a controllable async generator so tests can push events one at a
 * time and inspect snapshots between them.
 */
function createControllableGenerator() {
  let resolveNext:
    | ((value: IteratorResult<SDKMessage, void>) => void)
    | null = null;

  const generator: AsyncGenerator<SDKMessage, void> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      return new Promise<IteratorResult<SDKMessage, void>>((resolve) => {
        resolveNext = resolve;
      });
    },
    return() {
      return Promise.resolve({ done: true as const, value: undefined });
    },
    throw(err: unknown) {
      return Promise.reject(err);
    },
  };

  function pushEvent(event: SDKMessage) {
    resolveNext?.({ done: false, value: event });
  }

  function complete() {
    resolveNext?.({ done: true, value: undefined });
  }

  return { generator, pushEvent, complete };
}

// ---------------------------------------------------------------------------
// Mock SDK events
// ---------------------------------------------------------------------------

function contentBlockStart(index: number): SDKMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_start",
      index,
      content_block: { type: "text", text: "" },
    },
  } as unknown as SDKMessage;
}

function textDelta(index: number, text: string): SDKMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text },
    },
  } as unknown as SDKMessage;
}

function contentBlockStop(index: number): SDKMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_stop",
      index,
    },
  } as unknown as SDKMessage;
}

function resultEvent(
  inputTokens = 100,
  outputTokens = 50
): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    result: "",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    modelUsage: {},
    duration_ms: 100,
    duration_api_ms: 90,
    is_error: false,
    num_turns: 1,
    stop_reason: "end_turn",
    total_cost_usd: 0.01,
    permission_denials: [],
    uuid: "test-uuid",
    session_id: "test-session",
  } as unknown as SDKMessage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session-streamer", () => {
  let state: StreamerState;
  let emitter: StreamerEmitter;

  beforeEach(() => {
    state = makeState();
    emitter = makeEmitter();
  });

  describe("startStreamSdkEvents", () => {
    test("returns a handle synchronously", () => {
      const { generator } = createControllableGenerator();
      const handle = startStreamSdkEvents(
        generator,
        "msg-1",
        emitter,
        state
      );

      expect(handle).toBeDefined();
      expect(typeof handle.getSnapshot).toBe("function");
      expect(handle.result).toBeInstanceOf(Promise);

      // Clean up: complete the generator so the detached promise resolves
      generator.return(undefined);
    });

    test("getSnapshot returns empty content before any events", () => {
      const { generator } = createControllableGenerator();
      const handle = startStreamSdkEvents(
        generator,
        "msg-1",
        emitter,
        state
      );

      const snapshot = handle.getSnapshot();
      expect(snapshot.content).toBe("");
      expect(snapshot.toolInvocations).toEqual([]);
      expect(snapshot.contextUsage).toBeUndefined();

      generator.return(undefined);
    });

    test("getSnapshot returns partial content after some events", async () => {
      const { generator, pushEvent } =
        createControllableGenerator();

      const handle = startStreamSdkEvents(
        generator,
        "msg-1",
        emitter,
        state
      );

      // Before any events, empty
      expect(handle.getSnapshot().content).toBe("");

      // Push a content block start and a text delta
      pushEvent(contentBlockStart(0));
      // Allow the event loop to process
      await Promise.resolve();

      pushEvent(textDelta(0, "Hello"));
      await Promise.resolve();

      const snapshot = handle.getSnapshot();
      expect(snapshot.content).toBe("Hello");

      // Push another delta
      pushEvent(textDelta(0, " world"));
      await Promise.resolve();

      const snapshot2 = handle.getSnapshot();
      expect(snapshot2.content).toBe("Hello world");

      // Clean up
      pushEvent(contentBlockStop(0));
      await Promise.resolve();
      pushEvent(resultEvent());

      await handle.result;
    });

    test("getSnapshot returns complete content after result resolves", async () => {
      const events: SDKMessage[] = [
        contentBlockStart(0),
        textDelta(0, "Full response"),
        contentBlockStop(0),
        resultEvent(200, 100),
      ];

      const handle = startStreamSdkEvents(
        mockEvents(events),
        "msg-1",
        emitter,
        state
      );

      const finalResult = await handle.result;

      expect(finalResult.content).toBe("Full response");
      expect(finalResult.toolInvocations).toEqual([]);

      // getSnapshot after completion returns the same thing
      const snapshot = handle.getSnapshot();
      expect(snapshot.content).toBe("Full response");
    });

    test("emits response_chunk events for text deltas", async () => {
      const events: SDKMessage[] = [
        contentBlockStart(0),
        textDelta(0, "chunk1"),
        textDelta(0, "chunk2"),
        contentBlockStop(0),
        resultEvent(),
      ];

      const handle = startStreamSdkEvents(
        mockEvents(events),
        "msg-42",
        emitter,
        state
      );

      await handle.result;

      const emitFn = emitter.emit as ReturnType<typeof mock>;
      const chunkEvents = emitFn.mock.calls
        .map((call: unknown[]) => call[0])
        .filter(
          (e: { type: string }) => e.type === "response_chunk"
        );

      expect(chunkEvents).toHaveLength(2);
      expect(chunkEvents[0]).toEqual({
        type: "response_chunk",
        messageId: "msg-42",
        content: "chunk1",
      });
      expect(chunkEvents[1]).toEqual({
        type: "response_chunk",
        messageId: "msg-42",
        content: "chunk2",
      });
    });

    test("snapshot reflects tool invocations", async () => {
      const toolStartEvent: SDKMessage = {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "read_file",
          },
        },
      } as unknown as SDKMessage;

      const { generator, pushEvent } = createControllableGenerator();
      const handle = startStreamSdkEvents(
        generator,
        "msg-1",
        emitter,
        state
      );

      pushEvent(toolStartEvent);
      await Promise.resolve();

      const snapshot = handle.getSnapshot();
      expect(snapshot.toolInvocations).toHaveLength(1);
      expect(snapshot.toolInvocations[0].toolName).toBe("read_file");
      expect(snapshot.toolInvocations[0].toolUseId).toBe("tool-1");
      expect(snapshot.toolInvocations[0].status).toBe("running");

      // Clean up
      generator.return(undefined);
    });

    test("handles abort signal", async () => {
      const controller = new AbortController();
      const { generator, pushEvent } = createControllableGenerator();

      const handle = startStreamSdkEvents(
        generator,
        "msg-1",
        emitter,
        state,
        controller.signal
      );

      // Push a text delta then abort
      pushEvent(contentBlockStart(0));
      await Promise.resolve();
      pushEvent(textDelta(0, "partial"));
      await Promise.resolve();

      controller.abort();

      // Push another event after abort to trigger the check
      pushEvent(textDelta(0, " ignored"));

      const finalResult = await handle.result;
      expect(finalResult.content).toBe("partial");
    });

    test("generator error is caught by detached handler", async () => {
      async function* failingGenerator(): AsyncGenerator<
        SDKMessage,
        void
      > {
        yield contentBlockStart(0);
        throw new Error("generator blew up");
      }

      const handle = startStreamSdkEvents(
        failingGenerator(),
        "msg-1",
        emitter,
        state
      );

      // The result promise should reject with the error
      await expect(handle.result).rejects.toThrow("generator blew up");
    });
  });

  describe("streamSdkEvents (backward compatibility)", () => {
    test("returns a promise that resolves with StreamingResult", async () => {
      const events: SDKMessage[] = [
        contentBlockStart(0),
        textDelta(0, "Hello from wrapper"),
        contentBlockStop(0),
        resultEvent(),
      ];

      const result = await streamSdkEvents(
        mockEvents(events),
        "msg-compat",
        emitter,
        state
      );

      expect(result.content).toBe("Hello from wrapper");
      expect(result.toolInvocations).toEqual([]);
    });

    test("accumulates token usage in state", async () => {
      const events: SDKMessage[] = [
        contentBlockStart(0),
        textDelta(0, "test"),
        contentBlockStop(0),
        resultEvent(100, 50),
      ];

      expect(state.cumulativeTokens).toBe(0);

      await streamSdkEvents(
        mockEvents(events),
        "msg-tokens",
        emitter,
        state
      );

      expect(state.cumulativeTokens).toBe(150);
    });

    test("returns empty content when generator yields no events", async () => {
      const result = await streamSdkEvents(
        mockEvents([]),
        "msg-empty",
        emitter,
        state
      );

      expect(result.content).toBe("");
      expect(result.toolInvocations).toEqual([]);
    });
  });
});

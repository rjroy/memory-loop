/**
 * Event Translator Tests
 *
 * Tests the createPiEventAdapter() function in isolation.
 * Drives it with synthetic AgentSessionEvent objects and asserts
 * the correct SdkRunnerEvent output.
 */

import { describe, test, expect } from "bun:test";
import { createPiEventAdapter, isSessionExpiryError } from "../event-translator";
import type { SdkRunnerEvent } from "../types";

// ---------------------------------------------------------------------------
// Helpers: build synthetic AgentSessionEvent objects
// ---------------------------------------------------------------------------

type AssistantDeltaType = "text_delta" | "thinking_delta";

function messageUpdate(type: AssistantDeltaType, delta: string) {
  return {
    type: "message_update" as const,
    message: {} as never,
    assistantMessageEvent: {
      type,
      contentIndex: 0,
      delta,
      partial: {} as never,
    },
  };
}

const messageUpdateText = (delta: string) => messageUpdate("text_delta", delta);
const messageUpdateThinkingDelta = (delta: string) =>
  messageUpdate("thinking_delta", delta);

function toolExecutionStart(toolCallId: string, toolName: string, args: unknown = {}) {
  return {
    type: "tool_execution_start" as const,
    toolCallId,
    toolName,
    args,
  };
}

function toolExecutionUpdate(
  toolCallId: string,
  toolName: string,
  args: unknown,
  partialResultText: string
) {
  return {
    type: "tool_execution_update" as const,
    toolCallId,
    toolName,
    args,
    partialResult: {
      content: [{ type: "text" as const, text: partialResultText }],
      details: undefined,
    },
  };
}

/**
 * Build a tool_execution_update without usable text content.
 * Pass `partialResult: undefined` to simulate a missing partialResult;
 * the default empty content array simulates a present-but-empty payload.
 */
function toolExecutionUpdateWithoutText(
  toolCallId: string,
  toolName: string,
  partialResult: { content: never[]; details: undefined } | undefined = {
    content: [],
    details: undefined,
  }
) {
  return {
    type: "tool_execution_update" as const,
    toolCallId,
    toolName,
    args: {},
    partialResult,
  };
}

function compactionStart(reason: "manual" | "threshold" | "overflow") {
  return {
    type: "compaction_start" as const,
    reason,
  };
}

function compactionEnd(reason: "manual" | "threshold" | "overflow") {
  return {
    type: "compaction_end" as const,
    reason,
    result: undefined,
    aborted: false,
    willRetry: false,
  };
}

// ---------------------------------------------------------------------------
// Helper: collect events emitted by the adapter
// ---------------------------------------------------------------------------

function collectEvents(
  piEvents: Parameters<ReturnType<typeof createPiEventAdapter>>[0][]
): SdkRunnerEvent[] {
  const collected: SdkRunnerEvent[] = [];
  const adapter = createPiEventAdapter((event) => collected.push(event));
  for (const e of piEvents) {
    adapter(e as never);
  }
  return collected;
}

// =============================================================================
// createPiEventAdapter
// =============================================================================

describe("createPiEventAdapter", () => {
  test("text_delta message_update produces text_delta event", () => {
    const events = collectEvents([messageUpdateText("Hello, world")]);
    expect(events).toEqual([{ type: "text_delta", text: "Hello, world" }]);
  });

  test("multiple text_delta events are forwarded in order", () => {
    const events = collectEvents([
      messageUpdateText("foo"),
      messageUpdateText("bar"),
      messageUpdateText("baz"),
    ]);
    expect(events).toEqual([
      { type: "text_delta", text: "foo" },
      { type: "text_delta", text: "bar" },
      { type: "text_delta", text: "baz" },
    ]);
  });

  test("non-text_delta message_update (thinking_delta) is silently ignored", () => {
    const events = collectEvents([messageUpdateThinkingDelta("thought")]);
    expect(events).toEqual([]);
  });

  test("tool_execution_start produces tool_use event", () => {
    const events = collectEvents([
      toolExecutionStart("call-1", "Read", { file_path: "test.ts" }),
    ]);
    expect(events).toEqual([
      { type: "tool_use", name: "Read", id: "call-1" },
    ]);
  });

  test("tool_execution_update produces tool_result event with text snapshot", () => {
    const events = collectEvents([
      toolExecutionUpdate("call-2", "Bash", { command: "ls" }, "file.txt\ndir/"),
    ]);
    expect(events).toEqual([
      {
        type: "tool_result",
        name: "",
        output: "file.txt\ndir/",
        toolUseId: "call-2",
      },
    ]);
  });

  test("tool_execution_update with no content blocks emits no event", () => {
    const events = collectEvents([toolExecutionUpdateWithoutText("call-3", "Write")]);
    expect(events).toEqual([]);
  });

  test("tool_execution_update with null partialResult emits no event", () => {
    const events = collectEvents([
      toolExecutionUpdateWithoutText("call-4", "Bash", undefined),
    ]);
    expect(events).toEqual([]);
  });

  test("compaction_start produces compact_boundary event", () => {
    const events = collectEvents([compactionStart("threshold")]);
    expect(events).toHaveLength(1);
    const event = events[0] as Extract<SdkRunnerEvent, { type: "compact_boundary" }>;
    expect(event.type).toBe("compact_boundary");
    expect(event.trigger).toBe("threshold");
  });

  test("compaction_start with manual reason carries reason as trigger", () => {
    const events = collectEvents([compactionStart("manual")]);
    const event = events[0] as Extract<SdkRunnerEvent, { type: "compact_boundary" }>;
    expect(event.trigger).toBe("manual");
  });

  test("compaction_end is silently ignored", () => {
    const events = collectEvents([compactionEnd("threshold")]);
    expect(events).toEqual([]);
  });

  test("unknown event type is silently ignored", () => {
    const events = collectEvents([{ type: "agent_start" } as never]);
    expect(events).toEqual([]);
  });

  test("turn_start is silently ignored (turn_end is caller responsibility)", () => {
    const events = collectEvents([{ type: "turn_start" } as never]);
    expect(events).toEqual([]);
  });

  test("mixed event sequence produces correct ordered output", () => {
    const events = collectEvents([
      messageUpdateText("Thinking..."),
      toolExecutionStart("call-5", "Read", { file_path: "src/foo.ts" }),
      toolExecutionUpdate("call-5", "Read", { file_path: "src/foo.ts" }, "const x = 1;"),
      messageUpdateThinkingDelta("internal"),
      messageUpdateText(" Done."),
    ]);

    expect(events).toEqual([
      { type: "text_delta", text: "Thinking..." },
      { type: "tool_use", name: "Read", id: "call-5" },
      { type: "tool_result", name: "", output: "const x = 1;", toolUseId: "call-5" },
      { type: "text_delta", text: " Done." },
    ]);
  });

  test("adapter is stateless: two adapters do not share state", () => {
    const collectedA: SdkRunnerEvent[] = [];
    const collectedB: SdkRunnerEvent[] = [];
    const adapterA = createPiEventAdapter((e) => collectedA.push(e));
    const adapterB = createPiEventAdapter((e) => collectedB.push(e));

    adapterA(messageUpdateText("A") as never);
    adapterB(messageUpdateText("B") as never);

    expect(collectedA).toEqual([{ type: "text_delta", text: "A" }]);
    expect(collectedB).toEqual([{ type: "text_delta", text: "B" }]);
  });
});

// =============================================================================
// isSessionExpiryError
// =============================================================================

describe("isSessionExpiryError", () => {
  test("matches 'session not found'", () => {
    expect(isSessionExpiryError("Session not found")).toBe(true);
  });

  test("matches 'session expired'", () => {
    expect(isSessionExpiryError("The session expired after 30 minutes")).toBe(true);
  });

  test("matches 'session has expired'", () => {
    expect(isSessionExpiryError("Session has expired")).toBe(true);
  });

  test("matches 'could not find session'", () => {
    expect(isSessionExpiryError("Could not find session abc123")).toBe(true);
  });

  test("matches 'no such session'", () => {
    expect(isSessionExpiryError("No such session exists")).toBe(true);
  });

  test("matches 'invalid session'", () => {
    expect(isSessionExpiryError("Invalid session ID provided")).toBe(true);
  });

  test("case insensitive", () => {
    expect(isSessionExpiryError("SESSION NOT FOUND")).toBe(true);
    expect(isSessionExpiryError("session NOT Found")).toBe(true);
  });

  test("does not match unrelated errors", () => {
    expect(isSessionExpiryError("Rate limit exceeded")).toBe(false);
    expect(isSessionExpiryError("Authentication failed")).toBe(false);
    expect(isSessionExpiryError("Server error")).toBe(false);
    expect(isSessionExpiryError("")).toBe(false);
  });
});

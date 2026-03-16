/**
 * Event Translator Tests
 *
 * Tests the createStreamTranslator() function in isolation.
 * Verifies SDK events are correctly translated to SdkRunnerEvents.
 */

import { describe, test, expect } from "bun:test";
import { createStreamTranslator, isSessionExpiryError } from "../event-translator";
import type { SdkRunnerEvent } from "../types";

// Helper to create typed SDK messages without importing SDK types directly.
// The translator casts internally, so we only need the shape it checks.
function systemInit(sessionId: string) {
  return {
    type: "system" as const,
    subtype: "init",
    session_id: sessionId,
  };
}

function compactBoundary(preTokens: number, trigger: string) {
  return {
    type: "system" as const,
    subtype: "compact_boundary",
    session_id: "sess-1",
    compact_metadata: { pre_tokens: preTokens, trigger },
  };
}

function streamEvent(event: Record<string, unknown>) {
  return {
    type: "stream_event" as const,
    session_id: "sess-1",
    event,
  };
}

function assistantMessage() {
  return {
    type: "assistant" as const,
    session_id: "sess-1",
    message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
  };
}

function userMessage(content: unknown[]) {
  return {
    type: "user" as const,
    session_id: "sess-1",
    message: { role: "user", content },
  };
}

function resultSuccess(opts: {
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
  contextWindow?: number;
  model?: string;
}) {
  const modelName = opts.model ?? "claude-sonnet-4-20250514";
  const modelUsage: Record<string, { contextWindow?: number }> = {};
  if (opts.contextWindow !== undefined) {
    modelUsage[modelName] = { contextWindow: opts.contextWindow };
  } else {
    modelUsage[modelName] = {};
  }
  return {
    type: "result" as const,
    session_id: "sess-1",
    subtype: "success",
    total_cost_usd: opts.cost ?? 0.01,
    usage: {
      input_tokens: opts.inputTokens ?? 100,
      output_tokens: opts.outputTokens ?? 50,
    },
    modelUsage,
  };
}

function resultError(subtype: string, errors?: string[]) {
  return {
    type: "result" as const,
    session_id: "sess-1",
    subtype,
    ...(errors ? { errors } : {}),
  };
}

// =============================================================================
// createStreamTranslator
// =============================================================================

describe("createStreamTranslator", () => {
  test("system init produces session event with session ID", () => {
    const translate = createStreamTranslator();
    const events = translate(systemInit("sess-abc123"));

    expect(events).toEqual([{ type: "session", sessionId: "sess-abc123" }]);
  });

  test("system message without init subtype produces empty", () => {
    const translate = createStreamTranslator();
    const events = translate({
      type: "system" as const,
      subtype: "other",
      session_id: "sess-1",
    } as never);

    expect(events).toEqual([]);
  });

  test("stream_event text_delta produces text_delta event", () => {
    const translate = createStreamTranslator();
    const events = translate(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello world" },
      }) as never
    );

    expect(events).toEqual([{ type: "text_delta", text: "Hello world" }]);
  });

  test("tool_use lifecycle: block_start + json deltas + block_stop", () => {
    const translate = createStreamTranslator();

    // content_block_start with tool_use
    const startEvents = translate(
      streamEvent({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "tool-1", name: "Read" },
      }) as never
    );
    expect(startEvents).toEqual([
      { type: "tool_use", name: "Read", id: "tool-1" },
    ]);

    // input_json_delta chunks (accumulated, no events emitted)
    const delta1 = translate(
      streamEvent({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"file_' },
      }) as never
    );
    expect(delta1).toEqual([]);

    const delta2 = translate(
      streamEvent({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: 'path":"test.ts"}' },
      }) as never
    );
    expect(delta2).toEqual([]);

    // content_block_stop emits tool_input with parsed JSON
    const stopEvents = translate(
      streamEvent({
        type: "content_block_stop",
        index: 1,
      }) as never
    );
    expect(stopEvents).toEqual([
      { type: "tool_input", toolUseId: "tool-1", input: { file_path: "test.ts" } },
    ]);
  });

  test("tool_input with invalid JSON falls back to raw string", () => {
    const translate = createStreamTranslator();

    translate(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tool-2", name: "Write" },
      }) as never
    );

    translate(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "not valid json{" },
      }) as never
    );

    const stopEvents = translate(
      streamEvent({ type: "content_block_stop", index: 0 }) as never
    );

    expect(stopEvents).toHaveLength(1);
    expect(stopEvents[0].type).toBe("tool_input");
    const toolInput = stopEvents[0] as Extract<SdkRunnerEvent, { type: "tool_input" }>;
    expect(toolInput.input).toBe("not valid json{");
  });

  test("tool_input with empty chunks produces empty object", () => {
    const translate = createStreamTranslator();

    translate(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tool-3", name: "Bash" },
      }) as never
    );

    // No deltas, just stop
    const stopEvents = translate(
      streamEvent({ type: "content_block_stop", index: 0 }) as never
    );

    expect(stopEvents).toEqual([
      { type: "tool_input", toolUseId: "tool-3", input: {} },
    ]);
  });

  test("content_block_stop for non-tool block produces empty", () => {
    const translate = createStreamTranslator();

    // A text block stop without a preceding tool_use start
    const events = translate(
      streamEvent({ type: "content_block_stop", index: 5 }) as never
    );
    expect(events).toEqual([]);
  });

  test("result success produces turn_end with cost and usage", () => {
    const translate = createStreamTranslator();
    const events = translate(
      resultSuccess({
        cost: 0.05,
        inputTokens: 200,
        outputTokens: 100,
        contextWindow: 200000,
        model: "claude-sonnet-4-20250514",
      }) as never
    );

    expect(events).toHaveLength(1);
    const turnEnd = events[0] as Extract<SdkRunnerEvent, { type: "turn_end" }>;
    expect(turnEnd.type).toBe("turn_end");
    expect(turnEnd.cost).toBe(0.05);
    expect(turnEnd.usage).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      contextWindow: 200000,
      model: "claude-sonnet-4-20250514",
    });
  });

  test("result success without usage data produces turn_end without usage", () => {
    const translate = createStreamTranslator();
    const events = translate({
      type: "result" as const,
      session_id: "sess-1",
      subtype: "success",
      total_cost_usd: 0.01,
    } as never);

    expect(events).toHaveLength(1);
    const turnEnd = events[0] as Extract<SdkRunnerEvent, { type: "turn_end" }>;
    expect(turnEnd.type).toBe("turn_end");
    expect(turnEnd.cost).toBe(0.01);
    expect(turnEnd.usage).toBeUndefined();
  });

  test("result error with error messages", () => {
    const translate = createStreamTranslator();
    const events = translate(
      resultError("error_during_execution", ["Something went wrong", "Bad input"]) as never
    );

    expect(events).toEqual([
      { type: "error", reason: "Something went wrong; Bad input" },
    ]);
  });

  test("result error_max_turns without messages", () => {
    const translate = createStreamTranslator();
    const events = translate(resultError("error_max_turns") as never);

    expect(events).toEqual([
      { type: "error", reason: "Conversation reached maximum turns limit." },
    ]);
  });

  test("result error_max_budget_usd without messages", () => {
    const translate = createStreamTranslator();
    const events = translate(resultError("error_max_budget_usd") as never);

    expect(events).toEqual([
      { type: "error", reason: "Conversation exceeded budget limit." },
    ]);
  });

  test("result error_during_execution without messages produces default", () => {
    const translate = createStreamTranslator();
    const events = translate(resultError("error_during_execution") as never);

    expect(events).toEqual([
      { type: "error", reason: "An error occurred during execution." },
    ]);
  });

  test("assistant message is ignored", () => {
    const translate = createStreamTranslator();
    const events = translate(assistantMessage() as never);

    expect(events).toEqual([]);
  });

  test("unknown message type produces empty", () => {
    const translate = createStreamTranslator();
    const events = translate({
      type: "unknown_type",
      session_id: "sess-1",
    } as never);

    expect(events).toEqual([]);
  });

  test("user message with tool_result produces tool_result events", () => {
    const translate = createStreamTranslator();
    const events = translate(
      userMessage([
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: "File contents here",
        },
      ]) as never
    );

    expect(events).toEqual([
      {
        type: "tool_result",
        name: "",
        output: "File contents here",
        toolUseId: "tool-1",
      },
    ]);
  });

  test("user message with non-tool_result blocks is ignored", () => {
    const translate = createStreamTranslator();
    const events = translate(
      userMessage([
        { type: "text", text: "some text" },
        "just a string",
        null,
      ]) as never
    );

    expect(events).toEqual([]);
  });

  test("compact_boundary produces correct intermediate event", () => {
    const translate = createStreamTranslator();
    const events = translate(compactBoundary(50000, "auto") as never);

    expect(events).toEqual([
      { type: "compact_boundary", preTokens: 50000, trigger: "auto" },
    ]);
  });

  test("stream_event error produces error event", () => {
    const translate = createStreamTranslator();
    const events = translate(
      streamEvent({
        type: "error",
        error: { type: "overloaded_error", message: "API overloaded" },
      }) as never
    );

    expect(events).toEqual([{ type: "error", reason: "API overloaded" }]);
  });

  test("stream_event error without message falls back to type", () => {
    const translate = createStreamTranslator();
    const events = translate(
      streamEvent({
        type: "error",
        error: { type: "rate_limit_error" },
      }) as never
    );

    expect(events).toEqual([{ type: "error", reason: "rate_limit_error" }]);
  });

  test("multiple tool blocks tracked independently", () => {
    const translate = createStreamTranslator();

    // Start two tools at different block indices
    translate(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tool-a", name: "Read" },
      }) as never
    );

    translate(
      streamEvent({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "tool-b", name: "Write" },
      }) as never
    );

    // Add input to tool-a
    translate(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"a":1}' },
      }) as never
    );

    // Add input to tool-b
    translate(
      streamEvent({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"b":2}' },
      }) as never
    );

    // Stop tool-b first
    const stopB = translate(
      streamEvent({ type: "content_block_stop", index: 1 }) as never
    );
    expect(stopB).toEqual([
      { type: "tool_input", toolUseId: "tool-b", input: { b: 2 } },
    ]);

    // Stop tool-a
    const stopA = translate(
      streamEvent({ type: "content_block_stop", index: 0 }) as never
    );
    expect(stopA).toEqual([
      { type: "tool_input", toolUseId: "tool-a", input: { a: 1 } },
    ]);
  });

  test("content_block_start for text block produces empty", () => {
    const translate = createStreamTranslator();
    const events = translate(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }) as never
    );

    expect(events).toEqual([]);
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

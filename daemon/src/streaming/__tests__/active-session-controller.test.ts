/**
 * Active Session Controller Tests
 *
 * Tests the controller's event translation, abort handling, crash detection,
 * and between-turns state management.
 *
 * Uses configureSdkForTesting to inject mock SDK behavior.
 * Tests require temp directories for vault storage (session metadata).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createActiveSessionController } from "../active-session-controller";
import type { SessionEvent } from "@memory-loop/shared";
import { configureSdkForTesting, _resetForTesting } from "../../sdk-provider";
import type { QueryFunction } from "../../sdk-provider";

let tempDir: string;
let cleanupSdk: (() => void) | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join("/tmp/claude-1000", "controller-test-"));
  // Create the sessions dir and a CLAUDE.md so vault discovery works
  await mkdir(join(tempDir, ".memory-loop", "sessions"), { recursive: true });
});

afterEach(async () => {
  cleanupSdk?.();
  _resetForTesting();
  await rm(tempDir, { recursive: true, force: true });
});

/**
 * Creates a mock QueryFunction that yields the given SDK messages.
 * The first message must be a system init with session_id.
 */
function createMockQuery(
  messages: Array<Record<string, unknown>>,
  opts?: {
    supportedCommands?: Array<{ name: string; description: string }>;
    onInterrupt?: () => void;
    onClose?: () => void;
  }
): QueryFunction {
  return (() => {
    let interrupted = false;
    let index = 0;

    const generator = {
      async next() {
        if (interrupted || index >= messages.length) {
          return { done: true as const, value: undefined };
        }
        const value = messages[index++];
        return { done: false as const, value };
      },
      async return() {
        return { done: true as const, value: undefined };
      },
      async throw() {
        return { done: true as const, value: undefined };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      interrupt: async () => {
        interrupted = true;
        opts?.onInterrupt?.();
      },
      close: () => {
        interrupted = true;
        opts?.onClose?.();
      },
      supportedCommands: async () => opts?.supportedCommands ?? [],
    };

    return generator;
  }) as unknown as QueryFunction;
}

/**
 * Collects events emitted by the controller until a terminal event is received
 * or timeout is reached.
 */
function collectEvents(
  controller: ReturnType<typeof createActiveSessionController>,
  opts?: { timeout?: number }
): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const timeout = opts?.timeout ?? 2000;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(events), timeout);

    controller.subscribe((event) => {
      events.push(event);
      if (
        event.type === "response_end" ||
        event.type === "error" ||
        event.type === "aborted" ||
        event.type === "session_cleared"
      ) {
        clearTimeout(timer);
        // Give time for any follow-up events (e.g., response_end after error)
        setTimeout(() => resolve(events), 50);
      }
    });
  });
}

// =============================================================================
// Intermediate event processing
// =============================================================================

describe("intermediate event processing", () => {
  test("text_delta SDK events map to response_chunk SessionEvents", async () => {
    const mockQuery = createMockQuery([
      { type: "system", subtype: "init", session_id: "sess-1" },
      {
        type: "stream_event",
        session_id: "sess-1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      },
      {
        type: "stream_event",
        session_id: "sess-1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      },
      {
        type: "result",
        session_id: "sess-1",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 50, output_tokens: 20 },
        modelUsage: { "claude-sonnet-4-20250514": { contextWindow: 200000 } },
      },
    ]);

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();
    const eventPromise = collectEvents(controller);

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: null,
      prompt: "test",
    });

    const events = await eventPromise;

    const chunks = events.filter((e) => e.type === "response_chunk");
    expect(chunks).toHaveLength(2);
    expect((chunks[0] as { content: string }).content).toBe("Hello");
    expect((chunks[1] as { content: string }).content).toBe(" world");
  });

  test("tool lifecycle events map correctly", async () => {
    const mockQuery = createMockQuery([
      { type: "system", subtype: "init", session_id: "sess-2" },
      {
        type: "stream_event",
        session_id: "sess-2",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tool-1", name: "Read" },
        },
      },
      {
        type: "stream_event",
        session_id: "sess-2",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"path":"test.ts"}' },
        },
      },
      {
        type: "stream_event",
        session_id: "sess-2",
        event: { type: "content_block_stop", index: 0 },
      },
      {
        type: "user",
        session_id: "sess-2",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tool-1", content: "file contents" },
          ],
        },
      },
      {
        type: "result",
        session_id: "sess-2",
        subtype: "success",
        total_cost_usd: 0.02,
        usage: { input_tokens: 100, output_tokens: 50 },
        modelUsage: { "claude-sonnet-4-20250514": { contextWindow: 200000 } },
      },
    ]);

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();
    const eventPromise = collectEvents(controller);

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: null,
      prompt: "read test.ts",
    });

    const events = await eventPromise;

    const toolStart = events.find((e) => e.type === "tool_start");
    expect(toolStart).toBeDefined();
    expect((toolStart as { toolName: string }).toolName).toBe("Read");

    const toolInput = events.find((e) => e.type === "tool_input");
    expect(toolInput).toBeDefined();
    expect((toolInput as { input: unknown }).input).toEqual({ path: "test.ts" });

    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd).toBeDefined();
    expect((toolEnd as { output: unknown }).output).toBe("file contents");
  });

  test("SDK error results map to error SessionEvents", async () => {
    const mockQuery = createMockQuery([
      { type: "system", subtype: "init", session_id: "sess-3" },
      {
        type: "result",
        session_id: "sess-3",
        subtype: "error_max_turns",
      },
    ]);

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();
    const eventPromise = collectEvents(controller);

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: null,
      prompt: "test",
    });

    const events = await eventPromise;

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { message: string }).message).toContain("maximum turns");
  });

  test("compact_boundary resets cumulative tokens", async () => {
    const mockQuery = createMockQuery([
      { type: "system", subtype: "init", session_id: "sess-4" },
      {
        type: "result",
        session_id: "sess-4",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 40000, output_tokens: 10000 },
        modelUsage: { "claude-sonnet-4-20250514": { contextWindow: 200000 } },
      },
    ]);

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();
    const eventPromise = collectEvents(controller);

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: null,
      prompt: "test",
    });

    await eventPromise;

    // After first turn: cumulativeTokens = 50000
    const state1 = controller.getState();
    expect(state1.cumulativeTokens).toBe(50000);

    // Now send another message with a compact boundary
    const mockQuery2 = createMockQuery([
      { type: "system", subtype: "init", session_id: "sess-4" },
      {
        type: "system",
        subtype: "compact_boundary",
        session_id: "sess-4",
        compact_metadata: { pre_tokens: 50000, trigger: "auto" },
      },
      {
        type: "result",
        session_id: "sess-4",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 5000, output_tokens: 2000 },
        modelUsage: { "claude-sonnet-4-20250514": { contextWindow: 200000 } },
      },
    ]);

    _resetForTesting();
    cleanupSdk = configureSdkForTesting(mockQuery2);

    // Save session metadata so resume works
    const { saveSession } = await import("../../session-manager");
    await saveSession({
      id: "sess-4",
      vaultId: "v1",
      vaultPath: tempDir,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      messages: [],
    });

    const eventPromise2 = collectEvents(controller);

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: "sess-4",
      prompt: "continue",
    });

    await eventPromise2;

    // After compact: cumulative reset to Math.round(50000 * 0.3) = 15000
    // Then add new turn tokens: 5000 + 2000 = 7000
    // Total: 15000 + 7000 = 22000
    const state2 = controller.getState();
    expect(state2.cumulativeTokens).toBe(22000);
  });
});

// =============================================================================
// Between-turns state
// =============================================================================

describe("between-turns state", () => {
  test("after processing completes, only session identity and tokens are held", async () => {
    const mockQuery = createMockQuery([
      { type: "system", subtype: "init", session_id: "sess-btw" },
      {
        type: "stream_event",
        session_id: "sess-btw",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
      },
      {
        type: "result",
        session_id: "sess-btw",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        modelUsage: { "claude-sonnet-4-20250514": { contextWindow: 200000 } },
      },
    ]);

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();
    const eventPromise = collectEvents(controller);

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: null,
      prompt: "test",
    });

    await eventPromise;

    // After processing, check state
    const state = controller.getState();
    expect(state.sessionId).toBe("sess-btw");
    expect(state.vaultId).toBe("v1");
    expect(state.cumulativeTokens).toBe(150);
    expect(state.isStreaming).toBe(false);

    // Snapshot should show no active processing
    const snapshot = controller.getSnapshot();
    expect(snapshot.isProcessing).toBe(false);
    expect(snapshot.pendingPrompts).toEqual([]);
  });
});

// =============================================================================
// Abort during pending prompt
// =============================================================================

describe("abort during pending prompt", () => {
  test("abortProcessing with pending prompts emits aborted, not error", async () => {
    // This test verifies the controller's abortProcessing() behavior when
    // pending prompts exist. We set up a streaming session, then manually
    // add a pending prompt via respondToPrompt (which won't find it, but
    // we use the controller's internal mechanics).

    // To test the hasPendingPrompts path, we need the SDK to call canUseTool.
    // The mock query calls canUseTool with a tool name, which triggers the
    // controller's permission callback, storing the pending promise.

    let canUseToolCallback: ((toolName: string, input: Record<string, unknown>) => Promise<{ behavior: string; updatedInput?: Record<string, unknown>; message?: string }>) | null = null;

    const mockQuery = ((args: { options?: { canUseTool?: typeof canUseToolCallback } }) => {
      // Capture the canUseTool callback from options
      canUseToolCallback = args.options?.canUseTool ?? null;

      let messageIndex = 0;
      const messages = [
        { type: "system", subtype: "init", session_id: "sess-abort" },
        {
          type: "stream_event",
          session_id: "sess-abort",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Starting..." } },
        },
      ];

      let stalled = false;

      return {
        async next() {
          if (messageIndex < messages.length) {
            const value = messages[messageIndex++];
            return { done: false, value };
          }
          if (!stalled) {
            stalled = true;
            // Now trigger canUseTool callback (simulates SDK asking for permission)
            if (canUseToolCallback) {
              // Fire and forget; catch rejection from discardPendingPrompts
              canUseToolCallback("Write", { file_path: "test.ts", content: "hello" }).catch(() => {
                // Expected: rejected by discardPendingPrompts when aborting
              });
            }
          }
          // Stall to simulate waiting for canUseTool response
          return new Promise<{ done: boolean; value: unknown }>(() => {});
        },
        async return() {
          return { done: true, value: undefined };
        },
        async throw() {
          return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
        interrupt: async () => {},
        close: () => {},
        supportedCommands: async () => [],
      };
    }) as unknown as QueryFunction;

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();

    const events: SessionEvent[] = [];
    let abortTriggered = false;
    controller.subscribe((event) => {
      events.push(event);
      // When we see prompt_pending, trigger abort
      if (event.type === "prompt_pending" && !abortTriggered) {
        abortTriggered = true;
        // Give a tiny delay so the pending promise is stored
        setTimeout(() => controller.abortProcessing(), 10);
      }
    });

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: null,
      prompt: "write a file",
    });

    // Wait for events to settle
    await new Promise((resolve) => setTimeout(resolve, 500));

    // The prompt_pending should have been emitted
    const promptPending = events.find((e) => e.type === "prompt_pending");
    expect(promptPending).toBeDefined();

    // abortProcessing should have emitted "aborted" (not error) because
    // pending prompts were active (REQ-ESS-19)
    const abortedEvents = events.filter((e) => e.type === "aborted");
    expect(abortedEvents).toHaveLength(1);
  });
});

describe("crash during pending prompt", () => {
  test("subprocess crash while prompt pending emits error and clears prompts", async () => {
    let canUseToolCallback: ((toolName: string, input: Record<string, unknown>) => Promise<{ behavior: string; updatedInput?: Record<string, unknown>; message?: string }>) | null = null;

    const mockQuery = ((args: { options?: { canUseTool?: typeof canUseToolCallback } }) => {
      canUseToolCallback = args.options?.canUseTool ?? null;

      let messageIndex = 0;
      const messages = [
        { type: "system", subtype: "init", session_id: "sess-crash-prompt" },
        {
          type: "stream_event",
          session_id: "sess-crash-prompt",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Working..." } },
        },
      ];

      let stalled = false;

      return {
        async next() {
          if (messageIndex < messages.length) {
            const value = messages[messageIndex++];
            return { done: false, value };
          }
          if (!stalled) {
            stalled = true;
            if (canUseToolCallback) {
              canUseToolCallback("Write", { file_path: "test.ts", content: "hello" }).catch(() => {});
            }
          }
          // Simulate crash after triggering canUseTool
          await new Promise((resolve) => setTimeout(resolve, 100));
          throw new Error("Subprocess crashed while waiting for user response");
        },
        async return() {
          return { done: true, value: undefined };
        },
        async throw() {
          return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
        interrupt: async () => {},
        close: () => {},
        supportedCommands: async () => [],
      };
    }) as unknown as QueryFunction;

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();

    const events: SessionEvent[] = [];
    controller.subscribe((event) => events.push(event));

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: null,
      prompt: "write a file",
    });

    // Wait for crash to propagate
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have emitted error (not aborted, since this is a crash not user action)
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);

    // The error message should mention the crash context
    const crashError = errorEvents.find(
      (e) => (e as { message: string }).message.includes("crashed while waiting")
    );
    expect(crashError).toBeDefined();

    // Pending prompts should be cleared
    expect(controller.getPendingPrompts()).toEqual([]);
  });
});

// =============================================================================
// sendMessage error handling
// =============================================================================

describe("sendMessage error handling", () => {
  test("SDK failure emits error with SDK_ERROR code and rethrows", async () => {
    const mockQuery = (() => {
      throw new Error("Connection refused");
    }) as unknown as QueryFunction;

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();

    const events: SessionEvent[] = [];
    controller.subscribe((event) => events.push(event));

    await expect(
      controller.sendMessage({
        vaultId: "v1",
        vaultPath: tempDir,
        sessionId: null,
        prompt: "test",
      })
    ).rejects.toThrow("Connection refused");

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { code: string }).code).toBe("SDK_ERROR");
  });

  test("resume failure emits error with RESUME_FAILED code and rethrows", async () => {
    // Create session metadata
    const { saveSession } = await import("../../session-manager");
    await saveSession({
      id: "sess-rf",
      vaultId: "v1",
      vaultPath: tempDir,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      messages: [],
    });

    const mockQuery = (() => {
      throw new Error("Session not found");
    }) as unknown as QueryFunction;

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();

    const events: SessionEvent[] = [];
    controller.subscribe((event) => events.push(event));

    await expect(
      controller.sendMessage({
        vaultId: "v1",
        vaultPath: tempDir,
        sessionId: "sess-rf",
        prompt: "resume test",
      })
    ).rejects.toThrow("Could not resume previous session");

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { code: string }).code).toBe("RESUME_FAILED");
  });
});

// =============================================================================
// Subprocess cleanup
// =============================================================================

describe("subprocess cleanup", () => {
  test("after completion, queryResult is null and isStreaming is false", async () => {
    let closeCalled = false;
    const mockQuery = createMockQuery(
      [
        { type: "system", subtype: "init", session_id: "sess-cleanup" },
        {
          type: "stream_event",
          session_id: "sess-cleanup",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done" } },
        },
        {
          type: "result",
          session_id: "sess-cleanup",
          subtype: "success",
          total_cost_usd: 0.01,
          usage: { input_tokens: 50, output_tokens: 25 },
          modelUsage: { "claude-sonnet-4-20250514": { contextWindow: 200000 } },
        },
      ],
      { onClose: () => { closeCalled = true; } }
    );

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();
    const eventPromise = collectEvents(controller);

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: null,
      prompt: "test",
    });

    await eventPromise;

    // After completion
    expect(controller.isStreaming()).toBe(false);
    expect(controller.getSnapshot().isProcessing).toBe(false);
    // close() is called in finally block
    expect(closeCalled).toBe(true);
  });
});

// =============================================================================
// Streaming crash during processing
// =============================================================================

describe("streaming crash", () => {
  test("SDK error during streaming emits error event", async () => {
    // Mock that yields init then throws
    const mockQuery = (() => {
      let messageIndex = 0;
      const messages = [
        { type: "system", subtype: "init", session_id: "sess-crash" },
      ];

      return {
        async next() {
          if (messageIndex < messages.length) {
            const value = messages[messageIndex++];
            return { done: false, value };
          }
          // Throw to simulate crash
          throw new Error("Subprocess crashed unexpectedly");
        },
        async return() {
          return { done: true, value: undefined };
        },
        async throw() {
          return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
        interrupt: async () => {},
        close: () => {},
        supportedCommands: async () => [],
      };
    }) as unknown as QueryFunction;

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();
    const eventPromise = collectEvents(controller);

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: null,
      prompt: "test",
    });

    const events = await eventPromise;

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { message: string }).message).toContain("crashed");
  });
});

// =============================================================================
// clearSession
// =============================================================================

describe("clearSession", () => {
  test("emits session_cleared and resets state", async () => {
    const mockQuery = createMockQuery([
      { type: "system", subtype: "init", session_id: "sess-clear" },
      {
        type: "stream_event",
        session_id: "sess-clear",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
      },
      {
        type: "result",
        session_id: "sess-clear",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: { input_tokens: 50, output_tokens: 25 },
        modelUsage: { "claude-sonnet-4-20250514": { contextWindow: 200000 } },
      },
    ]);

    cleanupSdk = configureSdkForTesting(mockQuery);
    const controller = createActiveSessionController();
    const eventPromise = collectEvents(controller);

    await controller.sendMessage({
      vaultId: "v1",
      vaultPath: tempDir,
      sessionId: null,
      prompt: "test",
    });

    await eventPromise;

    // Now clear
    const clearEvents: SessionEvent[] = [];
    controller.subscribe((event) => clearEvents.push(event));
    controller.clearSession();

    const cleared = clearEvents.find((e) => e.type === "session_cleared");
    expect(cleared).toBeDefined();

    const state = controller.getState();
    expect(state.sessionId).toBeNull();
    expect(state.vaultId).toBeNull();
    expect(state.cumulativeTokens).toBe(0);
    expect(state.isStreaming).toBe(false);
  });
});

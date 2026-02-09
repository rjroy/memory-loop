/**
 * Active Session Controller Tests
 *
 * Unit tests for the session management and event streaming.
 * Integration tests for concurrency and lifecycle behavior.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createActiveSessionController,
  resetActiveSessionController,
  AlreadyProcessingError,
  type SessionEvent,
  type PendingPrompt,
} from "../streaming/index";
import { configureSdkForTesting, type QueryFunction } from "../sdk-provider";

describe("ActiveSessionController", () => {
  beforeEach(() => {
    resetActiveSessionController();
  });

  afterEach(() => {
    resetActiveSessionController();
  });

  describe("createActiveSessionController", () => {
    test("creates a new instance", () => {
      const controller = createActiveSessionController();
      expect(controller).toBeDefined();
      expect(typeof controller.getState).toBe("function");
      expect(typeof controller.subscribe).toBe("function");
    });

    test("initial state has no session", () => {
      const controller = createActiveSessionController();
      const state = controller.getState();

      expect(state.sessionId).toBeNull();
      expect(state.vaultId).toBeNull();
      expect(state.cumulativeTokens).toBe(0);
      expect(state.contextWindow).toBeNull();
      expect(state.activeModel).toBeNull();
      expect(state.isStreaming).toBe(false);
    });

    test("isStreaming returns false initially", () => {
      const controller = createActiveSessionController();
      expect(controller.isStreaming()).toBe(false);
    });

    test("getPendingPrompts returns empty array initially", () => {
      const controller = createActiveSessionController();
      expect(controller.getPendingPrompts()).toEqual([]);
    });
  });

  describe("subscribe", () => {
    test("subscribing returns unsubscribe function", () => {
      const controller = createActiveSessionController();
      const callback = mock(() => {});

      const unsubscribe = controller.subscribe(callback);

      expect(unsubscribe).toBeInstanceOf(Function);
    });

    test("unsubscribe removes listener", () => {
      const controller = createActiveSessionController();
      const callback = mock(() => {});

      const unsubscribe = controller.subscribe(callback);
      unsubscribe();

      // clearSession would normally emit session_cleared, but after unsubscribe
      // the callback should not be called
      controller.clearSession();

      // Callback should not have been called after unsubscribe
      // (clearSession emits session_cleared, but we unsubscribed first)
      expect(callback).not.toHaveBeenCalled();
    });

    test("subscriber callback errors are caught", () => {
      const controller = createActiveSessionController();

      // Subscriber that throws
      const throwingCallback = mock(() => {
        throw new Error("Subscriber error");
      });

      // Normal subscriber
      const normalCallback = mock(() => {});

      controller.subscribe(throwingCallback);
      controller.subscribe(normalCallback);

      // clearSession emits session_cleared - should not crash despite throwing callback
      controller.clearSession();

      // Both callbacks should have been called (throwing one doesn't prevent others)
      expect(throwingCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
    });
  });

  describe("clearSession", () => {
    test("emits session_cleared event", () => {
      const controller = createActiveSessionController();
      const events: SessionEvent[] = [];

      controller.subscribe((event) => events.push(event));

      controller.clearSession();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("session_cleared");
    });

    test("resets state to initial values", () => {
      const controller = createActiveSessionController();

      controller.clearSession();

      const state = controller.getState();
      expect(state.sessionId).toBeNull();
      expect(state.vaultId).toBeNull();
      expect(state.cumulativeTokens).toBe(0);
      expect(state.contextWindow).toBeNull();
      expect(state.isStreaming).toBe(false);
    });

    test("resets isProcessing to false", () => {
      const controller = createActiveSessionController();
      controller.clearSession();
      const snapshot = controller.getSnapshot();
      expect(snapshot.isProcessing).toBe(false);
    });
  });

  describe("respondToPrompt", () => {
    test("emits prompt_response_rejected for unknown prompt", () => {
      const controller = createActiveSessionController();
      const events: SessionEvent[] = [];

      controller.subscribe((event) => events.push(event));

      controller.respondToPrompt("unknown-id", {
        type: "tool_permission",
        allowed: true,
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("prompt_response_rejected");
      if (events[0].type === "prompt_response_rejected") {
        expect(events[0].promptId).toBe("unknown-id");
        expect(events[0].reason).toBe("not_found");
      }
    });

    test("emits prompt_response_rejected for unknown question", () => {
      const controller = createActiveSessionController();
      const events: SessionEvent[] = [];

      controller.subscribe((event) => events.push(event));

      controller.respondToPrompt("unknown-question", {
        type: "ask_user_question",
        answers: { q1: "answer" },
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("prompt_response_rejected");
      if (events[0].type === "prompt_response_rejected") {
        expect(events[0].promptId).toBe("unknown-question");
        expect(events[0].reason).toBe("not_found");
      }
    });
  });

  describe("getSnapshot", () => {
    test("returns empty snapshot with no active session", () => {
      const controller = createActiveSessionController();
      const snapshot = controller.getSnapshot();

      expect(snapshot.sessionId).toBeNull();
      expect(snapshot.isProcessing).toBe(false);
      expect(snapshot.content).toBe("");
      expect(snapshot.toolInvocations).toEqual([]);
      expect(snapshot.pendingPrompts).toEqual([]);
      expect(snapshot.contextUsage).toBeUndefined();
      expect(snapshot.cumulativeTokens).toBe(0);
      expect(snapshot.contextWindow).toBeNull();
    });
  });

  describe("multiple subscribers", () => {
    test("all subscribers receive events", () => {
      const controller = createActiveSessionController();
      const events1: SessionEvent[] = [];
      const events2: SessionEvent[] = [];

      controller.subscribe((event) => events1.push(event));
      controller.subscribe((event) => events2.push(event));

      controller.clearSession();

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0].type).toBe("session_cleared");
      expect(events2[0].type).toBe("session_cleared");
    });
  });

  describe("abortProcessing", () => {
    test("does nothing when no active processing", () => {
      const controller = createActiveSessionController();
      // Should not throw
      controller.abortProcessing();
    });

    test("abortProcessing is a function on the controller", () => {
      const controller = createActiveSessionController();
      expect(typeof controller.abortProcessing).toBe("function");
    });
  });
});

describe("AlreadyProcessingError", () => {
  test("has correct error properties", () => {
    const error = new AlreadyProcessingError();
    expect(error.code).toBe("ALREADY_PROCESSING");
    expect(error.name).toBe("AlreadyProcessingError");
    expect(error.message).toContain("currently being processed");
    expect(error instanceof Error).toBe(true);
  });

  test("is throwable and catchable", () => {
    expect(() => {
      throw new AlreadyProcessingError();
    }).toThrow(AlreadyProcessingError);
  });
});

describe("SessionEvent types", () => {
  test("response_start event shape", () => {
    const event: SessionEvent = {
      type: "response_start",
      messageId: "msg_123",
    };
    expect(event.type).toBe("response_start");
    expect(event.messageId).toBe("msg_123");
  });

  test("response_chunk event shape", () => {
    const event: SessionEvent = {
      type: "response_chunk",
      messageId: "msg_123",
      content: "Hello",
    };
    expect(event.type).toBe("response_chunk");
    expect(event.content).toBe("Hello");
  });

  test("response_end event shape", () => {
    const event: SessionEvent = {
      type: "response_end",
      messageId: "msg_123",
      contextUsage: 45,
      durationMs: 1234,
    };
    expect(event.type).toBe("response_end");
    expect(event.contextUsage).toBe(45);
    expect(event.durationMs).toBe(1234);
  });

  test("tool_start event shape", () => {
    const event: SessionEvent = {
      type: "tool_start",
      toolUseId: "tool_123",
      toolName: "Read",
    };
    expect(event.type).toBe("tool_start");
    expect(event.toolUseId).toBe("tool_123");
    expect(event.toolName).toBe("Read");
  });

  test("prompt_pending event shape", () => {
    const prompt: PendingPrompt = {
      id: "prompt_123",
      type: "tool_permission",
      toolName: "Write",
      input: { file_path: "/test.md" },
    };
    const event: SessionEvent = {
      type: "prompt_pending",
      prompt,
    };
    expect(event.type).toBe("prompt_pending");
    expect(event.prompt.id).toBe("prompt_123");
    expect(event.prompt.type).toBe("tool_permission");
  });

  test("error event shape", () => {
    const event: SessionEvent = {
      type: "error",
      code: "SDK_ERROR",
      message: "Something went wrong",
    };
    expect(event.type).toBe("error");
    expect(event.code).toBe("SDK_ERROR");
    expect(event.message).toBe("Something went wrong");
  });

  test("session_cleared event shape", () => {
    const event: SessionEvent = { type: "session_cleared" };
    expect(event.type).toBe("session_cleared");
  });

  test("session_ready event shape", () => {
    const event: SessionEvent = {
      type: "session_ready",
      sessionId: "session_123",
      vaultId: "vault_1",
      createdAt: "2026-02-05T12:00:00Z",
    };
    expect(event.type).toBe("session_ready");
    expect(event.sessionId).toBe("session_123");
    expect(event.vaultId).toBe("vault_1");
    expect(event.createdAt).toBe("2026-02-05T12:00:00Z");
  });
});

// =============================================================================
// Integration Tests: Concurrency and Lifecycle
// =============================================================================

/**
 * Creates a mock SDK query function that yields events with configurable delays.
 *
 * The mock simulates the SDK's query() function. It returns an async generator
 * that yields a system init event (for session ID extraction) followed by a
 * result event (to complete streaming). Delays between events simulate real
 * streaming latency.
 *
 * @param sessionId - The session ID to use in events
 * @param delayMs - Delay in ms between events (default 10)
 * @param eventCount - Number of text chunk events to yield before result (default 3)
 * @returns A QueryFunction-compatible mock
 */
function createDelayedMockQueryFn(
  sessionId: string,
  delayMs = 10,
  eventCount = 3
): QueryFunction {
  const interruptFn = mock(() => Promise.resolve());
  const closeFn = mock(() => {});
  const supportedCommandsFn = mock(() => Promise.resolve([]));

  const generator = (async function* () {
    // First event must have session_id for extractSessionId()
    yield { type: "system", subtype: "init", session_id: sessionId };

    // Yield text chunks with delays to simulate streaming
    for (let i = 0; i < eventCount; i++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      yield {
        type: "stream_event",
        session_id: sessionId,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: `chunk-${i} ` },
        },
      };
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // Terminal event
    yield {
      type: "result",
      subtype: "success",
      session_id: sessionId,
      usage: { input_tokens: 100, output_tokens: 50 },
      modelUsage: {},
    };
  })();

  // Attach SDK Query methods to the generator
  Object.assign(generator, {
    interrupt: interruptFn,
    close: closeFn,
    supportedCommands: supportedCommandsFn,
  });

  // Return a function matching the QueryFunction signature
  return (() => generator) as unknown as QueryFunction;
}

/**
 * Creates a test vault directory with the minimum files needed for
 * session-manager operations (vault config loading, session persistence).
 */
async function createTestVault(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const testDir = join(
    tmpdir(),
    `asc-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  // CLAUDE.md is needed for vault discovery (not strictly required here,
  // but matches production expectations)
  await writeFile(join(testDir, "CLAUDE.md"), "# Test Vault");

  return {
    path: testDir,
    cleanup: async () => {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

describe("Integration: processing continues after subscriber removal (REQ-SDC-4)", () => {
  let vault: { path: string; cleanup: () => Promise<void> };
  let sdkCleanup: () => void;

  beforeEach(async () => {
    resetActiveSessionController();
    vault = await createTestVault();
  });

  afterEach(async () => {
    resetActiveSessionController();
    sdkCleanup?.();
    await vault.cleanup();
  });

  test("processing completes even after all subscribers unsubscribe mid-stream", async () => {
    const sessionId = "sub-removal-session";

    // Create a mock with enough events and delay to allow unsubscribe mid-stream
    sdkCleanup = configureSdkForTesting(
      createDelayedMockQueryFn(sessionId, 15, 5)
    );

    const controller = createActiveSessionController();
    const events: SessionEvent[] = [];

    const unsubscribe = controller.subscribe((event) => {
      events.push(event);

      // Unsubscribe after receiving the first response_chunk.
      // This simulates a client disconnecting mid-stream.
      if (event.type === "response_chunk") {
        unsubscribe();
      }
    });

    // Send a message (fire-and-forget streaming starts internally)
    await controller.sendMessage({
      vaultId: "test-vault",
      vaultPath: vault.path,
      sessionId: null,
      prompt: "Hello",
    });

    // Wait for streaming to complete. The controller runs streaming in the
    // background, so we poll the state until isProcessing goes false.
    const maxWait = 2000;
    const start = Date.now();
    while (controller.getSnapshot().isProcessing && Date.now() - start < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Key assertion: processing completed despite having zero subscribers
    expect(controller.getSnapshot().isProcessing).toBe(false);
    expect(controller.isStreaming()).toBe(false);

    // The subscriber received at least session_ready and one chunk before
    // unsubscribing
    const hasSessionReady = events.some((e) => e.type === "session_ready");
    const hasChunk = events.some((e) => e.type === "response_chunk");
    expect(hasSessionReady).toBe(true);
    expect(hasChunk).toBe(true);

    // The subscriber should NOT have received response_end because it
    // unsubscribed before streaming finished
    const hasResponseEnd = events.some((e) => e.type === "response_end");
    expect(hasResponseEnd).toBe(false);
  });
});

describe("Integration: generation guard prevents stale cleanup (REQ-SDC-18)", () => {
  let vault: { path: string; cleanup: () => Promise<void> };
  let sdkCleanup: () => void;

  beforeEach(async () => {
    resetActiveSessionController();
    vault = await createTestVault();
  });

  afterEach(async () => {
    resetActiveSessionController();
    sdkCleanup?.();
    await vault.cleanup();
  });

  test("stale finally block does not reset state after clearSession", async () => {
    const sessionIdA = "gen-guard-session-a";
    const sessionIdB = "gen-guard-session-b";

    let callCount = 0;

    // Mock query function that returns different sessions per call.
    // First call: slow generator (message A)
    // Second call: fast generator (message B)
    const mockQueryFn = (() => {
      callCount++;
      const currentSessionId = callCount === 1 ? sessionIdA : sessionIdB;
      const delayMs = callCount === 1 ? 50 : 10;
      const eventCount = callCount === 1 ? 5 : 2;

      const interruptFn = mock(() => Promise.resolve());
      const closeFn = mock(() => {});
      const supportedCommandsFn = mock(() => Promise.resolve([]));

      const gen = (async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: currentSessionId,
        };

        for (let i = 0; i < eventCount; i++) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          yield {
            type: "stream_event",
            session_id: currentSessionId,
            event: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: `msg-${callCount}-chunk-${i} ` },
            },
          };
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        yield {
          type: "result",
          subtype: "success",
          session_id: currentSessionId,
          usage: { input_tokens: 50, output_tokens: 25 },
          modelUsage: {},
        };
      })();

      Object.assign(gen, {
        interrupt: interruptFn,
        close: closeFn,
        supportedCommands: supportedCommandsFn,
      });

      return gen;
    }) as unknown as QueryFunction;

    sdkCleanup = configureSdkForTesting(mockQueryFn);

    const controller = createActiveSessionController();
    const events: SessionEvent[] = [];
    controller.subscribe((event) => events.push(event));

    // Send message A (starts slow processing, gets generation N)
    await controller.sendMessage({
      vaultId: "test-vault",
      vaultPath: vault.path,
      sessionId: null,
      prompt: "Message A",
    });

    // Wait briefly for A to start streaming
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(controller.getSnapshot().isProcessing).toBe(true);

    // clearSession increments generation, resets state, aborts A
    controller.clearSession();

    // State should be cleared immediately
    expect(controller.getState().sessionId).toBeNull();
    expect(controller.getSnapshot().isProcessing).toBe(false);

    // Send message B (gets generation N+2)
    await controller.sendMessage({
      vaultId: "test-vault",
      vaultPath: vault.path,
      sessionId: null,
      prompt: "Message B",
    });

    // Wait for B to complete
    const maxWait = 2000;
    const start = Date.now();
    while (controller.getSnapshot().isProcessing && Date.now() - start < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Wait a bit more for A's finally block to run (it may still be in-flight)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Key assertion: after everything settles, the controller's sessionId
    // matches message B's session, not null (which would indicate A's stale
    // finally block corrupted state)
    expect(controller.getState().sessionId).toBe(sessionIdB);
    expect(controller.getSnapshot().isProcessing).toBe(false);
  });
});

describe("Integration: new session clears existing processing (REQ-SDC-6)", () => {
  let vault: { path: string; cleanup: () => Promise<void> };
  let sdkCleanup: () => void;

  beforeEach(async () => {
    resetActiveSessionController();
    vault = await createTestVault();
  });

  afterEach(async () => {
    resetActiveSessionController();
    sdkCleanup?.();
    await vault.cleanup();
  });

  test("sending a new session while processing clears the old session", async () => {
    const sessionIdA = "clear-session-a";
    const sessionIdB = "clear-session-b";

    let callCount = 0;

    // Mock query function: first call is slow, second is fast
    const mockQueryFn = (() => {
      callCount++;
      const currentSessionId = callCount === 1 ? sessionIdA : sessionIdB;
      const delayMs = callCount === 1 ? 50 : 10;
      const eventCount = callCount === 1 ? 8 : 2;

      const interruptFn = mock(() => Promise.resolve());
      const closeFn = mock(() => {});
      const supportedCommandsFn = mock(() => Promise.resolve([]));

      const gen = (async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: currentSessionId,
        };

        for (let i = 0; i < eventCount; i++) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          yield {
            type: "stream_event",
            session_id: currentSessionId,
            event: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: `msg-${callCount}-chunk-${i} ` },
            },
          };
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        yield {
          type: "result",
          subtype: "success",
          session_id: currentSessionId,
          usage: { input_tokens: 50, output_tokens: 25 },
          modelUsage: {},
        };
      })();

      Object.assign(gen, {
        interrupt: interruptFn,
        close: closeFn,
        supportedCommands: supportedCommandsFn,
      });

      return gen;
    }) as unknown as QueryFunction;

    sdkCleanup = configureSdkForTesting(mockQueryFn);

    const controller = createActiveSessionController();
    const events: SessionEvent[] = [];
    controller.subscribe((event) => events.push(event));

    // Send message A (starts slow processing)
    await controller.sendMessage({
      vaultId: "test-vault",
      vaultPath: vault.path,
      sessionId: null,
      prompt: "Message A",
    });

    // Wait for A to start streaming
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(controller.getSnapshot().isProcessing).toBe(true);

    // Send message B with NO sessionId (triggers new session).
    // Per REQ-SDC-6, this should clear A's processing first.
    await controller.sendMessage({
      vaultId: "test-vault",
      vaultPath: vault.path,
      sessionId: null,
      prompt: "Message B",
    });

    // Wait for B to complete
    const maxWait = 2000;
    const start = Date.now();
    while (controller.getSnapshot().isProcessing && Date.now() - start < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Wait for any stale cleanup from A
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Key assertions:
    // 1. Controller has B's sessionId, not A's
    expect(controller.getState().sessionId).toBe(sessionIdB);

    // 2. A's processing was aborted (session_cleared was emitted between A and B)
    const clearedEvents = events.filter((e) => e.type === "session_cleared");
    expect(clearedEvents.length).toBeGreaterThanOrEqual(1);

    // 3. Processing is complete
    expect(controller.getSnapshot().isProcessing).toBe(false);

    // 4. B's session_ready was emitted
    const sessionReadyEvents = events.filter(
      (e) => e.type === "session_ready"
    );
    const bReady = sessionReadyEvents.find(
      (e) => e.type === "session_ready" && e.sessionId === sessionIdB
    );
    expect(bReady).toBeDefined();
  });
});

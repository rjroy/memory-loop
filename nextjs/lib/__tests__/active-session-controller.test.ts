/**
 * Active Session Controller Tests
 *
 * Unit tests for the session management and event streaming.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  createActiveSessionController,
  resetActiveSessionController,
  type SessionEvent,
  type PendingPrompt,
} from "../streaming/index";

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

    test("unsubscribe removes listener", async () => {
      const controller = createActiveSessionController();
      const callback = mock(() => {});

      const unsubscribe = controller.subscribe(callback);
      unsubscribe();

      // clearSession would normally emit session_cleared, but after unsubscribe
      // the callback should not be called
      await controller.clearSession();

      // Callback should not have been called after unsubscribe
      // (clearSession emits session_cleared, but we unsubscribed first)
      expect(callback).not.toHaveBeenCalled();
    });

    test("subscriber callback errors are caught", async () => {
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
      await controller.clearSession();

      // Both callbacks should have been called (throwing one doesn't prevent others)
      expect(throwingCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
    });
  });

  describe("clearSession", () => {
    test("emits session_cleared event", async () => {
      const controller = createActiveSessionController();
      const events: SessionEvent[] = [];

      controller.subscribe((event) => events.push(event));

      await controller.clearSession();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("session_cleared");
    });

    test("resets state to initial values", async () => {
      const controller = createActiveSessionController();

      await controller.clearSession();

      const state = controller.getState();
      expect(state.sessionId).toBeNull();
      expect(state.vaultId).toBeNull();
      expect(state.cumulativeTokens).toBe(0);
      expect(state.contextWindow).toBeNull();
      expect(state.isStreaming).toBe(false);
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

  describe("multiple subscribers", () => {
    test("all subscribers receive events", async () => {
      const controller = createActiveSessionController();
      const events1: SessionEvent[] = [];
      const events2: SessionEvent[] = [];

      controller.subscribe((event) => events1.push(event));
      controller.subscribe((event) => events2.push(event));

      await controller.clearSession();

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0].type).toBe("session_cleared");
      expect(events2[0].type).toBe("session_cleared");
    });
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

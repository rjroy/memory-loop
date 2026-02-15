/**
 * Tests for streaming reducer actions.
 *
 * These actions were introduced to fix message fragmentation during streaming.
 * The root cause: useServerMessageHandler read messagesRef.current (stale between
 * renders) to decide create-vs-append. Moving this decision into the reducer
 * eliminates the race because the reducer always sees the latest state.
 */
import { describe, expect, test } from "bun:test";
import { sessionReducer } from "../reducer";
import { createInitialSessionState } from "../initial-state";
import type { SessionState } from "../types";
import type { ConversationMessage } from "../types";

const initialState = createInitialSessionState();

function makeStreamingAssistantMessage(content = ""): ConversationMessage {
  return {
    id: "msg_1",
    role: "assistant",
    content,
    timestamp: new Date(),
    isStreaming: true,
  };
}

function makeFinishedAssistantMessage(content = "done"): ConversationMessage {
  return {
    id: "msg_1",
    role: "assistant",
    content,
    timestamp: new Date(),
    isStreaming: false,
  };
}

function makeUserMessage(content = "hello"): ConversationMessage {
  return {
    id: "msg_0",
    role: "user",
    content,
    timestamp: new Date(),
  };
}

// ---------------------------------------------------------------------------
// ENSURE_STREAMING_MESSAGE
// ---------------------------------------------------------------------------
describe("ENSURE_STREAMING_MESSAGE", () => {
  test("creates a streaming assistant message when messages are empty", () => {
    const result = sessionReducer(initialState, { type: "ENSURE_STREAMING_MESSAGE" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("assistant");
    expect(result.messages[0].content).toBe("");
    expect(result.messages[0].isStreaming).toBe(true);
  });

  test("creates a streaming assistant message when last message is a user message", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeUserMessage()],
    };
    const result = sessionReducer(state, { type: "ENSURE_STREAMING_MESSAGE" });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].role).toBe("assistant");
    expect(result.messages[1].isStreaming).toBe(true);
  });

  test("no-ops when last message is already a streaming assistant message", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeUserMessage(), makeStreamingAssistantMessage()],
    };
    const result = sessionReducer(state, { type: "ENSURE_STREAMING_MESSAGE" });
    // Same reference means no state change
    expect(result).toBe(state);
  });

  test("creates new message when last assistant message is not streaming", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeUserMessage(), makeFinishedAssistantMessage()],
    };
    const result = sessionReducer(state, { type: "ENSURE_STREAMING_MESSAGE" });
    expect(result.messages).toHaveLength(3);
    expect(result.messages[2].isStreaming).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// APPEND_STREAMING_CHUNK
// ---------------------------------------------------------------------------
describe("APPEND_STREAMING_CHUNK", () => {
  test("appends content to existing streaming assistant message", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeUserMessage(), makeStreamingAssistantMessage("Hello")],
    };
    const result = sessionReducer(state, {
      type: "APPEND_STREAMING_CHUNK",
      content: " world",
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe("Hello world");
    expect(result.messages[1].isStreaming).toBe(true);
  });

  test("creates a streaming assistant message when none exists", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeUserMessage()],
    };
    const result = sessionReducer(state, {
      type: "APPEND_STREAMING_CHUNK",
      content: "first chunk",
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].role).toBe("assistant");
    expect(result.messages[1].content).toBe("first chunk");
    expect(result.messages[1].isStreaming).toBe(true);
  });

  test("creates a streaming message when last assistant is not streaming", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeFinishedAssistantMessage()],
    };
    const result = sessionReducer(state, {
      type: "APPEND_STREAMING_CHUNK",
      content: "new turn",
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe("new turn");
  });

  test("prepends line break when needsLineBreakBeforeText is set", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeStreamingAssistantMessage("before tool")],
      needsLineBreakBeforeText: true,
    };
    const result = sessionReducer(state, {
      type: "APPEND_STREAMING_CHUNK",
      content: "after tool",
    });
    expect(result.messages[0].content).toBe("before tool\n\nafter tool");
    expect(result.needsLineBreakBeforeText).toBe(false);
  });

  test("handles empty messages array", () => {
    const result = sessionReducer(initialState, {
      type: "APPEND_STREAMING_CHUNK",
      content: "first",
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("first");
    expect(result.messages[0].role).toBe("assistant");
  });
});

// ---------------------------------------------------------------------------
// APPEND_STREAMING_CHUNK solves the fragmentation race
// ---------------------------------------------------------------------------
describe("fragmentation race condition", () => {
  test("rapid ENSURE then APPEND sees the message created by ENSURE", () => {
    // This is the exact sequence that caused the bug:
    // 1. response_start dispatches ENSURE_STREAMING_MESSAGE
    // 2. response_chunk dispatches APPEND_STREAMING_CHUNK
    // In the old code, step 2 read a stale ref and created a second message.
    // In the reducer, step 2 sees the message from step 1.
    let state = initialState;
    state = { ...state, messages: [makeUserMessage()] };

    // response_start
    state = sessionReducer(state, { type: "ENSURE_STREAMING_MESSAGE" });
    expect(state.messages).toHaveLength(2);

    // response_chunk (same reducer state, no React render in between)
    state = sessionReducer(state, { type: "APPEND_STREAMING_CHUNK", content: "Hello" });
    expect(state.messages).toHaveLength(2); // Still 2, not 3
    expect(state.messages[1].content).toBe("Hello");
  });

  test("multiple chunks accumulate into a single message", () => {
    let state: SessionState = {
      ...initialState,
      messages: [makeUserMessage()],
    };

    state = sessionReducer(state, { type: "ENSURE_STREAMING_MESSAGE" });
    state = sessionReducer(state, { type: "APPEND_STREAMING_CHUNK", content: "Good" });
    state = sessionReducer(state, { type: "APPEND_STREAMING_CHUNK", content: " morning" });
    state = sessionReducer(state, { type: "APPEND_STREAMING_CHUNK", content: "!" });

    expect(state.messages).toHaveLength(2); // user + one assistant
    expect(state.messages[1].content).toBe("Good morning!");
  });
});

// ---------------------------------------------------------------------------
// SET_MESSAGES_IF_EMPTY
// ---------------------------------------------------------------------------
describe("SET_MESSAGES_IF_EMPTY", () => {
  test("sets messages when list is empty", () => {
    const protocolMessages = [
      {
        id: "msg_server_1",
        role: "user" as const,
        content: "hi",
        timestamp: new Date().toISOString(),
      },
      {
        id: "msg_server_2",
        role: "assistant" as const,
        content: "hello",
        timestamp: new Date().toISOString(),
      },
    ];
    const result = sessionReducer(initialState, {
      type: "SET_MESSAGES_IF_EMPTY",
      messages: protocolMessages,
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe("hi");
    expect(result.messages[1].content).toBe("hello");
  });

  test("no-ops when messages already exist", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeUserMessage()],
    };
    const result = sessionReducer(state, {
      type: "SET_MESSAGES_IF_EMPTY",
      messages: [
        {
          id: "msg_server_1",
          role: "assistant" as const,
          content: "should not appear",
          timestamp: new Date().toISOString(),
        },
      ],
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("hello"); // Original user message
  });
});

// ---------------------------------------------------------------------------
// HANDLE_SNAPSHOT
// ---------------------------------------------------------------------------
describe("HANDLE_SNAPSHOT", () => {
  test("restores session ID and creates assistant message", () => {
    const result = sessionReducer(initialState, {
      type: "HANDLE_SNAPSHOT",
      sessionId: "session-123",
      content: "snapshot content",
      isProcessing: true,
    });
    expect(result.sessionId).toBe("session-123");
    expect(result.pendingSessionId).toBeNull();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("snapshot content");
    expect(result.messages[0].isStreaming).toBe(true);
  });

  test("replaces existing streaming assistant message", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeUserMessage(), makeStreamingAssistantMessage("partial")],
    };
    const result = sessionReducer(state, {
      type: "HANDLE_SNAPSHOT",
      content: "full content from server",
      isProcessing: false,
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe("full content from server");
    expect(result.messages[1].isStreaming).toBe(false);
  });

  test("adds new message when last message is not streaming assistant", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeUserMessage()],
    };
    const result = sessionReducer(state, {
      type: "HANDLE_SNAPSHOT",
      content: "snapshot",
      isProcessing: false,
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe("snapshot");
  });

  test("no message change when content is empty", () => {
    const result = sessionReducer(initialState, {
      type: "HANDLE_SNAPSHOT",
      sessionId: "session-123",
      content: "",
      isProcessing: false,
    });
    expect(result.sessionId).toBe("session-123");
    expect(result.messages).toHaveLength(0);
  });

  test("sets context usage on last assistant message", () => {
    const state: SessionState = {
      ...initialState,
      messages: [makeStreamingAssistantMessage("content")],
    };
    const result = sessionReducer(state, {
      type: "HANDLE_SNAPSHOT",
      content: "updated",
      isProcessing: false,
      contextUsage: 42,
    });
    expect(result.messages[0].contextUsage).toBe(42);
  });

  test("preserves session state when sessionId is undefined", () => {
    const state: SessionState = {
      ...initialState,
      sessionId: "existing-session",
      pendingSessionId: "pending-id",
    };
    const result = sessionReducer(state, {
      type: "HANDLE_SNAPSHOT",
      content: "content",
      isProcessing: false,
    });
    expect(result.sessionId).toBe("existing-session");
    expect(result.pendingSessionId).toBe("pending-id");
  });
});

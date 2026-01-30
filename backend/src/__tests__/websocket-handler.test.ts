/**
 * WebSocket Handler Tests
 *
 * Unit tests for WebSocket message routing and handling.
 * Uses dependency injection for external dependencies.
 */

/* eslint-disable @typescript-eslint/require-await, require-yield */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VaultInfo, ServerMessage, SlashCommand } from "@memory-loop/shared";
import type { SessionMetadata, ConversationMessage } from "../session-manager";
import type { SetupResult } from "../vault-setup";
import {
  WebSocketHandler,
  createWebSocketHandler,
  createConnectionState,
  generateMessageId,
  type WebSocketHandlerDependencies,
} from "../websocket-handler";
import { VaultCreationError } from "../vault-manager";

// =============================================================================
// Mock Setup
// =============================================================================

const mockDiscoverVaults = mock<() => Promise<VaultInfo[]>>(() => Promise.resolve([]));
const mockGetVaultById = mock<(id: string) => Promise<VaultInfo | null>>(() => Promise.resolve(null));
const mockCreateVault = mock<(title: string) => Promise<VaultInfo>>(() => Promise.resolve(createMockVault()));
const mockInterrupt = mock(() => Promise.resolve());
const mockSupportedCommands = mock<() => Promise<Array<{ name: string; description: string; argumentHint?: string }>>>(() => Promise.resolve([]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateSession = mock<(...args: any[]) => Promise<any>>(() =>
  Promise.resolve({
    sessionId: "test-session-id",
    events: (async function* () {})(),
    interrupt: mockInterrupt,
    supportedCommands: mockSupportedCommands,
  })
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockResumeSession = mock<(...args: any[]) => Promise<any>>(() =>
  Promise.resolve({
    sessionId: "resumed-session-id",
    events: (async function* () {})(),
    interrupt: mockInterrupt,
    supportedCommands: mockSupportedCommands,
  })
);

const mockLoadSession = mock<(vaultPath: string, sessionId: string) => Promise<SessionMetadata | null>>(() =>
  Promise.resolve(null)
);

const mockAppendMessage = mock<(vaultPath: string, sessionId: string, message: ConversationMessage) => Promise<void>>(() =>
  Promise.resolve()
);

const mockLoadSlashCommands = mock<(vaultPath: string) => Promise<SlashCommand[] | undefined>>(() =>
  Promise.resolve(undefined)
);

const mockSaveSlashCommands = mock<(vaultPath: string, commands: SlashCommand[]) => Promise<void>>(() =>
  Promise.resolve()
);

const mockRunVaultSetup = mock<(vaultId: string) => Promise<SetupResult>>(() =>
  Promise.resolve({
    success: true,
    summary: ["Installed 6 commands", "Created 4 directories", "CLAUDE.md updated"],
  })
);

// =============================================================================
// Test Helpers
// =============================================================================

function createMockDeps(): WebSocketHandlerDependencies {
  return {
    discoverVaults: mockDiscoverVaults,
    getVaultById: mockGetVaultById,
    createVault: mockCreateVault,
    createSession: mockCreateSession,
    resumeSession: mockResumeSession,
    loadSession: mockLoadSession,
    appendMessage: mockAppendMessage,
    loadSlashCommands: mockLoadSlashCommands,
    saveSlashCommands: mockSaveSlashCommands,
    runVaultSetup: mockRunVaultSetup,
  };
}

function createTestHandler(): WebSocketHandler {
  return createWebSocketHandler(createMockDeps());
}

function createMockVault(overrides: Partial<VaultInfo> = {}): VaultInfo {
  const path = overrides.path ?? "/tmp/test-vault";
  return {
    id: "test-vault",
    name: "Test Vault",
    path,
    hasClaudeMd: true,
    contentRoot: overrides.contentRoot ?? path,
    inboxPath: "00_Inbox",
    metadataPath: "06_Metadata/memory-loop",
    attachmentPath: "05_Attachments",
    setupComplete: false,
    promptsPerGeneration: 5,
    maxPoolSize: 50,
    quotesPerWeek: 1,
    badges: [],
    order: 999999,
    cardsEnabled: true,
    viMode: false,
    ...overrides,
  };
}

interface MockWebSocket {
  send: ReturnType<typeof mock>;
  readyState: number;
  messages: string[];
  close: ReturnType<typeof mock>;
  getLastMessage(): ServerMessage | null;
  getMessages(): ServerMessage[];
}

function createMockWebSocket(options?: { initialReadyState?: number }): MockWebSocket {
  const messages: string[] = [];
  return {
    send: mock((data: string) => messages.push(data)),
    readyState: options?.initialReadyState ?? 1,
    messages,
    close: mock(() => {}),
    getLastMessage(): ServerMessage | null {
      const last = messages[messages.length - 1];
      return last ? (JSON.parse(last) as ServerMessage) : null;
    },
    getMessages(): ServerMessage[] {
      return messages.map((m) => JSON.parse(m) as ServerMessage);
    },
  };
}

// Type-safe WebSocket parameter helper
type WsParam = Parameters<WebSocketHandler["onMessage"]>[0];
function asWs(ws: MockWebSocket): WsParam {
  return ws as unknown as WsParam;
}

/** Helper to select a vault in a test */
async function selectVault(handler: WebSocketHandler, ws: MockWebSocket, vaultId = "test-vault"): Promise<void> {
  await handler.onMessage(asWs(ws), JSON.stringify({ type: "select_vault", vaultId }));
}

/** Helper to send a discussion message */
async function sendDiscussion(handler: WebSocketHandler, ws: MockWebSocket, text: string): Promise<void> {
  await handler.onMessage(asWs(ws), JSON.stringify({ type: "discussion_message", text }));
}

/** Setup a vault and mock for testing */
function setupVaultMock(vault: VaultInfo = createMockVault()): VaultInfo {
  mockGetVaultById.mockResolvedValue(vault);
  return vault;
}

/** Creates a mock session with custom events */
function createMockSessionResult(options: {
  sessionId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events?: AsyncGenerator<any>;
  interrupt?: ReturnType<typeof mock>;
}): { sessionId: string; events: AsyncGenerator<unknown>; interrupt: () => Promise<void>; supportedCommands?: typeof mockSupportedCommands } {
  return {
    sessionId: options.sessionId ?? "test-session",
    events: options.events ?? (async function* () {})(),
    interrupt: options.interrupt ?? mockInterrupt,
    supportedCommands: mockSupportedCommands,
  };
}

function resetAllMocks(): void {
  mockDiscoverVaults.mockReset();
  mockGetVaultById.mockReset();
  mockCreateVault.mockReset();
  mockCreateSession.mockReset();
  mockResumeSession.mockReset();
  mockLoadSession.mockReset();
  mockAppendMessage.mockReset();
  mockLoadSlashCommands.mockReset();
  mockSaveSlashCommands.mockReset();
  mockRunVaultSetup.mockReset();
  mockSupportedCommands.mockReset();

  // Set default implementations
  mockDiscoverVaults.mockResolvedValue([]);
  mockGetVaultById.mockResolvedValue(null);
  mockCreateVault.mockImplementation((title: string) =>
    Promise.resolve(createMockVault({ id: title.toLowerCase().replace(/\s+/g, "-"), name: title }))
  );
  mockLoadSession.mockResolvedValue(null);
  mockAppendMessage.mockResolvedValue();
}

// =============================================================================
// Test Suites
// =============================================================================

describe("WebSocket Handler", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `ws-handler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    resetAllMocks();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe("createConnectionState", () => {
    test("creates state with null values", () => {
      const state = createConnectionState();
      expect(state.currentVault).toBeNull();
      expect(state.currentSessionId).toBeNull();
      expect(state.activeQuery).toBeNull();
      expect(state.searchIndex).toBeNull();
    });
  });

  describe("createWebSocketHandler", () => {
    test("creates a new WebSocketHandler instance", () => {
      const handler = createTestHandler();
      expect(handler).toBeInstanceOf(WebSocketHandler);
    });
  });

  describe("generateMessageId", () => {
    test("generates unique IDs with msg_ prefix", () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      expect(id1).not.toBe(id2);
      expect(id1.startsWith("msg_")).toBe(true);
    });
  });

  // ===========================================================================
  // Connection Lifecycle Tests
  // ===========================================================================

  describe("onOpen", () => {
    test("sends vault_list message", async () => {
      const vaults = [createMockVault({ id: "vault-1", name: "Vault 1" })];
      mockDiscoverVaults.mockResolvedValue(vaults);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onOpen(asWs(ws));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("vault_list");
      if (message?.type === "vault_list") {
        expect(message.vaults).toHaveLength(1);
        expect(message.vaults[0].id).toBe("vault-1");
      }
    });

    test("sends error if vault discovery fails", async () => {
      mockDiscoverVaults.mockRejectedValue(new Error("Discovery failed"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onOpen(asWs(ws));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toContain("Discovery failed");
      }
    });
  });

  describe("onClose", () => {
    test("clears connection state", async () => {
      const handler = createTestHandler();
      setupVaultMock();

      const ws = createMockWebSocket();
      await selectVault(handler, ws);
      await handler.onClose();

      const state = handler.getState();
      expect(state.currentVault).toBeNull();
      expect(state.currentSessionId).toBeNull();
      expect(state.activeQuery).toBeNull();
    });

    test("interrupts active query on close", async () => {
      setupVaultMock();

      const fastGenerator = (async function* () {
        yield { type: "system", session_id: "test" };
      })();

      const localInterrupt = mock(() => Promise.resolve());

      mockCreateSession.mockResolvedValue(createMockSessionResult({
        sessionId: "test-session",
        events: fastGenerator,
        interrupt: localInterrupt,
      }));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Hello");

      // Set up slow generator for the next message
      let shouldStop = false;
      const slowGenerator = (async function* () {
        yield { type: "system", session_id: "slow-test" };
        while (!shouldStop) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })();

      const slowInterrupt = mock(() => {
        shouldStop = true;
        return Promise.resolve();
      });

      mockResumeSession.mockResolvedValue(createMockSessionResult({
        sessionId: "test-session",
        events: slowGenerator,
        interrupt: slowInterrupt,
      }));

      const discussionPromise = sendDiscussion(handler, ws, "Another message");
      await new Promise((resolve) => setTimeout(resolve, 10));

      await handler.onClose();
      expect(slowInterrupt).toHaveBeenCalled();
      await discussionPromise;
    });
  });

  // ===========================================================================
  // Message Parsing Tests
  // ===========================================================================

  describe("onMessage - parsing", () => {
    test("handles string data", async () => {
      mockDiscoverVaults.mockResolvedValue([]);
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "ping" }));
      expect(ws.getLastMessage()?.type).toBe("pong");
    });

    test("handles ArrayBuffer data", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      const data = new TextEncoder().encode(JSON.stringify({ type: "ping" }));
      await handler.onMessage(asWs(ws), data.buffer);
      expect(ws.getLastMessage()?.type).toBe("pong");
    });

    test("sends error for invalid JSON", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), "not valid json");

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
        expect(message.message).toContain("Invalid JSON");
      }
    });

    test("sends error for invalid message structure", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "unknown_type" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });

    test("sends error for missing required fields", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "select_vault" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  // ===========================================================================
  // select_vault Handler Tests
  // ===========================================================================

  describe("select_vault", () => {
    test("selects vault and sends session_ready", async () => {
      setupVaultMock();
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);

      const message = ws.getLastMessage();
      expect(message?.type).toBe("session_ready");
      if (message?.type === "session_ready") {
        expect(message.vaultId).toBe("test-vault");
      }

      const state = handler.getState();
      expect(state.currentVault?.id).toBe("test-vault");
    });

    test("sends error for non-existent vault", async () => {
      mockGetVaultById.mockResolvedValue(null);
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "select_vault", vaultId: "non-existent" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
      }
    });

    test("clears previous session when selecting new vault", async () => {
      const vault1 = createMockVault({ id: "vault-1" });
      const vault2 = createMockVault({ id: "vault-2" });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      mockGetVaultById.mockResolvedValue(vault1);
      await selectVault(handler, ws, "vault-1");

      mockCreateSession.mockResolvedValue(createMockSessionResult({ sessionId: "session-1" }));
      await sendDiscussion(handler, ws, "Hello");

      mockGetVaultById.mockResolvedValue(vault2);
      await selectVault(handler, ws, "vault-2");

      const state = handler.getState();
      expect(state.currentSessionId).toBeNull();
      expect(state.currentVault?.id).toBe("vault-2");
    });
  });

  // ===========================================================================
  // discussion_message Handler Tests
  // ===========================================================================

  describe("discussion_message", () => {
    test("creates new session and streams response", async () => {
      setupVaultMock();

      const events = [
        { type: "system", subtype: "init", session_id: "new-session" },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Hello there!" },
          },
        },
      ];

      mockCreateSession.mockResolvedValue({
        sessionId: "new-session",
        events: (async function* () {
          for (const event of events) yield event;
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Hi Claude");

      const messages = ws.getMessages();
      expect(messages.some((m) => m.type === "response_start")).toBe(true);
      expect(messages.some((m) => m.type === "response_chunk")).toBe(true);
      expect(messages.some((m) => m.type === "response_end")).toBe(true);

      const state = handler.getState();
      expect(state.currentSessionId).toBe("new-session");
    });

    test("resumes existing session", async () => {
      const vault = setupVaultMock();

      mockCreateSession.mockResolvedValue(createMockSessionResult({ sessionId: "first-session" }));
      mockResumeSession.mockResolvedValue(createMockSessionResult({ sessionId: "first-session" }));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "First message");
      await sendDiscussion(handler, ws, "Second message");

      expect(mockResumeSession).toHaveBeenCalledWith(
        vault.path,
        "first-session",
        "Second message",
        undefined,
        expect.any(Function),
        expect.any(Function)
      );
    });

    test("sends error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await sendDiscussion(handler, ws, "Hello");

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
      }
    });

    test("streams tool events", async () => {
      setupVaultMock();

      const events = [
        { type: "system", session_id: "tool-session" },
        {
          type: "result",
          session_id: "tool-session",
          result: {
            content: [
              { type: "tool_use", name: "read_file", id: "tool-123", input: { path: "/test.md" } },
            ],
          },
        },
        {
          type: "result",
          session_id: "tool-session",
          result: {
            content: [
              { type: "tool_result", tool_use_id: "tool-123", content: "File content here" },
            ],
          },
        },
      ];

      mockCreateSession.mockResolvedValue({
        sessionId: "tool-session",
        events: (async function* () {
          for (const event of events) yield event;
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Read a file");

      const messages = ws.getMessages();

      const toolStart = messages.find((m) => m.type === "tool_start");
      const toolInput = messages.find((m) => m.type === "tool_input");
      const toolEnd = messages.find((m) => m.type === "tool_end");

      expect(toolStart).toBeDefined();
      expect(toolInput).toBeDefined();
      expect(toolEnd).toBeDefined();

      if (toolStart?.type === "tool_start") {
        expect(toolStart.toolName).toBe("read_file");
        expect(toolStart.toolUseId).toBe("tool-123");
      }

      // Verify tool invocations are persisted
      const appendCalls = mockAppendMessage.mock.calls as Array<
        [string, string, { role: string; toolInvocations?: Array<{ toolUseId: string; toolName: string; input?: unknown; output?: unknown; status: string }> }]
      >;
      const assistantMessageCall = appendCalls.find((call) => call[2]?.role === "assistant");
      expect(assistantMessageCall).toBeDefined();
      const assistantMessage = assistantMessageCall![2];
      expect(assistantMessage.toolInvocations).toHaveLength(1);
      expect(assistantMessage.toolInvocations![0]).toEqual({
        toolUseId: "tool-123",
        toolName: "read_file",
        input: { path: "/test.md" },
        output: "File content here",
        status: "complete",
      });
    });

    test("sends tool_end when SDK emits user event with tool_result", async () => {
      setupVaultMock();

      const events = [
        { type: "system", session_id: "user-event-session" },
        {
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "tool-user-evt", name: "read_file" },
          },
        },
        {
          type: "user",
          session_id: "user-event-session",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "tool-user-evt", content: "Result from user event" },
            ],
          },
        },
      ];

      mockCreateSession.mockResolvedValue({
        sessionId: "user-event-session",
        events: (async function* () {
          for (const event of events) yield event;
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Read a file");

      const messages = ws.getMessages();

      const toolStart = messages.find((m) => m.type === "tool_start");
      expect(toolStart).toBeDefined();
      if (toolStart?.type === "tool_start") {
        expect(toolStart.toolName).toBe("read_file");
        expect(toolStart.toolUseId).toBe("tool-user-evt");
      }

      const toolEnd = messages.find((m) => m.type === "tool_end");
      expect(toolEnd).toBeDefined();
      if (toolEnd?.type === "tool_end") {
        expect(toolEnd.toolUseId).toBe("tool-user-evt");
        expect(toolEnd.output).toBe("Result from user event");
      }
    });

    test("marks running tools as complete when connection closes mid-stream", async () => {
      setupVaultMock();
      const ws = createMockWebSocket();

      mockCreateSession.mockResolvedValueOnce({
        sessionId: "test-session-id",
        events: (async function* () {
          yield { type: "system", session_id: "test-session-id" };
          yield {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tool-interrupted", name: "read_file" },
            },
          };
          (ws as { readyState: number }).readyState = 3; // CLOSED
          yield {
            type: "result",
            result: {
              content: [{ type: "tool_result", tool_use_id: "tool-interrupted", content: "File content" }],
            },
          };
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Read a file");

      const messages = ws.getMessages();
      expect(messages.find((m) => m.type === "tool_start")).toBeDefined();
      expect(messages.find((m) => m.type === "tool_end")).toBeUndefined();

      const appendCalls = mockAppendMessage.mock.calls as Array<
        [string, string, { role: string; toolInvocations?: Array<{ toolUseId: string; status: string; output?: unknown }> }]
      >;
      const assistantMessageCall = appendCalls.find((call) => call[2]?.role === "assistant");
      expect(assistantMessageCall).toBeDefined();
      const assistantMessage = assistantMessageCall![2];
      expect(assistantMessage.toolInvocations![0].status).toBe("complete");
      expect(assistantMessage.toolInvocations![0].output).toBe("[Connection closed before tool completed]");
    });

    test("aborts previous query when new message arrives", async () => {
      setupVaultMock();

      const firstInterrupt = mock(() => Promise.resolve());
      mockCreateSession.mockResolvedValueOnce({
        sessionId: "slow-session",
        events: (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          yield { type: "system", session_id: "slow-session" };
        })(),
        interrupt: firstInterrupt,
      });

      mockCreateSession.mockResolvedValueOnce(createMockSessionResult({ sessionId: "fast-session" }));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);

      const firstPromise = sendDiscussion(handler, ws, "First");
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockResumeSession.mockResolvedValue(createMockSessionResult({ sessionId: "slow-session" }));
      await sendDiscussion(handler, ws, "Second");

      expect(firstInterrupt).toHaveBeenCalled();
      await firstPromise;
    });

    test("surfaces SDK stream error events to frontend", async () => {
      setupVaultMock();

      const events = [
        { type: "system", subtype: "init", session_id: "error-session" },
        {
          type: "stream_event",
          event: {
            type: "error",
            error: { type: "invalid_request_error", message: "Unknown slash command: /nonexistent" },
          },
        },
      ];

      mockCreateSession.mockResolvedValue({
        sessionId: "error-session",
        events: (async function* () {
          for (const event of events) yield event;
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "/nonexistent");

      const messages = ws.getMessages();
      const errorMessage = messages.find((m) => m.type === "error" && m.code === "SDK_ERROR");
      expect(errorMessage).toBeDefined();
      if (errorMessage?.type === "error") {
        expect(errorMessage.message).toBe("Unknown slash command: /nonexistent");
      }
    });

    test("surfaces SDK stream error with missing message field", async () => {
      setupVaultMock();

      mockCreateSession.mockResolvedValue({
        sessionId: "error-session",
        events: (async function* () {
          yield { type: "system", subtype: "init", session_id: "error-session" };
          yield { type: "stream_event", event: { type: "error", error: { type: "rate_limit_error" } } };
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Hello");

      const messages = ws.getMessages();
      const errorMessage = messages.find((m) => m.type === "error" && m.code === "SDK_ERROR");
      expect(errorMessage).toBeDefined();
      if (errorMessage?.type === "error") {
        expect(errorMessage.message).toBe("rate_limit_error");
      }
    });

    test("surfaces SDK result error events to frontend", async () => {
      setupVaultMock();

      mockCreateSession.mockResolvedValue({
        sessionId: "error-session",
        events: (async function* () {
          yield { type: "system", subtype: "init", session_id: "error-session" };
          yield {
            type: "result",
            subtype: "error_during_execution",
            errors: ["Tool execution failed: Permission denied"],
            is_error: true,
          };
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Run something");

      const messages = ws.getMessages();
      const errorMessage = messages.find((m) => m.type === "error" && m.code === "SDK_ERROR");
      expect(errorMessage).toBeDefined();
      if (errorMessage?.type === "error") {
        expect(errorMessage.message).toBe("Tool execution failed: Permission denied");
      }
    });

    test("surfaces SDK max_turns error to frontend", async () => {
      setupVaultMock();

      mockCreateSession.mockResolvedValue({
        sessionId: "error-session",
        events: (async function* () {
          yield { type: "system", subtype: "init", session_id: "error-session" };
          yield { type: "result", subtype: "error_max_turns", is_error: true };
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Long conversation");

      const messages = ws.getMessages();
      const errorMessage = messages.find((m) => m.type === "error" && m.code === "SDK_ERROR");
      expect(errorMessage).toBeDefined();
      if (errorMessage?.type === "error") {
        expect(errorMessage.message).toBe("Conversation reached maximum turns limit.");
      }
    });
  });

  // ===========================================================================
  // Slash Command Fetching Tests
  // ===========================================================================

  describe("slash command fetching", () => {
    test("includes slash commands in session_ready when SDK returns commands", async () => {
      setupVaultMock();

      const sdkCommands = [
        { name: "commit", description: "Create a commit", argumentHint: "message" },
        { name: "/review", description: "Review code" },
      ];
      mockSupportedCommands.mockResolvedValue(sdkCommands);

      mockCreateSession.mockResolvedValue({
        sessionId: "new-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
        supportedCommands: mockSupportedCommands,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Hello");

      const messages = ws.getMessages();
      const sessionReadyWithCommands = messages.find(
        (m) => m.type === "session_ready" && "slashCommands" in m && m.slashCommands
      );

      expect(sessionReadyWithCommands).toBeDefined();
      if (sessionReadyWithCommands?.type === "session_ready" && sessionReadyWithCommands.slashCommands) {
        expect(sessionReadyWithCommands.slashCommands).toHaveLength(2);
        expect(sessionReadyWithCommands.slashCommands[0].name).toBe("/commit");
        expect(sessionReadyWithCommands.slashCommands[1].name).toBe("/review");
      }
    });

    test("handles empty slash commands array without error", async () => {
      setupVaultMock();
      mockSupportedCommands.mockResolvedValue([]);

      mockCreateSession.mockResolvedValue({
        sessionId: "new-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
        supportedCommands: mockSupportedCommands,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Hello");

      const messages = ws.getMessages();
      expect(messages.some((m) => m.type === "response_end")).toBe(true);

      const sessionReadyAfterDiscussion = messages.find((m, i) => m.type === "session_ready" && i > 0);
      expect(sessionReadyAfterDiscussion).toBeDefined();
      if (sessionReadyAfterDiscussion?.type === "session_ready") {
        expect(sessionReadyAfterDiscussion.slashCommands).toBeUndefined();
      }
    });

    test("continues without commands when SDK throws error", async () => {
      setupVaultMock();
      mockSupportedCommands.mockRejectedValue(new Error("SDK not available"));

      mockCreateSession.mockResolvedValue({
        sessionId: "new-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
        supportedCommands: mockSupportedCommands,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Hello");

      const messages = ws.getMessages();
      expect(messages.some((m) => m.type === "response_end")).toBe(true);
      expect(messages.every((m) => m.type !== "error")).toBe(true);
    });

    test("does not re-fetch commands on session resume", async () => {
      setupVaultMock();
      mockSupportedCommands.mockClear();

      mockLoadSession.mockResolvedValue({
        id: "existing-session",
        vaultId: "test-vault",
        vaultPath: "/tmp/test-vault",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messages: [{ id: "1", role: "user", content: "Hi", timestamp: new Date().toISOString() }],
      });

      mockSupportedCommands.mockResolvedValue([{ name: "test", description: "Test command" }]);
      mockResumeSession.mockResolvedValue({
        sessionId: "existing-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
        supportedCommands: mockSupportedCommands,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "resume_session", sessionId: "existing-session" }));
      await sendDiscussion(handler, ws, "Continue chat");

      expect(mockSupportedCommands).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // resume_session Handler Tests
  // ===========================================================================

  describe("resume_session", () => {
    test("sets session ID and sends session_ready when session exists", async () => {
      setupVaultMock();
      mockLoadSession.mockResolvedValue({
        id: "old-session-123",
        vaultId: "test-vault",
        vaultPath: "/tmp/test-vault",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messages: [],
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await handler.onMessage(asWs(ws), JSON.stringify({ type: "resume_session", sessionId: "old-session-123" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("session_ready");
      if (message?.type === "session_ready") {
        expect(message.sessionId).toBe("old-session-123");
        expect(message.vaultId).toBe("test-vault");
      }

      expect(handler.getState().currentSessionId).toBe("old-session-123");
    });

    test("sends error if session not found", async () => {
      setupVaultMock();
      mockLoadSession.mockResolvedValue(null);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await handler.onMessage(asWs(ws), JSON.stringify({ type: "resume_session", sessionId: "nonexistent" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("SESSION_NOT_FOUND");
      }
    });

    test("sends error if session belongs to different vault", async () => {
      setupVaultMock();
      mockLoadSession.mockResolvedValue({
        id: "other-session",
        vaultId: "other-vault",
        vaultPath: "/tmp/other-vault",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messages: [],
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await handler.onMessage(asWs(ws), JSON.stringify({ type: "resume_session", sessionId: "other-session" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("SESSION_INVALID");
      }
    });

    test("sends error when no vault pre-selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "resume_session", sessionId: "session-123" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toBe("Please select a vault first");
      }
    });

    test("sends error if session vault no longer exists", async () => {
      mockLoadSession.mockResolvedValue({
        id: "session-123",
        vaultId: "deleted-vault",
        vaultPath: "/tmp/deleted-vault",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messages: [],
      });
      mockGetVaultById.mockResolvedValue(null);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "resume_session", sessionId: "session-123" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
      }
    });

    test("sends error if loadSession throws an exception", async () => {
      setupVaultMock();
      mockLoadSession.mockRejectedValue(new Error("Storage read failed"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await handler.onMessage(asWs(ws), JSON.stringify({ type: "resume_session", sessionId: "corrupted-session" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("SESSION_NOT_FOUND");
        expect(message.message).toBe("Failed to load session");
      }
    });
  });

  // ===========================================================================
  // new_session Handler Tests
  // ===========================================================================

  describe("new_session", () => {
    test("clears session ID and sends session_ready", async () => {
      setupVaultMock();
      mockCreateSession.mockResolvedValue(createMockSessionResult({ sessionId: "session-to-clear" }));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Hello");
      await handler.onMessage(asWs(ws), JSON.stringify({ type: "new_session" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("session_ready");
      if (message?.type === "session_ready") {
        expect(message.sessionId).toBe("");
        expect(message.vaultId).toBe("test-vault");
      }

      expect(handler.getState().currentSessionId).toBeNull();
    });

    test("sends error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "new_session" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
      }
    });

    test("interrupts active query", async () => {
      setupVaultMock();

      const activeInterrupt = mock(() => Promise.resolve());
      mockCreateSession.mockResolvedValue({
        sessionId: "active-session",
        events: (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        })(),
        interrupt: activeInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      const discussionPromise = sendDiscussion(handler, ws, "Hello");
      await new Promise((resolve) => setTimeout(resolve, 10));

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "new_session" }));
      expect(activeInterrupt).toHaveBeenCalled();
      await discussionPromise;
    });

    test("includes cached slash commands in response", async () => {
      setupVaultMock();

      const cachedCommands = [
        { name: "/recall", description: "Search vault" },
        { name: "/tasks", description: "List tasks" },
      ];
      mockLoadSlashCommands.mockResolvedValue(cachedCommands);
      mockCreateSession.mockResolvedValue(createMockSessionResult({ sessionId: "session-to-clear" }));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Hello");
      await handler.onMessage(asWs(ws), JSON.stringify({ type: "new_session" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("session_ready");
      if (message?.type === "session_ready") {
        expect(message.slashCommands).toEqual(cachedCommands);
      }
    });
  });

  // ===========================================================================
  // abort Handler Tests
  // ===========================================================================

  describe("abort", () => {
    test("interrupts active query", async () => {
      setupVaultMock();

      const activeInterrupt = mock(() => Promise.resolve());
      mockCreateSession.mockResolvedValue({
        sessionId: "active-session",
        events: (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        })(),
        interrupt: activeInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      const discussionPromise = sendDiscussion(handler, ws, "Hello");
      await new Promise((resolve) => setTimeout(resolve, 10));

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "abort" }));
      expect(activeInterrupt).toHaveBeenCalled();
      await discussionPromise;
    });

    test("does nothing if no active query", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "abort" }));
      expect(ws.messages).toHaveLength(0);
    });
  });

  // ===========================================================================
  // ping/pong Handler Tests
  // ===========================================================================

  describe("ping", () => {
    test("responds with pong", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "ping" }));
      expect(ws.getLastMessage()?.type).toBe("pong");
    });
  });

  // ===========================================================================
  // State Management Tests
  // ===========================================================================

  describe("State Management", () => {
    test("maintains isolation between handlers", async () => {
      setupVaultMock();

      const handler1 = createTestHandler();
      const handler2 = createTestHandler();
      const ws1 = createMockWebSocket();

      await selectVault(handler1, ws1);

      expect(handler1.getState().currentVault?.id).toBe("test-vault");
      expect(handler2.getState().currentVault).toBeNull();
    });

    test("preserves vault across multiple messages", async () => {
      const vault = setupVaultMock();

      let sessionCreateCount = 0;
      mockCreateSession.mockImplementation(async () => {
        sessionCreateCount++;
        return {
          sessionId: `test-session-${sessionCreateCount}`,
          events: (async function* () {
            yield { type: "result", subtype: "success" };
          })(),
          interrupt: mockInterrupt,
          supportedCommands: mockSupportedCommands,
        };
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      expect(handler.getState().currentVault?.id).toBe("test-vault");

      await sendDiscussion(handler, ws, "Hello");
      expect(handler.getState().currentVault?.id).toBe("test-vault");

      expect(mockCreateSession).toHaveBeenCalled();
      const callArgs = mockCreateSession.mock.calls[0];
      expect(callArgs?.[0]).toBe(vault);
      expect(callArgs?.[1]).toBe("Hello");
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe("Error Handling", () => {
    test("handles SDK errors gracefully", async () => {
      setupVaultMock();

      const { SessionError } = await import("../session-manager");
      mockCreateSession.mockRejectedValue(new SessionError("SDK unavailable", "SDK_ERROR"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Hello");

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("SDK_ERROR");
      }
    });

    test("handles unexpected errors", async () => {
      setupVaultMock();
      mockCreateSession.mockRejectedValue(new Error("Unexpected failure"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      await sendDiscussion(handler, ws, "Hello");

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("SDK_ERROR");
        expect(message.message).toContain("Unexpected failure");
      }
    });
  });

  // ===========================================================================
  // Create Vault Handler Tests
  // ===========================================================================

  describe("create_vault handler", () => {
    test("creates vault and returns vault_created message on success", async () => {
      const createdVault = createMockVault({
        id: "my-new-vault",
        name: "My New Vault",
        hasClaudeMd: true,
        setupComplete: true,
      });
      mockCreateVault.mockResolvedValue(createdVault);
      mockRunVaultSetup.mockResolvedValue({ success: true, summary: ["Installed commands", "Created directories"] });
      mockGetVaultById.mockResolvedValue({ ...createdVault, setupComplete: true });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "create_vault", title: "My New Vault" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("vault_created");
      if (message?.type === "vault_created") {
        expect(message.vault.id).toBe("my-new-vault");
        expect(message.vault.name).toBe("My New Vault");
        expect(message.vault.setupComplete).toBe(true);
      }

      expect(mockCreateVault).toHaveBeenCalledWith("My New Vault");
      expect(mockRunVaultSetup).toHaveBeenCalledWith("my-new-vault");
    });

    test("returns vault_created even when setup has issues", async () => {
      const createdVault = createMockVault({ id: "my-vault", name: "My Vault" });
      mockCreateVault.mockResolvedValue(createdVault);
      mockRunVaultSetup.mockRejectedValue(new Error("Setup failed"));
      mockGetVaultById.mockResolvedValue(createdVault);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "create_vault", title: "My Vault" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("vault_created");
      if (message?.type === "vault_created") {
        expect(message.vault.id).toBe("my-vault");
      }
    });

    test("returns original vault when re-fetch fails", async () => {
      const createdVault = createMockVault({ id: "my-vault", name: "My Vault", setupComplete: false });
      mockCreateVault.mockResolvedValue(createdVault);
      mockRunVaultSetup.mockResolvedValue({ success: true, summary: [] });
      mockGetVaultById.mockResolvedValue(null);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "create_vault", title: "My Vault" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("vault_created");
      if (message?.type === "vault_created") {
        expect(message.vault.id).toBe("my-vault");
        expect(message.vault.setupComplete).toBe(false);
      }
    });

    test("returns VALIDATION_ERROR when VaultCreationError is thrown", async () => {
      mockCreateVault.mockRejectedValue(new VaultCreationError("Vault already exists"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "create_vault", title: "Existing Vault" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
        expect(message.message).toBe("Vault already exists");
      }
    });

    test("returns INTERNAL_ERROR when unexpected error is thrown", async () => {
      mockCreateVault.mockRejectedValue(new Error("Unexpected filesystem error"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "create_vault", title: "My Vault" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toBe("Unexpected filesystem error");
      }
    });

    test("validates title is required", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "create_vault" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });

    test("validates title cannot be empty", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "create_vault", title: "" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  // ===========================================================================
  // Cumulative Context Usage Tests
  // ===========================================================================

  describe("cumulative context usage tracking", () => {
    test("createConnectionState initializes cumulative tokens to 0", () => {
      const state = createConnectionState();
      expect(state.cumulativeTokens).toBe(0);
      expect(state.contextWindow).toBeNull();
    });

    test("getState returns cumulative token values", () => {
      const handler = createTestHandler();
      const state = handler.getState();
      expect(state.cumulativeTokens).toBe(0);
      expect(state.contextWindow).toBeNull();
    });
  });
});

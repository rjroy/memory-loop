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
import type { VaultInfo, ServerMessage, SlashCommand, EditableVaultConfig } from "@memory-loop/shared";
import type { SessionMetadata, ConversationMessage } from "../session-manager";
import type { VaultConfig } from "../vault-config";
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
// Mock Setup (injected via DI)
// =============================================================================

// Mock vault manager functions
const mockDiscoverVaults = mock<() => Promise<VaultInfo[]>>(() =>
  Promise.resolve([])
);
const mockGetVaultById = mock<(id: string) => Promise<VaultInfo | null>>(() =>
  Promise.resolve(null)
);
const mockCreateVault = mock<(title: string) => Promise<VaultInfo>>(() =>
  Promise.resolve(createMockVault())
);

// Mock session manager functions
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

const mockDeleteSession = mock<(vaultPath: string, sessionId: string) => Promise<boolean>>(() =>
  Promise.resolve(true)
);

// Mock vault config functions
const mockLoadVaultConfig = mock<(vaultPath: string) => Promise<VaultConfig>>(() =>
  Promise.resolve({})
);

const mockLoadSlashCommands = mock<(vaultPath: string) => Promise<SlashCommand[] | undefined>>(() =>
  Promise.resolve(undefined)
);

const mockSaveSlashCommands = mock<(vaultPath: string, commands: SlashCommand[]) => Promise<void>>(() =>
  Promise.resolve()
);

const mockSavePinnedAssets = mock<(vaultPath: string, paths: string[]) => Promise<void>>(() =>
  Promise.resolve()
);

const mockSaveVaultConfig = mock<
  (vaultPath: string, config: EditableVaultConfig) => Promise<{ success: true } | { success: false; error: string }>
>(() => Promise.resolve({ success: true }));

// Mock vault setup
const mockRunVaultSetup = mock<(vaultId: string) => Promise<SetupResult>>(() =>
  Promise.resolve({
    success: true,
    summary: ["Installed 6 commands", "Created 4 directories", "CLAUDE.md updated"],
  })
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetRecentSessions = mock<(...args: any[]) => Promise<any[]>>(() =>
  Promise.resolve([])
);

// =============================================================================
// Handler Dependencies Mocks (injected via DI, no mock.module needed)
// =============================================================================

// Note capture mocks
const mockCaptureToDaily = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<{
    success: boolean;
    timestamp: string;
    notePath?: string;
    error?: string;
  }>
>(() =>
  Promise.resolve({
    success: true,
    timestamp: "2025-01-01T12:00:00.000Z",
    notePath: "",
  })
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetRecentNotes = mock<(...args: any[]) => Promise<any[]>>(() =>
  Promise.resolve([])
);

// File browser mocks
const mockListDirectory = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<Array<{ name: string; type: string; path: string }>>
>(() => Promise.resolve([]));

const mockReadMarkdownFile = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<{ content: string; truncated: boolean }>
>(() => Promise.resolve({ content: "", truncated: false }));

const mockWriteMarkdownFile = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<void>
>(() => Promise.resolve());

const mockDeleteFile = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<void>
>(() => Promise.resolve());

// UNUSED: Tests migrated to REST API
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockArchiveFile = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<{ originalPath: string; archivePath: string }>
>(() => Promise.resolve({ originalPath: "", archivePath: "04_Archive/archived-dir" }));

// Note: MockFileBrowserError removed - no longer needed after REST API migration

// Inspiration manager mock
const mockGetInspiration = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<{
    contextual: { text: string; attribution?: string } | null;
    quote: { text: string; attribution?: string };
  }>
>(() =>
  Promise.resolve({
    contextual: null,
    quote: { text: "Default quote", attribution: "Test" },
  })
);

// Task manager mocks
const mockGetAllTasks = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<{
    tasks: Array<{
      text: string;
      state: string;
      filePath: string;
      lineNumber: number;
    }>;
    incomplete: number;
    total: number;
  }>
>(() =>
  Promise.resolve({
    tasks: [],
    incomplete: 0,
    total: 0,
  })
);

const mockToggleTask = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<{
    success: boolean;
    newState?: string;
    error?: string;
  }>
>(() =>
  Promise.resolve({
    success: true,
    newState: "x",
  })
);

/**
 * Creates the mock dependencies for WebSocketHandler.
 *
 * After REST API migration, the WebSocket handler only needs dependencies for:
 * - Vault discovery and creation
 * - Session management (AI conversation)
 * - Slash commands caching
 */
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

/**
 * Test helper: creates a WebSocketHandler with mock dependencies.
 */
function createTestHandler(): WebSocketHandler {
  return createWebSocketHandler(createMockDeps());
}

// =============================================================================
// Search Index Mocks (set directly on connection state)
// =============================================================================

const mockSearchFiles = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<Array<{
    path: string;
    name: string;
    score: number;
    matchPositions: number[];
  }>>
>(() => Promise.resolve([]));

const mockSearchContent = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<Array<{
    path: string;
    name: string;
    matchCount: number;
  }>>
>(() => Promise.resolve([]));

const mockGetSnippets = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<Array<{
    lineNumber: number;
    line: string;
    contextBefore: string[];
    contextAfter: string[];
  }>>
>(() => Promise.resolve([]));

/**
 * Mock SearchIndexManager for tests.
 * Instances are set directly on connection state.
 * UNUSED: Search tests migrated to REST API
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class MockSearchIndexManager {
  private contentRoot: string;

  constructor(contentRoot: string) {
    this.contentRoot = contentRoot;
  }

  getContentRoot(): string {
    return this.contentRoot;
  }

  searchFiles = mockSearchFiles;
  searchContent = mockSearchContent;
  getSnippets = mockGetSnippets;
}

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Creates a mock VaultInfo object.
 */
function createMockVault(overrides: Partial<VaultInfo> = {}): VaultInfo {
  const path = overrides.path ?? "/tmp/test-vault";
  const contentRoot = overrides.contentRoot ?? path;
  return {
    id: "test-vault",
    name: "Test Vault",
    path,
    hasClaudeMd: true,
    contentRoot,
    inboxPath: "00_Inbox",
    metadataPath: "06_Metadata/memory-loop",
    attachmentPath: "05_Attachments",
    setupComplete: false,
    promptsPerGeneration: 5,
    maxPoolSize: 50,
    quotesPerWeek: 1,
    badges: [],
    ...overrides,
    order: overrides.order ?? 999999,
  };
}

/**
 * Creates a mock WebSocket for testing.
 * @param options.initialReadyState - Initial readyState (default: 1 = OPEN)
 */
function createMockWebSocket(options?: { initialReadyState?: number }) {
  const messages: string[] = [];

  return {
    send: mock((data: string) => {
      messages.push(data);
    }),
    readyState: options?.initialReadyState ?? 1, // OPEN by default, mutable for testing
    messages,
    getLastMessage(): ServerMessage | null {
      const last = messages[messages.length - 1];
      return last ? (JSON.parse(last) as ServerMessage) : null;
    },
    getMessages(): ServerMessage[] {
      return messages.map((m) => JSON.parse(m) as ServerMessage);
    },
    close: mock(() => {}),
  };
}

// =============================================================================
// Test Suites
// =============================================================================

describe("WebSocket Handler", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create unique test directory
    testDir = join(
      tmpdir(),
      `ws-handler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    // Reset all mocks
    mockDiscoverVaults.mockReset();
    mockGetVaultById.mockReset();
    mockCreateVault.mockReset();
    mockCreateSession.mockReset();
    mockResumeSession.mockReset();
    mockLoadSession.mockReset();
    mockAppendMessage.mockReset();
    mockDeleteSession.mockReset();
    mockLoadSlashCommands.mockReset();
    mockSaveSlashCommands.mockReset();
    mockSavePinnedAssets.mockReset();
    mockRunVaultSetup.mockReset();
    mockSupportedCommands.mockReset();
    mockCaptureToDaily.mockReset();
    mockGetRecentNotes.mockReset();
    mockGetRecentSessions.mockReset();
    mockListDirectory.mockReset();
    mockReadMarkdownFile.mockReset();
    mockWriteMarkdownFile.mockReset();
    mockDeleteFile.mockReset();
    mockGetInspiration.mockReset();
    mockGetAllTasks.mockReset();
    mockToggleTask.mockReset();
    mockLoadVaultConfig.mockReset();
    mockSaveVaultConfig.mockReset();
    mockSearchFiles.mockReset();
    mockSearchContent.mockReset();
    mockGetSnippets.mockReset();

    // Set default mock implementations
    mockDiscoverVaults.mockResolvedValue([]);
    mockGetVaultById.mockResolvedValue(null);
    mockCreateVault.mockImplementation((title: string) =>
      Promise.resolve(createMockVault({ id: title.toLowerCase().replace(/\s+/g, "-"), name: title }))
    );
    mockLoadSession.mockResolvedValue(null);
    mockAppendMessage.mockResolvedValue();
    mockCaptureToDaily.mockResolvedValue({
      success: true,
      timestamp: "2025-01-01T12:00:00.000Z",
      notePath: "",
    });
    mockGetRecentNotes.mockResolvedValue([]);
    mockGetRecentSessions.mockResolvedValue([]);
    mockListDirectory.mockResolvedValue([]);
    mockReadMarkdownFile.mockResolvedValue({ content: "", truncated: false });
    mockWriteMarkdownFile.mockResolvedValue(undefined);
    mockGetInspiration.mockResolvedValue({
      contextual: null,
      quote: { text: "Default quote", attribution: "Test" },
    });
    mockGetAllTasks.mockResolvedValue({
      tasks: [],
      incomplete: 0,
      total: 0,
    });
    mockToggleTask.mockResolvedValue({
      success: true,
      newState: "x",
    });
    mockLoadVaultConfig.mockResolvedValue({});
    mockSearchFiles.mockResolvedValue([]);
    mockSearchContent.mockResolvedValue([]);
    mockGetSnippets.mockResolvedValue([]);
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
    test("generates unique IDs", () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      expect(id1).not.toBe(id2);
    });

    test("starts with 'msg_' prefix", () => {
      const id = generateMessageId();
      expect(id.startsWith("msg_")).toBe(true);
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

      await handler.onOpen(ws as unknown as Parameters<typeof handler.onOpen>[0]);

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

      await handler.onOpen(ws as unknown as Parameters<typeof handler.onOpen>[0]);

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

      // Set up some state
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      const ws = createMockWebSocket();
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Close connection
      await handler.onClose();

      // State should be reset
      const state = handler.getState();
      expect(state.currentVault).toBeNull();
      expect(state.currentSessionId).toBeNull();
      expect(state.activeQuery).toBeNull();
    });

    test("interrupts active query on close", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Create a fast generator that completes quickly
      const fastGenerator = (async function* () {
        yield { type: "system", session_id: "test" };
      })();

      const localInterrupt = mock(() => Promise.resolve());

      mockCreateSession.mockResolvedValue({
        sessionId: "test-session",
        events: fastGenerator,
        interrupt: localInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Start and complete a discussion
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      // Now set up another generator for the next message
      let shouldStop = false;
      const slowGenerator = (async function* () {
        yield { type: "system", session_id: "slow-test" };
        // Wait until stopped
        while (!shouldStop) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })();

      const slowInterrupt = mock(() => {
        shouldStop = true;
        return Promise.resolve();
      });

      mockResumeSession.mockResolvedValue({
        sessionId: "test-session",
        events: slowGenerator,
        interrupt: slowInterrupt,
      });

      // Start another discussion (don't await)
      const discussionPromise = handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Another message" })
      );

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Close connection - this should trigger interrupt
      await handler.onClose();

      // Interrupt should have been called on the slow query
      expect(slowInterrupt).toHaveBeenCalled();

      // Wait for discussion to complete
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

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "ping" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("pong");
    });

    test("handles ArrayBuffer data", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      const data = new TextEncoder().encode(JSON.stringify({ type: "ping" }));
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        data.buffer
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("pong");
    });

    test("sends error for invalid JSON", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        "not valid json"
      );

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

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "unknown_type" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });

    test("sends error for missing required fields", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // select_vault requires vaultId
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault" })
      );

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
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("session_ready");
      if (message?.type === "session_ready") {
        expect(message.vaultId).toBe("test-vault");
      }

      // State should be updated
      const state = handler.getState();
      expect(state.currentVault).not.toBeNull();
      expect(state.currentVault?.id).toBe("test-vault");
    });

    test("sends error for non-existent vault", async () => {
      mockGetVaultById.mockResolvedValue(null);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "non-existent" })
      );

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

      // Select first vault
      mockGetVaultById.mockResolvedValue(vault1);
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "vault-1" })
      );

      // Simulate having a session
      mockCreateSession.mockResolvedValue({
        sessionId: "session-1",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
        supportedCommands: mockSupportedCommands,
      });

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      // Select second vault
      mockGetVaultById.mockResolvedValue(vault2);
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "vault-2" })
      );

      // Session should be cleared
      const state = handler.getState();
      expect(state.currentSessionId).toBeNull();
      expect(state.currentVault?.id).toBe("vault-2");
    });
  });

  // ===========================================================================
  // capture_note Handler Tests
  // ===========================================================================

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // ===========================================================================
  // get_recent_activity Handler Tests
  // ===========================================================================

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // ===========================================================================
  // discussion_message Handler Tests
  // ===========================================================================

  describe("discussion_message", () => {
    test("creates new session and streams response", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Create mock events using stream_event (not assistant, which doesn't send chunks)
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
          for (const event of events) {
            yield event;
          }
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Send discussion message
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hi Claude" })
      );

      const messages = ws.getMessages();

      // Should have: session_ready, response_start, response_chunk, response_end
      expect(messages.some((m) => m.type === "response_start")).toBe(true);
      expect(messages.some((m) => m.type === "response_chunk")).toBe(true);
      expect(messages.some((m) => m.type === "response_end")).toBe(true);

      // Verify session was stored
      const state = handler.getState();
      expect(state.currentSessionId).toBe("new-session");
    });

    test("resumes existing session", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // First message creates session
      mockCreateSession.mockResolvedValue({
        sessionId: "first-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
      });

      // Second message should resume
      mockResumeSession.mockResolvedValue({
        sessionId: "first-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // First discussion
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "First message" })
      );

      // Second discussion should resume
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Second message" })
      );

      // resumeSession should have been called (with optional args)
      expect(mockResumeSession).toHaveBeenCalledWith(
        vault.path,
        "first-session",
        "Second message",
        undefined, // no extra options
        expect.any(Function), // tool permission callback
        expect.any(Function) // askUserQuestion callback
      );
    });

    test("sends error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
      }
    });

    test("streams tool events", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // The SDK emits events with a "result" type containing tool info in content array
      const events = [
        { type: "system", session_id: "tool-session" },
        {
          type: "result",
          session_id: "tool-session",
          result: {
            content: [
              {
                type: "tool_use",
                name: "read_file",
                id: "tool-123",
                input: { path: "/test.md" },
              },
            ],
          },
        },
        {
          type: "result",
          session_id: "tool-session",
          result: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-123",
                content: "File content here",
              },
            ],
          },
        },
      ];

      mockCreateSession.mockResolvedValue({
        sessionId: "tool-session",
        events: (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Read a file" })
      );

      const messages = ws.getMessages();

      // Find tool messages
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

      // Verify tool invocations are persisted with the assistant message
      const appendCalls = mockAppendMessage.mock.calls as Array<
        [string, string, { role: string; toolInvocations?: Array<{ toolUseId: string; toolName: string; input?: unknown; output?: unknown; status: string }> }]
      >;
      // Second call is the assistant message (first is user message)
      const assistantMessageCall = appendCalls.find(
        (call) => call[2]?.role === "assistant"
      );
      expect(assistantMessageCall).toBeDefined();
      const assistantMessage = assistantMessageCall![2];
      expect(assistantMessage.toolInvocations).toBeDefined();
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
      // The real SDK emits 'user' events (not 'result') containing tool results
      // This test verifies the handleUserEvent path works correctly
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      const events = [
        { type: "system", session_id: "user-event-session" },
        // Tool invocation starts via stream events
        {
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "tool-user-evt", name: "read_file" },
          },
        },
        // Tool execution completes - SDK emits a 'user' message with tool_result
        {
          type: "user",
          session_id: "user-event-session",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-user-evt",
                content: "Result from user event",
              },
            ],
          },
        },
      ];

      mockCreateSession.mockResolvedValue({
        sessionId: "user-event-session",
        events: (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Read a file" })
      );

      const messages = ws.getMessages();

      // Verify tool_start was sent from stream event
      const toolStart = messages.find((m) => m.type === "tool_start");
      expect(toolStart).toBeDefined();
      if (toolStart?.type === "tool_start") {
        expect(toolStart.toolName).toBe("read_file");
        expect(toolStart.toolUseId).toBe("tool-user-evt");
      }

      // Verify tool_end was sent from user event
      const toolEnd = messages.find((m) => m.type === "tool_end");
      expect(toolEnd).toBeDefined();
      if (toolEnd?.type === "tool_end") {
        expect(toolEnd.toolUseId).toBe("tool-user-evt");
        expect(toolEnd.output).toBe("Result from user event");
      }
    });

    test("marks running tools as complete when connection closes mid-stream", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      const ws = createMockWebSocket();

      // Create an async generator that yields tool_start, then connection closes
      mockCreateSession.mockResolvedValueOnce({
        sessionId: "test-session-id",
        events: (async function* () {
          // First: system event
          yield { type: "system", session_id: "test-session-id" };

          // Second: tool_start (content_block_start with tool_use)
          yield {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tool-interrupted", name: "read_file" },
            },
          };

          // Simulate connection closing after tool_start
          // The handler checks ws.readyState before each event
          (ws as { readyState: number }).readyState = 3; // CLOSED

          // This event won't be processed because connection is closed
          yield {
            type: "result",
            result: {
              content: [
                { type: "tool_result", tool_use_id: "tool-interrupted", content: "File content" },
              ],
            },
          };
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Read a file" })
      );

      // Verify tool_start was sent
      const messages = ws.getMessages();
      const toolStart = messages.find((m) => m.type === "tool_start");
      expect(toolStart).toBeDefined();

      // Verify tool_end was NOT sent (connection closed before result)
      const toolEnd = messages.find((m) => m.type === "tool_end");
      expect(toolEnd).toBeUndefined();

      // Verify the tool was saved as complete (not running) to prevent spinner on resume
      const appendCalls = mockAppendMessage.mock.calls as Array<
        [string, string, { role: string; toolInvocations?: Array<{ toolUseId: string; status: string; output?: unknown }> }]
      >;
      const assistantMessageCall = appendCalls.find(
        (call) => call[2]?.role === "assistant"
      );
      expect(assistantMessageCall).toBeDefined();
      const assistantMessage = assistantMessageCall![2];
      expect(assistantMessage.toolInvocations).toBeDefined();
      expect(assistantMessage.toolInvocations![0].status).toBe("complete");
      expect(assistantMessage.toolInvocations![0].output).toBe("[Connection closed before tool completed]");
    });

    test("aborts previous query when new message arrives", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // First query that takes a while
      const firstInterrupt = mock(() => Promise.resolve());
      mockCreateSession.mockResolvedValueOnce({
        sessionId: "slow-session",
        events: (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          yield { type: "system", session_id: "slow-session" };
        })(),
        interrupt: firstInterrupt,
      });

      // Second query
      mockCreateSession.mockResolvedValueOnce({
        sessionId: "fast-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Start first discussion (don't await)
      const firstPromise = handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "First" })
      );

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Start second discussion (this should abort the first)
      // But we need to clear the session ID to trigger createSession again
      // Actually, this will try to resume, so let's set up the mock
      mockResumeSession.mockResolvedValue({
        sessionId: "slow-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
      });

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Second" })
      );

      // First interrupt should have been called
      expect(firstInterrupt).toHaveBeenCalled();

      // Wait for first to complete
      await firstPromise;
    });

    test("surfaces SDK stream error events to frontend", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Simulate SDK returning a stream error event (e.g., invalid slash command)
      const events = [
        { type: "system", subtype: "init", session_id: "error-session" },
        {
          type: "stream_event",
          event: {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "Unknown slash command: /nonexistent",
            },
          },
        },
      ];

      mockCreateSession.mockResolvedValue({
        sessionId: "error-session",
        events: (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Send discussion message that triggers error
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "/nonexistent" })
      );

      const messages = ws.getMessages();

      // Should have an error message with SDK_ERROR code
      const errorMessage = messages.find(
        (m) => m.type === "error" && m.code === "SDK_ERROR"
      );
      expect(errorMessage).toBeDefined();
      if (errorMessage?.type === "error") {
        expect(errorMessage.message).toBe("Unknown slash command: /nonexistent");
      }
    });

    test("surfaces SDK stream error with missing message field", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Simulate SDK error with only type field (no message)
      const events = [
        { type: "system", subtype: "init", session_id: "error-session" },
        {
          type: "stream_event",
          event: {
            type: "error",
            error: {
              type: "rate_limit_error",
            },
          },
        },
      ];

      mockCreateSession.mockResolvedValue({
        sessionId: "error-session",
        events: (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      const messages = ws.getMessages();
      const errorMessage = messages.find(
        (m) => m.type === "error" && m.code === "SDK_ERROR"
      );
      expect(errorMessage).toBeDefined();
      if (errorMessage?.type === "error") {
        // Falls back to error type when message is missing
        expect(errorMessage.message).toBe("rate_limit_error");
      }
    });

    test("surfaces SDK result error events to frontend", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Simulate SDK returning a result error
      const events = [
        { type: "system", subtype: "init", session_id: "error-session" },
        {
          type: "result",
          subtype: "error_during_execution",
          errors: ["Tool execution failed: Permission denied"],
          is_error: true,
          usage: null,
          modelUsage: null,
        },
      ];

      mockCreateSession.mockResolvedValue({
        sessionId: "error-session",
        events: (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Run something" })
      );

      const messages = ws.getMessages();
      const errorMessage = messages.find(
        (m) => m.type === "error" && m.code === "SDK_ERROR"
      );
      expect(errorMessage).toBeDefined();
      if (errorMessage?.type === "error") {
        expect(errorMessage.message).toBe("Tool execution failed: Permission denied");
      }
    });

    test("surfaces SDK max_turns error to frontend", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Simulate SDK max turns error (no errors array, uses subtype fallback)
      const events = [
        { type: "system", subtype: "init", session_id: "error-session" },
        {
          type: "result",
          subtype: "error_max_turns",
          is_error: true,
          usage: null,
          modelUsage: null,
        },
      ];

      mockCreateSession.mockResolvedValue({
        sessionId: "error-session",
        events: (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Long conversation" })
      );

      const messages = ws.getMessages();
      const errorMessage = messages.find(
        (m) => m.type === "error" && m.code === "SDK_ERROR"
      );
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
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Mock SDK returning slash commands
      const sdkCommands = [
        { name: "commit", description: "Create a commit", argumentHint: "message" },
        { name: "/review", description: "Review code" }, // Already has prefix
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

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Send discussion message to trigger session creation
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      const messages = ws.getMessages();

      // Find the session_ready message that includes slash commands
      // (the second one, after vault selection and session creation)
      const sessionReadyWithCommands = messages.find(
        (m) => m.type === "session_ready" && "slashCommands" in m && m.slashCommands
      );

      expect(sessionReadyWithCommands).toBeDefined();
      if (sessionReadyWithCommands?.type === "session_ready" && sessionReadyWithCommands.slashCommands) {
        expect(sessionReadyWithCommands.slashCommands).toHaveLength(2);
        // Verify "/" prefix was added to first command
        expect(sessionReadyWithCommands.slashCommands[0].name).toBe("/commit");
        expect(sessionReadyWithCommands.slashCommands[0].description).toBe("Create a commit");
        expect(sessionReadyWithCommands.slashCommands[0].argumentHint).toBe("message");
        // Verify "/" prefix was preserved on second command
        expect(sessionReadyWithCommands.slashCommands[1].name).toBe("/review");
      }
    });

    test("handles empty slash commands array without error", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Mock SDK returning empty commands array
      mockSupportedCommands.mockResolvedValue([]);

      mockCreateSession.mockResolvedValue({
        sessionId: "new-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
        supportedCommands: mockSupportedCommands,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      const messages = ws.getMessages();

      // Should complete without error
      expect(messages.some((m) => m.type === "response_end")).toBe(true);

      // session_ready should NOT include slashCommands key when empty
      const sessionReadyAfterDiscussion = messages.find(
        (m, i) => m.type === "session_ready" && i > 0
      );
      expect(sessionReadyAfterDiscussion).toBeDefined();
      if (sessionReadyAfterDiscussion?.type === "session_ready") {
        expect(sessionReadyAfterDiscussion.slashCommands).toBeUndefined();
      }
    });

    test("continues without commands when SDK throws error", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Mock SDK throwing error
      mockSupportedCommands.mockRejectedValue(new Error("SDK not available"));

      mockCreateSession.mockResolvedValue({
        sessionId: "new-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
        supportedCommands: mockSupportedCommands,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      const messages = ws.getMessages();

      // Should complete without error (graceful degradation)
      expect(messages.some((m) => m.type === "response_end")).toBe(true);
      // Should not have an error message
      expect(messages.every((m) => m.type !== "error")).toBe(true);

      // session_ready should be sent but without slashCommands
      const sessionReadyAfterDiscussion = messages.find(
        (m, i) => m.type === "session_ready" && i > 0
      );
      expect(sessionReadyAfterDiscussion).toBeDefined();
    });

    test("does not re-fetch commands on session resume", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Reset mock call history from other tests in this suite
      mockSupportedCommands.mockClear();

      // Mock session for resume
      mockLoadSession.mockResolvedValue({
        id: "existing-session",
        vaultId: "test-vault",
        vaultPath: "/tmp/test-vault",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messages: [{ id: "1", role: "user", content: "Hi", timestamp: new Date().toISOString() }],
      });

      mockSupportedCommands.mockResolvedValue([
        { name: "test", description: "Test command" },
      ]);

      mockResumeSession.mockResolvedValue({
        sessionId: "existing-session",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
        supportedCommands: mockSupportedCommands,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Resume an existing session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "resume_session", sessionId: "existing-session" })
      );

      // Send a new message in the resumed session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Continue chat" })
      );

      // supportedCommands should NOT have been called (resume doesn't re-fetch)
      // because the session already exists (isNewSession = false)
      expect(mockSupportedCommands).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // resume_session Handler Tests
  // ===========================================================================

  describe("resume_session", () => {
    test("sets session ID and sends session_ready when session exists", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      // Mock loadSession to return valid session metadata
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

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Resume session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "resume_session", sessionId: "old-session-123" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("session_ready");
      if (message?.type === "session_ready") {
        expect(message.sessionId).toBe("old-session-123");
        expect(message.vaultId).toBe("test-vault");
      }

      const state = handler.getState();
      expect(state.currentSessionId).toBe("old-session-123");
    });

    test("sends error if session not found", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockLoadSession.mockResolvedValue(null);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Try to resume non-existent session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "resume_session", sessionId: "nonexistent" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("SESSION_NOT_FOUND");
      }
    });

    test("sends error if session belongs to different vault", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      // Session belongs to a different vault
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

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Try to resume session from different vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "resume_session", sessionId: "other-session" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("SESSION_INVALID");
      }
    });

    test("sends error when no vault pre-selected", async () => {
      // With per-vault session storage, vault must be selected first
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Resume without selecting vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "resume_session", sessionId: "session-123" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toBe("Please select a vault first");
      }
    });

    test("sends error if session vault no longer exists", async () => {
      // Session exists but vault was deleted
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

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "resume_session", sessionId: "session-123" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
      }
    });

    test("sends error if loadSession throws an exception", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      // Simulate storage failure or corruption
      mockLoadSession.mockRejectedValue(new Error("Storage read failed"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "resume_session", sessionId: "corrupted-session" })
      );

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
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      mockCreateSession.mockResolvedValue({
        sessionId: "session-to-clear",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault and create session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      // Clear session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "new_session" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("session_ready");
      if (message?.type === "session_ready") {
        expect(message.sessionId).toBe("");
        expect(message.vaultId).toBe("test-vault");
      }

      const state = handler.getState();
      expect(state.currentSessionId).toBeNull();
    });

    test("sends error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "new_session" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
      }
    });

    test("interrupts active query", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

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

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Start discussion (don't await)
      const discussionPromise = handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // New session should interrupt
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "new_session" })
      );

      expect(activeInterrupt).toHaveBeenCalled();

      await discussionPromise;
    });

    test("includes cached slash commands in response", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      const cachedCommands = [
        { name: "/recall", description: "Search vault" },
        { name: "/tasks", description: "List tasks" },
      ];
      mockLoadSlashCommands.mockResolvedValue(cachedCommands);

      mockCreateSession.mockResolvedValue({
        sessionId: "session-to-clear",
        events: (async function* () {})(),
        interrupt: mockInterrupt,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault and create session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      // Clear session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "new_session" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("session_ready");
      if (message?.type === "session_ready") {
        expect(message.sessionId).toBe("");
        expect(message.vaultId).toBe("test-vault");
        expect(message.slashCommands).toEqual(cachedCommands);
      }
    });
  });

  // ===========================================================================
  // abort Handler Tests
  // ===========================================================================

  describe("abort", () => {
    test("interrupts active query", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

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

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Start discussion (don't await)
      const discussionPromise = handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Abort
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "abort" })
      );

      expect(activeInterrupt).toHaveBeenCalled();

      await discussionPromise;
    });

    test("does nothing if no active query", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Should not throw
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "abort" })
      );

      // No error should be sent
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

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "ping" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("pong");
    });
  });

  // ===========================================================================
  // State Management Tests
  // ===========================================================================

  describe("State Management", () => {
    test("maintains isolation between handlers", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      const handler1 = createTestHandler();
      const handler2 = createTestHandler();
      const ws1 = createMockWebSocket();

      // Select vault on handler1
      await handler1.onMessage(
        ws1 as unknown as Parameters<typeof handler1.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // handler2 should not have a vault
      const state1 = handler1.getState();
      const state2 = handler2.getState();

      expect(state1.currentVault?.id).toBe("test-vault");
      expect(state2.currentVault).toBeNull();
    });

    test("preserves vault across multiple messages", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      // Mock session creation for discussion messages
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

      // Select vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Vault should be preserved between messages
      const stateAfterSelect = handler.getState();
      expect(stateAfterSelect.currentVault?.id).toBe("test-vault");

      // Send a discussion message to trigger session creation
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      // Vault should still be the same after the message
      const stateAfterMessage = handler.getState();
      expect(stateAfterMessage.currentVault?.id).toBe("test-vault");

      // Session should have been created using the vault
      // Note: createSession is called with (vault, prompt, ...) - verify vault was passed
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
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Import SessionError for this test
      const { SessionError } = await import("../session-manager");
      mockCreateSession.mockRejectedValue(
        new SessionError("SDK unavailable", "SDK_ERROR")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("SDK_ERROR");
      }
    });

    test("handles unexpected errors", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockCreateSession.mockRejectedValue(new Error("Unexpected failure"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("SDK_ERROR");
        expect(message.message).toContain("Unexpected failure");
      }
    });
  });

  // ===========================================================================
  // File Browser Tests
  // ===========================================================================

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // ===========================================================================
  // write_file Handler Tests
  // ===========================================================================

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // ===========================================================================
  // delete_file Handler Tests
  // ===========================================================================

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // ===========================================================================
  // get_inspiration Handler Tests
  // ===========================================================================

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // ===========================================================================
  // get_tasks Handler Tests
  // ===========================================================================

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // ===========================================================================
  // toggle_task Handler Tests
  // ===========================================================================

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

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
      mockRunVaultSetup.mockResolvedValue({
        success: true,
        summary: ["Installed commands", "Created directories"],
      });
      mockGetVaultById.mockResolvedValue({ ...createdVault, setupComplete: true });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "create_vault", title: "My New Vault" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("vault_created");
      if (message?.type === "vault_created") {
        expect(message.vault.id).toBe("my-new-vault");
        expect(message.vault.name).toBe("My New Vault");
        expect(message.vault.setupComplete).toBe(true);
      }

      // Verify createVault was called with correct title
      expect(mockCreateVault).toHaveBeenCalledWith("My New Vault");
      // Verify setup was run
      expect(mockRunVaultSetup).toHaveBeenCalledWith("my-new-vault");
    });

    test("returns vault_created even when setup has issues", async () => {
      const createdVault = createMockVault({
        id: "my-vault",
        name: "My Vault",
      });
      mockCreateVault.mockResolvedValue(createdVault);
      mockRunVaultSetup.mockRejectedValue(new Error("Setup failed"));
      mockGetVaultById.mockResolvedValue(createdVault);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "create_vault", title: "My Vault" })
      );

      // Should still return vault_created (setup failure is non-fatal)
      const message = ws.getLastMessage();
      expect(message?.type).toBe("vault_created");
      if (message?.type === "vault_created") {
        expect(message.vault.id).toBe("my-vault");
      }
    });

    test("returns original vault when re-fetch fails", async () => {
      const createdVault = createMockVault({
        id: "my-vault",
        name: "My Vault",
        setupComplete: false,
      });
      mockCreateVault.mockResolvedValue(createdVault);
      mockRunVaultSetup.mockResolvedValue({ success: true, summary: [] });
      // Re-fetch returns null, so original vault should be used
      mockGetVaultById.mockResolvedValue(null);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "create_vault", title: "My Vault" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("vault_created");
      if (message?.type === "vault_created") {
        // Original vault (without updated setupComplete) should be returned
        expect(message.vault.id).toBe("my-vault");
        expect(message.vault.setupComplete).toBe(false);
      }
    });

    test("returns VALIDATION_ERROR when VaultCreationError is thrown", async () => {
      mockCreateVault.mockRejectedValue(new VaultCreationError("Vault already exists"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "create_vault", title: "Existing Vault" })
      );

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

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "create_vault", title: "My Vault" })
      );

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

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "create_vault" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });

    test("validates title cannot be empty", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "create_vault", title: "" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  // ===========================================================================
  // Search Handler Tests
  // ===========================================================================

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

  // MIGRATED TO REST API - SearchIndex now managed by REST routes
  // MIGRATED TO REST API - See backend/src/__tests__/rest-routes/ tests

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

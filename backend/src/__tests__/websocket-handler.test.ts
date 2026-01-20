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

const mockArchiveFile = mock<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<{ originalPath: string; archivePath: string }>
>(() => Promise.resolve({ originalPath: "", archivePath: "04_Archive/archived-dir" }));

/**
 * Mock FileBrowserError for tests.
 * Uses name="FileBrowserError" so isFileBrowserError() works correctly.
 */
class MockFileBrowserError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "FileBrowserError";
  }
}

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
    deleteSession: mockDeleteSession,
    loadVaultConfig: mockLoadVaultConfig,
    loadSlashCommands: mockLoadSlashCommands,
    saveSlashCommands: mockSaveSlashCommands,
    savePinnedAssets: mockSavePinnedAssets,
    saveVaultConfig: mockSaveVaultConfig,
    runVaultSetup: mockRunVaultSetup,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    createSearchIndex: ((contentRoot: string) => new MockSearchIndexManager(contentRoot)) as any,
    // Handler dependencies (injected to extracted handlers)
    handlerDeps: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      captureToDaily: mockCaptureToDaily as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      getRecentNotes: mockGetRecentNotes as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      listDirectory: mockListDirectory as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      readMarkdownFile: mockReadMarkdownFile as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      writeMarkdownFile: mockWriteMarkdownFile as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      deleteFile: mockDeleteFile as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      archiveFile: mockArchiveFile as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      getInspiration: mockGetInspiration as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      getAllTasks: mockGetAllTasks as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      toggleTask: mockToggleTask as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      getRecentSessions: mockGetRecentSessions as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      loadVaultConfig: mockLoadVaultConfig as any,
    },
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
 */
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

  describe("capture_note", () => {
    test("captures note and sends note_captured", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockCaptureToDaily.mockResolvedValue({
        success: true,
        timestamp: "2025-01-15T14:30:00.000Z",
        notePath: "/tmp/test-vault/00_Inbox/2025-01-15.md",
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Capture note
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "capture_note", text: "My note content" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("note_captured");
      if (message?.type === "note_captured") {
        expect(message.timestamp).toBe("2025-01-15T14:30:00.000Z");
      }

      // Verify captureToDaily was called with correct args
      expect(mockCaptureToDaily).toHaveBeenCalledWith(vault, "My note content");
    });

    test("sends error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "capture_note", text: "My note" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("sends error if capture fails", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockCaptureToDaily.mockResolvedValue({
        success: false,
        timestamp: "2025-01-15T14:30:00.000Z",
        notePath: "",
        error: "Failed to write file",
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Capture note
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "capture_note", text: "My note" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("NOTE_CAPTURE_FAILED");
        expect(message.message).toContain("Failed to write file");
      }
    });
  });

  // ===========================================================================
  // get_recent_activity Handler Tests
  // ===========================================================================

  describe("get_recent_activity", () => {
    test("returns error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_recent_activity" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("returns both captures and discussions", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetRecentNotes.mockResolvedValue([
        { id: "note-1", text: "First note", time: "10:30", date: "2025-01-15" },
        { id: "note-2", text: "Second note", time: "11:45", date: "2025-01-15" },
      ]);
      mockGetRecentSessions.mockResolvedValue([
        { sessionId: "session-1", preview: "Hello", time: "09:00", date: "2025-01-15", messageCount: 5 },
      ]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_recent_activity" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("recent_activity");
      if (message?.type === "recent_activity") {
        expect(message.captures).toHaveLength(2);
        expect(message.discussions).toHaveLength(1);
        expect(message.captures[0].text).toBe("First note");
        expect(message.discussions[0].sessionId).toBe("session-1");
      }
    });

    test("returns empty arrays when no activity exists", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetRecentNotes.mockResolvedValue([]);
      mockGetRecentSessions.mockResolvedValue([]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_recent_activity" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("recent_activity");
      if (message?.type === "recent_activity") {
        expect(message.captures).toEqual([]);
        expect(message.discussions).toEqual([]);
      }
    });

    test("calls getRecentNotes with vault and limit", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetRecentNotes.mockResolvedValue([]);
      mockGetRecentSessions.mockResolvedValue([]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_recent_activity" })
      );

      expect(mockGetRecentNotes).toHaveBeenCalledWith(vault, 5);
    });

    test("calls getRecentSessions with vault ID and limit", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetRecentNotes.mockResolvedValue([]);
      mockGetRecentSessions.mockResolvedValue([]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_recent_activity" })
      );

      expect(mockGetRecentSessions).toHaveBeenCalledWith(vault.path, 5);
    });

    test("handles errors gracefully", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetRecentNotes.mockRejectedValue(new Error("Filesystem error"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_recent_activity" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toContain("Filesystem error");
      }
    });
  });

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
      mockCaptureToDaily.mockResolvedValue({
        success: true,
        timestamp: "2025-01-01T00:00:00.000Z",
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Capture multiple notes
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "capture_note", text: "Note 1" })
      );
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "capture_note", text: "Note 2" })
      );

      // captureToDaily should have been called with the vault both times
      expect(mockCaptureToDaily).toHaveBeenCalledTimes(2);
      expect(mockCaptureToDaily).toHaveBeenCalledWith(vault, "Note 1");
      expect(mockCaptureToDaily).toHaveBeenCalledWith(vault, "Note 2");
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

  describe("list_directory handler", () => {
    test("returns error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "list_directory", path: "" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("returns directory listing for root path", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockListDirectory.mockResolvedValue([
        { name: "folder1", type: "directory", path: "folder1" },
        { name: "note.md", type: "file", path: "note.md" },
      ]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "list_directory", path: "" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("directory_listing");
      if (message?.type === "directory_listing") {
        expect(message.path).toBe("");
        expect(message.entries).toHaveLength(2);
        expect(message.entries[0].name).toBe("folder1");
        expect(message.entries[1].name).toBe("note.md");
      }

      expect(mockListDirectory).toHaveBeenCalledWith(vault.path, "");
    });

    test("returns directory listing for nested path", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockListDirectory.mockResolvedValue([
        { name: "nested.md", type: "file", path: "folder1/nested.md" },
      ]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "list_directory", path: "folder1" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("directory_listing");
      if (message?.type === "directory_listing") {
        expect(message.path).toBe("folder1");
        expect(message.entries).toHaveLength(1);
      }

      expect(mockListDirectory).toHaveBeenCalledWith(vault.path, "folder1");
    });

    test("returns error for path traversal attempt", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockListDirectory.mockRejectedValue(
        new MockFileBrowserError("Path outside vault", "PATH_TRAVERSAL")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "list_directory", path: "../etc" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("PATH_TRAVERSAL");
      }
    });

    test("returns error for non-existent directory", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockListDirectory.mockRejectedValue(
        new MockFileBrowserError("Directory not found", "DIRECTORY_NOT_FOUND")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "list_directory", path: "nonexistent" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("DIRECTORY_NOT_FOUND");
      }
    });

    test("handles unexpected errors", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockListDirectory.mockRejectedValue(new Error("Unexpected failure"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "list_directory", path: "" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toContain("Unexpected failure");
      }
    });
  });

  describe("read_file handler", () => {
    test("returns error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "read_file", path: "note.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("returns file content for valid markdown file", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockReadMarkdownFile.mockResolvedValue({
        content: "# Hello World\n\nThis is a test note.",
        truncated: false,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "read_file", path: "note.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("file_content");
      if (message?.type === "file_content") {
        expect(message.path).toBe("note.md");
        expect(message.content).toBe("# Hello World\n\nThis is a test note.");
        expect(message.truncated).toBe(false);
      }

      expect(mockReadMarkdownFile).toHaveBeenCalledWith(vault.path, "note.md");
    });

    test("returns truncated flag for large files", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockReadMarkdownFile.mockResolvedValue({
        content: "Truncated content...",
        truncated: true,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "read_file", path: "large-note.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("file_content");
      if (message?.type === "file_content") {
        expect(message.truncated).toBe(true);
      }
    });

    test("returns error for non-markdown file", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockReadMarkdownFile.mockRejectedValue(
        new MockFileBrowserError("Only .md files allowed", "INVALID_FILE_TYPE")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "read_file", path: "image.png" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INVALID_FILE_TYPE");
      }
    });

    test("returns error for non-existent file", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockReadMarkdownFile.mockRejectedValue(
        new MockFileBrowserError("File not found", "FILE_NOT_FOUND")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "read_file", path: "nonexistent.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("FILE_NOT_FOUND");
      }
    });

    test("returns error for path traversal attempt", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockReadMarkdownFile.mockRejectedValue(
        new MockFileBrowserError("Path outside vault", "PATH_TRAVERSAL")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "read_file", path: "../../../etc/passwd.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("PATH_TRAVERSAL");
      }
    });

    test("handles unexpected errors", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockReadMarkdownFile.mockRejectedValue(new Error("Disk read error"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "read_file", path: "note.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toContain("Disk read error");
      }
    });
  });

  // ===========================================================================
  // write_file Handler Tests
  // ===========================================================================

  describe("write_file handler", () => {
    test("returns error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "write_file", path: "note.md", content: "Hello" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("writes file and returns file_written on success", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockWriteMarkdownFile.mockResolvedValue(undefined);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "write_file",
          path: "note.md",
          content: "# Updated Content\n\nThis is the new content.",
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("file_written");
      if (message?.type === "file_written") {
        expect(message.path).toBe("note.md");
        expect(message.success).toBe(true);
      }

      expect(mockWriteMarkdownFile).toHaveBeenCalledWith(
        vault.path,
        "note.md",
        "# Updated Content\n\nThis is the new content."
      );
    });

    test("writes file with empty content", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockWriteMarkdownFile.mockResolvedValue(undefined);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "write_file", path: "empty.md", content: "" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("file_written");
      if (message?.type === "file_written") {
        expect(message.path).toBe("empty.md");
        expect(message.success).toBe(true);
      }

      expect(mockWriteMarkdownFile).toHaveBeenCalledWith(vault.path, "empty.md", "");
    });

    test("writes file in nested path", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockWriteMarkdownFile.mockResolvedValue(undefined);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "write_file",
          path: "folder/subfolder/note.md",
          content: "Nested content",
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("file_written");
      if (message?.type === "file_written") {
        expect(message.path).toBe("folder/subfolder/note.md");
      }

      expect(mockWriteMarkdownFile).toHaveBeenCalledWith(
        vault.path,
        "folder/subfolder/note.md",
        "Nested content"
      );
    });

    test("returns error for path traversal attempt", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockWriteMarkdownFile.mockRejectedValue(
        new MockFileBrowserError("Path outside vault", "PATH_TRAVERSAL")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "write_file",
          path: "../../../etc/passwd.md",
          content: "malicious content",
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("PATH_TRAVERSAL");
      }
    });

    test("returns error for non-markdown file", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockWriteMarkdownFile.mockRejectedValue(
        new MockFileBrowserError("Only .md files allowed", "INVALID_FILE_TYPE")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "write_file",
          path: "script.txt",
          content: "some content",
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INVALID_FILE_TYPE");
      }
    });

    test("returns error for non-existent file", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockWriteMarkdownFile.mockRejectedValue(
        new MockFileBrowserError("File does not exist", "FILE_NOT_FOUND")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "write_file",
          path: "nonexistent.md",
          content: "content for new file",
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("FILE_NOT_FOUND");
      }
    });

    test("handles unexpected errors", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockWriteMarkdownFile.mockRejectedValue(new Error("Disk write error"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "write_file", path: "note.md", content: "content" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toContain("Disk write error");
      }
    });

    test("handles permission denied errors", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockWriteMarkdownFile.mockRejectedValue(new Error("EACCES: permission denied"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "write_file", path: "readonly.md", content: "content" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toContain("permission denied");
      }
    });
  });

  // ===========================================================================
  // delete_file Handler Tests
  // ===========================================================================

  describe("delete_file handler", () => {
    test("returns error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_file", path: "note.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("deletes file and returns file_deleted on success", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockDeleteFile.mockResolvedValue(undefined);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_file", path: "note.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("file_deleted");
      if (message?.type === "file_deleted") {
        expect(message.path).toBe("note.md");
      }

      expect(mockDeleteFile).toHaveBeenCalledWith(vault.path, "note.md");
    });

    test("deletes file in nested directory", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockDeleteFile.mockResolvedValue(undefined);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_file", path: "folder/subfolder/note.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("file_deleted");
      if (message?.type === "file_deleted") {
        expect(message.path).toBe("folder/subfolder/note.md");
      }

      expect(mockDeleteFile).toHaveBeenCalledWith(vault.path, "folder/subfolder/note.md");
    });

    test("returns error for non-existent file (FILE_NOT_FOUND)", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockDeleteFile.mockRejectedValue(
        new MockFileBrowserError('File "missing.md" does not exist', "FILE_NOT_FOUND")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_file", path: "missing.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("FILE_NOT_FOUND");
      }
    });

    test("returns error for path traversal attempt", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockDeleteFile.mockRejectedValue(
        new MockFileBrowserError("Path is outside the vault boundary", "PATH_TRAVERSAL")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_file", path: "../outside/secret.txt" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("PATH_TRAVERSAL");
      }
    });

    test("returns error when trying to delete directory", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockDeleteFile.mockRejectedValue(
        new MockFileBrowserError("Can only delete files, not directories", "INVALID_FILE_TYPE")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_file", path: "a-directory" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INVALID_FILE_TYPE");
      }
    });

    test("returns INTERNAL_ERROR for unexpected errors", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockDeleteFile.mockRejectedValue(new Error("Disk failure"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_file", path: "note.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toContain("Disk failure");
      }
    });
  });

  // ===========================================================================
  // get_inspiration Handler Tests
  // ===========================================================================

  describe("get_inspiration", () => {
    test("returns error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_inspiration" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
      }
    });

    test("calls getInspiration with vault info", async () => {
      const vault = createMockVault({ path: "/test/vault/path" });
      mockGetVaultById.mockResolvedValue(vault);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_inspiration" })
      );

      expect(mockGetInspiration).toHaveBeenCalledWith(vault);
    });

    test("returns inspiration with contextual and quote", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetInspiration.mockResolvedValue({
        contextual: { text: "What's on your mind today?", attribution: undefined },
        quote: { text: "Carpe diem", attribution: "Horace" },
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_inspiration" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("inspiration");
      if (message?.type === "inspiration") {
        expect(message.contextual).toEqual({
          text: "What's on your mind today?",
          attribution: undefined,
        });
        expect(message.quote).toEqual({
          text: "Carpe diem",
          attribution: "Horace",
        });
      }
    });

    test("returns inspiration with null contextual", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetInspiration.mockResolvedValue({
        contextual: null,
        quote: { text: "Stay curious", attribution: "Einstein" },
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_inspiration" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("inspiration");
      if (message?.type === "inspiration") {
        expect(message.contextual).toBeNull();
        expect(message.quote.text).toBe("Stay curious");
      }
    });

    test("silently handles errors without sending error to client", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetInspiration.mockRejectedValue(new Error("Generation failed"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_inspiration" })
      );

      // The last message should be session_ready from vault selection,
      // NOT an error message - errors are silently logged
      const messages = ws.getMessages();
      const hasErrorMessage = messages.some(
        (m) => m.type === "error" && "message" in m && m.message.includes("Generation")
      );
      expect(hasErrorMessage).toBe(false);
    });
  });

  // ===========================================================================
  // get_tasks Handler Tests
  // ===========================================================================

  describe("get_tasks handler", () => {
    test("returns error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_tasks" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("returns tasks when vault selected", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetAllTasks.mockResolvedValue({
        tasks: [
          { text: "Buy groceries", state: " ", filePath: "00_Inbox/tasks.md", lineNumber: 5 },
          { text: "Done item", state: "x", filePath: "00_Inbox/tasks.md", lineNumber: 6 },
        ],
        incomplete: 1,
        total: 2,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_tasks" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("tasks");
      if (message?.type === "tasks") {
        expect(message.tasks).toHaveLength(2);
        expect(message.incomplete).toBe(1);
        expect(message.total).toBe(2);
        expect(message.tasks[0].text).toBe("Buy groceries");
        expect(message.tasks[0].state).toBe(" ");
      }
    });

    test("returns empty array for empty vault", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetAllTasks.mockResolvedValue({
        tasks: [],
        incomplete: 0,
        total: 0,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_tasks" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("tasks");
      if (message?.type === "tasks") {
        expect(message.tasks).toEqual([]);
        expect(message.incomplete).toBe(0);
        expect(message.total).toBe(0);
      }
    });

    test("calls getAllTasks with vault contentRoot and config", async () => {
      const vault = createMockVault({ contentRoot: "/tmp/test-vault/content" });
      mockGetVaultById.mockResolvedValue(vault);
      mockLoadVaultConfig.mockResolvedValue({
        projectPath: "01_Projects",
        areaPath: "02_Areas",
      });
      mockGetAllTasks.mockResolvedValue({
        tasks: [],
        incomplete: 0,
        total: 0,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_tasks" })
      );

      expect(mockLoadVaultConfig).toHaveBeenCalledWith(vault.path);
      expect(mockGetAllTasks).toHaveBeenCalledWith(
        vault.contentRoot,
        { projectPath: "01_Projects", areaPath: "02_Areas" }
      );
    });

    test("handles errors gracefully", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetAllTasks.mockRejectedValue(new Error("Filesystem error"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_tasks" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toContain("Filesystem error");
      }
    });
  });

  // ===========================================================================
  // toggle_task Handler Tests
  // ===========================================================================

  describe("toggle_task handler", () => {
    test("returns error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "toggle_task", filePath: "tasks.md", lineNumber: 5 })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("toggles task and returns new state", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockToggleTask.mockResolvedValue({
        success: true,
        newState: "x",
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "toggle_task", filePath: "00_Inbox/tasks.md", lineNumber: 5 })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("task_toggled");
      if (message?.type === "task_toggled") {
        expect(message.filePath).toBe("00_Inbox/tasks.md");
        expect(message.lineNumber).toBe(5);
        expect(message.newState).toBe("x");
      }

      expect(mockToggleTask).toHaveBeenCalledWith(
        vault.contentRoot,
        "00_Inbox/tasks.md",
        5,
        undefined
      );
    });

    test("returns error for invalid path", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockToggleTask.mockResolvedValue({
        success: false,
        error: "Path outside vault",
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "toggle_task", filePath: "../etc/passwd", lineNumber: 1 })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("PATH_TRAVERSAL");
      }
    });

    test("returns error for file not found", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockToggleTask.mockResolvedValue({
        success: false,
        error: "File not found: missing.md",
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "toggle_task", filePath: "missing.md", lineNumber: 1 })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("FILE_NOT_FOUND");
      }
    });

    test("returns error for line that is not a task", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockToggleTask.mockResolvedValue({
        success: false,
        error: "Line 3 is not a task",
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "toggle_task", filePath: "note.md", lineNumber: 3 })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toContain("is not a task");
      }
    });

    test("handles thrown FileBrowserError", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockToggleTask.mockRejectedValue(
        new MockFileBrowserError("Path outside vault", "PATH_TRAVERSAL")
      );

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "toggle_task", filePath: "../etc/passwd", lineNumber: 1 })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("PATH_TRAVERSAL");
      }
    });

    test("handles unexpected errors gracefully", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockToggleTask.mockRejectedValue(new Error("Disk write error"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "toggle_task", filePath: "tasks.md", lineNumber: 1 })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toContain("Disk write error");
      }
    });

    test("cycles through all task states correctly", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Simulate state cycle: ' ' -> 'x' -> '/' -> '?' -> 'b' -> 'f' -> ' '
      const states = ["x", "/", "?", "b", "f", " "];
      let stateIndex = 0;

      mockToggleTask.mockImplementation(() => {
        const newState = states[stateIndex];
        stateIndex++;
        return Promise.resolve({
          success: true,
          newState,
        });
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Toggle multiple times and verify each state
      for (const expectedState of states) {
        await handler.onMessage(
          ws as unknown as Parameters<typeof handler.onMessage>[0],
          JSON.stringify({ type: "toggle_task", filePath: "tasks.md", lineNumber: 1 })
        );

        const message = ws.getLastMessage();
        expect(message?.type).toBe("task_toggled");
        if (message?.type === "task_toggled") {
          expect(message.newState).toBe(expectedState);
        }
      }
    });
  });

  describe("delete_session handler", () => {
    test("deletes session and returns session_deleted message", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockDeleteSession.mockImplementation(() => Promise.resolve(true));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Delete a session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_session", sessionId: "session-to-delete" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("session_deleted");
      if (message?.type === "session_deleted") {
        expect(message.sessionId).toBe("session-to-delete");
      }
    });

    test("returns SESSION_NOT_FOUND when session doesn't exist", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockDeleteSession.mockImplementation(() => Promise.resolve(false));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Try to delete non-existent session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_session", sessionId: "non-existent-session" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("SESSION_NOT_FOUND");
      }
    });

    test("cannot delete currently active session", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      // Mock createSession to return a known session ID
      mockCreateSession.mockResolvedValue({
        sessionId: "active-session-id",
        events: (async function* () {
          yield { type: "system", session_id: "active-session-id" };
        })(),
        interrupt: mockInterrupt,
        supportedCommands: mockSupportedCommands,
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Send a discussion message to create and activate a session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "discussion_message", text: "Hello" })
      );

      // Wait for events to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Try to delete the active session
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_session", sessionId: "active-session-id" })
      );

      const messages = ws.getMessages();
      const errorMessage = messages.find(
        (m: ServerMessage) => m.type === "error" && m.code === "SESSION_INVALID"
      );
      expect(errorMessage).toBeDefined();
    });

    test("validates sessionId is required", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "delete_session" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("setup_vault handler", () => {
    test("runs setup and returns setup_complete message on success", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockRunVaultSetup.mockResolvedValue({
        success: true,
        summary: ["Installed 6 commands", "Created 4 directories"],
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "setup_vault", vaultId: "test-vault" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("setup_complete");
      if (message?.type === "setup_complete") {
        expect(message.vaultId).toBe("test-vault");
        expect(message.success).toBe(true);
        expect(message.summary).toContain("Installed 6 commands");
        expect(message.summary).toContain("Created 4 directories");
      }
    });

    test("returns setup_complete with errors on partial failure", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockRunVaultSetup.mockResolvedValue({
        success: false,
        summary: ["Installed 6 commands", "Failed to update CLAUDE.md"],
        errors: ["CLAUDE.md: SDK error"],
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "setup_vault", vaultId: "test-vault" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("setup_complete");
      if (message?.type === "setup_complete") {
        expect(message.success).toBe(false);
        expect(message.errors).toContain("CLAUDE.md: SDK error");
      }
    });

    test("returns VAULT_NOT_FOUND when vault doesn't exist", async () => {
      mockGetVaultById.mockResolvedValue(null);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "setup_vault", vaultId: "non-existent" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
      }
    });

    test("returns VALIDATION_ERROR when vault missing CLAUDE.md", async () => {
      const vault = createMockVault();
      vault.hasClaudeMd = false;
      mockGetVaultById.mockResolvedValue(vault);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "setup_vault", vaultId: "test-vault" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
        expect(message.message).toContain("CLAUDE.md");
      }
    });

    test("returns INTERNAL_ERROR when setup throws", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockRunVaultSetup.mockRejectedValue(new Error("Unexpected error"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "setup_vault", vaultId: "test-vault" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
      }
    });

    test("validates vaultId is required", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "setup_vault" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
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

  describe("search_files handler", () => {
    test("returns VAULT_NOT_FOUND when no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "search_files", query: "test" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("returns search_results with matching files", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSearchFiles.mockResolvedValue([
        { path: "folder/test-file.md", name: "test-file.md", score: 100, matchPositions: [0, 1, 2, 3] },
        { path: "another-test.md", name: "another-test.md", score: 80, matchPositions: [8, 9, 10, 11] },
      ]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Search files
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "search_files", query: "test" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("search_results");
      if (message?.type === "search_results") {
        expect(message.mode).toBe("files");
        expect(message.query).toBe("test");
        expect(message.results).toHaveLength(2);
        expect(message.totalMatches).toBe(2);
        expect(message.searchTimeMs).toBeGreaterThanOrEqual(0);
      }
    });

    test("passes limit option to search index", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSearchFiles.mockResolvedValue([]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Search files with limit
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "search_files", query: "test", limit: 10 })
      );

      expect(mockSearchFiles).toHaveBeenCalledWith("test", { limit: 10 });
    });

    test("returns INTERNAL_ERROR when search throws", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSearchFiles.mockRejectedValue(new Error("Search failed"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Search files
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "search_files", query: "test" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toBe("Search failed");
      }
    });

    test("validates query is required", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "search_files" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("search_content handler", () => {
    test("returns VAULT_NOT_FOUND when no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "search_content", query: "TODO" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("returns search_results with matching content", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSearchContent.mockResolvedValue([
        { path: "notes/todo.md", name: "todo.md", matchCount: 5 },
        { path: "projects/tasks.md", name: "tasks.md", matchCount: 3 },
      ]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Search content
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "search_content", query: "TODO" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("search_results");
      if (message?.type === "search_results") {
        expect(message.mode).toBe("content");
        expect(message.query).toBe("TODO");
        expect(message.results).toHaveLength(2);
        expect(message.totalMatches).toBe(2);
        expect(message.searchTimeMs).toBeGreaterThanOrEqual(0);
      }
    });

    test("passes limit option to search index", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSearchContent.mockResolvedValue([]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Search content with limit
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "search_content", query: "TODO", limit: 25 })
      );

      expect(mockSearchContent).toHaveBeenCalledWith("TODO", { limit: 25 });
    });

    test("returns INTERNAL_ERROR when search throws", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSearchContent.mockRejectedValue(new Error("Index not ready"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Search content
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "search_content", query: "TODO" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toBe("Index not ready");
      }
    });
  });

  describe("get_snippets handler", () => {
    test("returns VAULT_NOT_FOUND when no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_snippets", path: "notes/todo.md", query: "TODO" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
        expect(message.message).toContain("No vault selected");
      }
    });

    test("returns snippets for matching file", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetSnippets.mockResolvedValue([
        {
          lineNumber: 5,
          line: "TODO: Complete this task",
          contextBefore: ["Some context before", "Another line before"],
          contextAfter: ["Context after", "More after"],
        },
        {
          lineNumber: 12,
          line: "Another TODO item here",
          contextBefore: ["Previous line"],
          contextAfter: ["Next line"],
        },
      ]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Get snippets
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_snippets", path: "notes/todo.md", query: "TODO" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("snippets");
      if (message?.type === "snippets") {
        expect(message.path).toBe("notes/todo.md");
        expect(message.snippets).toHaveLength(2);
        expect(message.snippets[0].lineNumber).toBe(5);
        expect(message.snippets[0].line).toBe("TODO: Complete this task");
        expect(message.snippets[0].contextBefore).toHaveLength(2);
        expect(message.snippets[0].contextAfter).toHaveLength(2);
      }
    });

    test("calls getSnippets with correct arguments", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetSnippets.mockResolvedValue([]);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Get snippets
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_snippets", path: "folder/file.md", query: "search term" })
      );

      expect(mockGetSnippets).toHaveBeenCalledWith("folder/file.md", "search term");
    });

    test("returns INTERNAL_ERROR when getSnippets throws", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockGetSnippets.mockRejectedValue(new Error("File read error"));

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select vault first
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Get snippets
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_snippets", path: "notes/todo.md", query: "TODO" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("INTERNAL_ERROR");
        expect(message.message).toBe("File read error");
      }
    });

    test("validates path is required", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_snippets", query: "TODO" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });

    test("validates query is required", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "get_snippets", path: "notes/todo.md" })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("searchIndex initialization on vault select", () => {
    test("creates searchIndex when vault is selected", async () => {
      const vault = createMockVault({ contentRoot: "/test/vault/content" });
      mockGetVaultById.mockResolvedValue(vault);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Verify searchIndex is null before vault selection
      expect(handler.getState().searchIndex).toBeNull();

      // Select vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Verify searchIndex is created
      const state = handler.getState();
      expect(state.searchIndex).not.toBeNull();
    });

    test("replaces searchIndex when different vault is selected", async () => {
      const vault1 = createMockVault({ id: "vault-1", contentRoot: "/vault1/content" });
      const vault2 = createMockVault({ id: "vault-2", contentRoot: "/vault2/content" });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Select first vault
      mockGetVaultById.mockResolvedValue(vault1);
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "vault-1" })
      );

      const firstSearchIndex = handler.getState().searchIndex;
      expect(firstSearchIndex).not.toBeNull();

      // Select second vault
      mockGetVaultById.mockResolvedValue(vault2);
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "vault-2" })
      );

      const secondSearchIndex = handler.getState().searchIndex;
      expect(secondSearchIndex).not.toBeNull();
      // Verify a new searchIndex was created (different object instance)
      expect(secondSearchIndex).not.toBe(firstSearchIndex);
    });
  });
  describe("update_vault_config handler", () => {
    test("returns config_updated with success true on valid config", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSaveVaultConfig.mockResolvedValue({ success: true });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // First select the vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Then update config
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "update_vault_config",
          config: { title: "New Title", discussionModel: "sonnet" },
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("config_updated");
      if (message?.type === "config_updated") {
        expect(message.success).toBe(true);
        expect(message.error).toBeUndefined();
      }
    });

    test("calls saveVaultConfig with validated config", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSaveVaultConfig.mockResolvedValue({ success: true });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // First select the vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Then update config
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "update_vault_config",
          config: {
            title: "Test Vault",
            subtitle: "Personal Notes",
            discussionModel: "haiku",
            promptsPerGeneration: 10,
          },
        })
      );

      expect(mockSaveVaultConfig).toHaveBeenCalledWith(vault.path, {
        title: "Test Vault",
        subtitle: "Personal Notes",
        discussionModel: "haiku",
        promptsPerGeneration: 10,
      });
    });

    test("returns config_updated with error when no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // Try to update config without selecting vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "update_vault_config",
          config: { title: "New Title" },
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("config_updated");
      if (message?.type === "config_updated") {
        expect(message.success).toBe(false);
        expect(message.error).toBe("No vault selected");
      }
    });

    test("returns config_updated with error when saveVaultConfig fails", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSaveVaultConfig.mockResolvedValue({
        success: false,
        error: "Permission denied: cannot write to config file",
      });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // First select the vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Then update config
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "update_vault_config",
          config: { title: "New Title" },
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("config_updated");
      if (message?.type === "config_updated") {
        expect(message.success).toBe(false);
        expect(message.error).toBe("Permission denied: cannot write to config file");
      }
    });

    test("returns VALIDATION_ERROR on invalid config (promptsPerGeneration out of range)", async () => {
      // Note: Protocol-level validation catches invalid config before reaching handler
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // First select the vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Try to update config with invalid value (max is 20)
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "update_vault_config",
          config: { promptsPerGeneration: 100 },
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
      // Should not have called saveVaultConfig
      expect(mockSaveVaultConfig).not.toHaveBeenCalled();
    });

    test("returns VALIDATION_ERROR on invalid discussionModel", async () => {
      // Note: Protocol-level validation catches invalid config before reaching handler
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // First select the vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Try to update config with invalid model
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "update_vault_config",
          config: { discussionModel: "invalid-model" },
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });

    test("validates badges array correctly", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSaveVaultConfig.mockResolvedValue({ success: true });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // First select the vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Update config with valid badges
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "update_vault_config",
          config: {
            badges: [
              { text: "Work", color: "blue" },
              { text: "Personal", color: "green" },
            ],
          },
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("config_updated");
      if (message?.type === "config_updated") {
        expect(message.success).toBe(true);
      }
      expect(mockSaveVaultConfig).toHaveBeenCalledWith(vault.path, {
        badges: [
          { text: "Work", color: "blue" },
          { text: "Personal", color: "green" },
        ],
      });
    });

    test("rejects badges with invalid color at protocol level", async () => {
      // Note: Protocol-level validation catches invalid badge color before reaching handler
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // First select the vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Try to update config with invalid badge color
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "update_vault_config",
          config: {
            badges: [{ text: "Invalid", color: "pink" }],
          },
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });

    test("rejects badges exceeding max count (5) at protocol level", async () => {
      // Note: Protocol-level validation catches too many badges before reaching handler
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // First select the vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Try to update config with too many badges
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "update_vault_config",
          config: {
            badges: [
              { text: "One", color: "blue" },
              { text: "Two", color: "green" },
              { text: "Three", color: "red" },
              { text: "Four", color: "yellow" },
              { text: "Five", color: "purple" },
              { text: "Six", color: "orange" },
            ],
          },
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VALIDATION_ERROR");
      }
    });

    test("accepts empty config (all defaults)", async () => {
      const vault = createMockVault();
      mockGetVaultById.mockResolvedValue(vault);
      mockSaveVaultConfig.mockResolvedValue({ success: true });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      // First select the vault
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({ type: "select_vault", vaultId: "test-vault" })
      );

      // Update with empty config
      await handler.onMessage(
        ws as unknown as Parameters<typeof handler.onMessage>[0],
        JSON.stringify({
          type: "update_vault_config",
          config: {},
        })
      );

      const message = ws.getLastMessage();
      expect(message?.type).toBe("config_updated");
      if (message?.type === "config_updated") {
        expect(message.success).toBe(true);
      }
      expect(mockSaveVaultConfig).toHaveBeenCalledWith(vault.path, {});
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

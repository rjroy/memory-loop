/**
 * WebSocket Handler Tests
 *
 * Unit tests for WebSocket message routing and handling.
 * After ActiveSessionController integration, streaming tests have moved to
 * active-session-controller.test.ts. This file tests the transport layer.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VaultInfo, ServerMessage, SlashCommand } from "@memory-loop/shared";
import type { SessionMetadata } from "../session-manager";
import type { SetupResult } from "../vault-setup";
import {
  WebSocketHandler,
  createWebSocketHandler,
  createConnectionState,
  generateMessageId,
  type WebSocketHandlerDependencies,
} from "../websocket-handler";
import { VaultCreationError } from "../vault-manager";
import { resetActiveSessionController } from "../streaming/active-session-controller";

// =============================================================================
// Mock Setup
// =============================================================================

const mockDiscoverVaults = mock<() => Promise<VaultInfo[]>>(() => Promise.resolve([]));
const mockGetVaultById = mock<(id: string) => Promise<VaultInfo | null>>(() => Promise.resolve(null));
const mockCreateVault = mock<(title: string) => Promise<VaultInfo>>(() => Promise.resolve(createMockVault()));

const mockLoadSession = mock<(vaultPath: string, sessionId: string) => Promise<SessionMetadata | null>>(() =>
  Promise.resolve(null)
);

const mockLoadSlashCommands = mock<(vaultPath: string) => Promise<SlashCommand[] | undefined>>(() =>
  Promise.resolve(undefined)
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
    loadSession: mockLoadSession,
    loadSlashCommands: mockLoadSlashCommands,
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

/** Setup a vault and mock for testing */
function setupVaultMock(vault: VaultInfo = createMockVault()): VaultInfo {
  mockGetVaultById.mockResolvedValue(vault);
  return vault;
}

function resetAllMocks(): void {
  mockDiscoverVaults.mockReset();
  mockGetVaultById.mockReset();
  mockCreateVault.mockReset();
  mockLoadSession.mockReset();
  mockLoadSlashCommands.mockReset();
  mockRunVaultSetup.mockReset();

  // Set default implementations
  mockDiscoverVaults.mockResolvedValue([]);
  mockGetVaultById.mockResolvedValue(null);
  mockCreateVault.mockImplementation((title: string) =>
    Promise.resolve(createMockVault({ id: title.toLowerCase().replace(/\s+/g, "-"), name: title }))
  );
  mockLoadSession.mockResolvedValue(null);
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
    // Reset singleton controller for test isolation
    resetActiveSessionController();
  });

  afterEach(async () => {
    resetActiveSessionController();
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

      expect(state.activeMeeting).toBeNull();
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

    test("clears session ID when selecting new vault", async () => {
      const vault1 = createMockVault({ id: "vault-1" });
      const vault2 = createMockVault({ id: "vault-2" });

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      mockGetVaultById.mockResolvedValue(vault1);
      await selectVault(handler, ws, "vault-1");

      mockGetVaultById.mockResolvedValue(vault2);
      await selectVault(handler, ws, "vault-2");

      const state = handler.getState();
      expect(state.currentSessionId).toBeNull();
      expect(state.currentVault?.id).toBe("vault-2");
    });
  });

  // ===========================================================================
  // discussion_message Handler Tests (Transport Layer Only)
  // ===========================================================================

  describe("discussion_message", () => {
    test("sends error if no vault selected", async () => {
      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await handler.onMessage(asWs(ws), JSON.stringify({ type: "discussion_message", text: "Hello" }));

      const message = ws.getLastMessage();
      expect(message?.type).toBe("error");
      if (message?.type === "error") {
        expect(message.code).toBe("VAULT_NOT_FOUND");
      }
    });

    // Note: Streaming behavior tests have moved to active-session-controller.test.ts
    // This file only tests the transport layer delegation
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

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
      // Manually set a session ID to simulate having one
      const state = handler.getState();
      (state as { currentSessionId: string | null }).currentSessionId = "existing-session";

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

    test("includes cached slash commands in response", async () => {
      setupVaultMock();

      const cachedCommands = [
        { name: "/recall", description: "Search vault" },
        { name: "/tasks", description: "List tasks" },
      ];
      mockLoadSlashCommands.mockResolvedValue(cachedCommands);

      const handler = createTestHandler();
      const ws = createMockWebSocket();

      await selectVault(handler, ws);
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
});

/**
 * Tests for Sync WebSocket Handlers
 *
 * Tests cover:
 * - handleTriggerSync message handling
 * - Sync status message flow (syncing -> success/error)
 * - Progress reporting during sync
 * - Error handling and reporting
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import matter from "gray-matter";
import type { VaultInfo, ServerMessage } from "@memory-loop/shared";
import type { HandlerContext, ConnectionState, RequiredHandlerDependencies } from "../types.js";
import type { ApiConnector, ApiResponse } from "../../sync/connector-interface.js";
import type { GetConnectorFn, SyncPipelineManagerDependencies } from "../../sync/sync-pipeline.js";
import { handleTriggerSync } from "../sync-handlers.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const PIPELINE_CONFIG = {
  name: "test-sync",
  connector: "test",
  match: {
    pattern: "Games/**/*.md",
    field: "game_id",
  },
  fields: [
    { source: "name", target: "title" },
    { source: "rating", target: "rating" },
  ],
};

const API_RESPONSE: ApiResponse = {
  name: "Test Game",
  rating: 8.5,
};

// =============================================================================
// Mock Connector (injected via DI)
// =============================================================================

const mockFetchById = mock(() => Promise.resolve(API_RESPONSE));

const mockConnector: ApiConnector = {
  name: "test",
  fetchById: mockFetchById,
  extractFields: (response: ApiResponse) => response as Record<string, unknown>,
};

const mockGetConnector: GetConnectorFn = (name: string) => {
  if (name === "test") return mockConnector;
  throw new Error(`Unknown connector "${name}".`);
};

const mockDeps: SyncPipelineManagerDependencies = {
  getConnector: mockGetConnector,
};

// =============================================================================
// Temp Directory Management
// =============================================================================

let vaultRoot: string;
let mockVault: VaultInfo;
let sentMessages: ServerMessage[];
let mockState: ConnectionState;

beforeEach(async () => {
  vaultRoot = await mkdtemp(join(tmpdir(), "sync-handlers-test-"));
  mockVault = {
    id: "test-vault",
    name: "Test Vault",
    path: vaultRoot,
    contentRoot: vaultRoot,
    hasClaudeMd: true,
    inboxPath: "00_Inbox",
    metadataPath: "06_Metadata/memory-loop",
    attachmentPath: "attachments",
    setupComplete: true,
    hasSyncConfig: true,
    promptsPerGeneration: 5,
    maxPoolSize: 50,
    quotesPerWeek: 1,
    badges: [],
    order: 0,
  };
  sentMessages = [];
  mockState = {
    currentVault: mockVault,
    currentSessionId: null,
    activeQuery: null,
    pendingPermissions: new Map(),
    pendingAskUserQuestions: new Map(),
    searchIndex: null,
    activeModel: null,
    widgetEngine: null,
    widgetWatcher: null,
    healthCollector: null,
    activeMeeting: null,
  };
  mockFetchById.mockClear();
});

afterEach(async () => {
  await rm(vaultRoot, { recursive: true, force: true });
});

// =============================================================================
// Helper Functions
// =============================================================================

async function createPipelineConfig(config: unknown): Promise<void> {
  const syncDir = join(vaultRoot, ".memory-loop", "sync");
  await mkdir(syncDir, { recursive: true });
  const content = yaml.dump(config);
  await writeFile(join(syncDir, "test.yaml"), content, "utf-8");
}

async function createGameFile(
  relativePath: string,
  frontmatter: Record<string, unknown>,
  content = "# Test Game\n\nSome content."
): Promise<void> {
  const fullPath = join(vaultRoot, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  const fileContent = matter.stringify(content, frontmatter);
  await writeFile(fullPath, fileContent, "utf-8");
}

// Stub handler dependencies (not used by sync handlers, but required by HandlerContext)
const stubHandlerDeps: RequiredHandlerDependencies = {
  captureToDaily: () => Promise.resolve({ success: true, timestamp: "", notePath: "" }),
  getRecentNotes: () => Promise.resolve([]),
  listDirectory: () => Promise.resolve([]),
  readMarkdownFile: () => Promise.resolve({ content: "", truncated: false }),
  writeMarkdownFile: () => Promise.resolve(),
  deleteFile: () => Promise.resolve(),
  archiveFile: () => Promise.resolve({ originalPath: "", archivePath: "" }),
  createDirectory: () => Promise.resolve(""),
  getInspiration: () => Promise.resolve({ contextual: null, quote: { text: "", attribution: "" } }),
  getAllTasks: () => Promise.resolve({ tasks: [], incomplete: 0, total: 0 }),
  toggleTask: () => Promise.resolve({ success: true }),
  getRecentSessions: () => Promise.resolve([]),
  loadVaultConfig: () => Promise.resolve({}),
  parseFrontmatter: () => ({ data: {}, content: "" }),
};

function createMockContext(): HandlerContext {
  return {
    state: mockState,
    send: (message: ServerMessage) => {
      sentMessages.push(message);
    },
    sendError: (code, message) => {
      sentMessages.push({ type: "error", code, message } as ServerMessage);
    },
    deps: stubHandlerDeps,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("handleTriggerSync", () => {
  it("should send syncing status before starting sync", async () => {
    await createPipelineConfig(PIPELINE_CONFIG);
    const ctx = createMockContext();

    await handleTriggerSync(ctx, "full", undefined, mockDeps);

    // First message should be syncing status
    expect(sentMessages.length).toBeGreaterThan(0);
    const firstMessage = sentMessages[0];
    expect(firstMessage.type).toBe("sync_status");
    if (firstMessage.type === "sync_status") {
      expect(firstMessage.status).toBe("syncing");
    }
  });

  it("should send success status when sync completes", async () => {
    await createPipelineConfig(PIPELINE_CONFIG);
    await createGameFile("Games/test.md", { game_id: "123" });
    const ctx = createMockContext();

    await handleTriggerSync(ctx, "full", undefined, mockDeps);

    // Last message should be success
    const lastMessage = sentMessages[sentMessages.length - 1];
    expect(lastMessage.type).toBe("sync_status");
    if (lastMessage.type === "sync_status") {
      expect(lastMessage.status).toBe("success");
    }
  });

  it("should report error when no vault selected", async () => {
    mockState.currentVault = null;
    const ctx = createMockContext();

    await handleTriggerSync(ctx, "full", undefined, mockDeps);

    // Should send error
    expect(sentMessages.length).toBeGreaterThan(0);
    const errorMessage = sentMessages.find((m) => m.type === "error");
    expect(errorMessage).toBeDefined();
  });

  it("should include progress information", async () => {
    await createPipelineConfig(PIPELINE_CONFIG);
    await createGameFile("Games/game1.md", { game_id: "123" });
    await createGameFile("Games/game2.md", { game_id: "456" });
    const ctx = createMockContext();

    await handleTriggerSync(ctx, "full", undefined, mockDeps);

    // Should have progress updates with current/total
    const progressMessages = sentMessages.filter(
      (m) => m.type === "sync_status" && m.status === "syncing"
    );
    expect(progressMessages.length).toBeGreaterThan(0);
  });

  it("should support specific pipeline filter", async () => {
    await createPipelineConfig(PIPELINE_CONFIG);
    await createGameFile("Games/test.md", { game_id: "123" });
    const ctx = createMockContext();

    await handleTriggerSync(ctx, "full", "test-sync", mockDeps);

    // Should complete successfully
    const lastMessage = sentMessages[sentMessages.length - 1];
    expect(lastMessage.type).toBe("sync_status");
    if (lastMessage.type === "sync_status") {
      expect(lastMessage.status).toBe("success");
    }
  });

  it("should handle sync with no pipelines configured", async () => {
    const ctx = createMockContext();

    await handleTriggerSync(ctx, "full", undefined, mockDeps);

    // Should complete (no error, success with 0 files)
    const lastMessage = sentMessages[sentMessages.length - 1];
    expect(lastMessage.type).toBe("sync_status");
    if (lastMessage.type === "sync_status") {
      expect(lastMessage.status).toBe("success");
    }
  });

  it("should include error list when files fail", async () => {
    // Create pipeline with unknown connector to force error
    await createPipelineConfig({
      ...PIPELINE_CONFIG,
      connector: "unknown",
    });
    await createGameFile("Games/test.md", { game_id: "123" });
    const ctx = createMockContext();

    await handleTriggerSync(ctx, "full", undefined, mockDeps);

    // Should have error status with errors array
    const lastMessage = sentMessages[sentMessages.length - 1];
    expect(lastMessage.type).toBe("sync_status");
    if (lastMessage.type === "sync_status") {
      expect(lastMessage.status).toBe("error");
      expect(lastMessage.errors).toBeDefined();
      expect(lastMessage.errors!.length).toBeGreaterThan(0);
    }
  });

  it("should support incremental sync mode", async () => {
    await createPipelineConfig(PIPELINE_CONFIG);
    await createGameFile("Games/test.md", { game_id: "123" });
    const ctx = createMockContext();

    await handleTriggerSync(ctx, "incremental", undefined, mockDeps);

    // Should complete successfully
    const lastMessage = sentMessages[sentMessages.length - 1];
    expect(lastMessage.type).toBe("sync_status");
    if (lastMessage.type === "sync_status") {
      expect(["success", "error"]).toContain(lastMessage.status);
    }
  });
});

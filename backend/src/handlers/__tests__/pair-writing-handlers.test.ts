/**
 * Tests for Pair Writing WebSocket Handlers
 *
 * Tests cover:
 * - handleQuickAction message handling
 * - Vault selection validation
 * - Path validation within vault
 * - Prompt building and session creation
 * - Streaming event handling
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VaultInfo, ServerMessage, QuickActionRequestMessage } from "@memory-loop/shared";
import type { HandlerContext, ConnectionState, RequiredHandlerDependencies } from "../types.js";
import { handleQuickAction, type QueryFunction } from "../pair-writing-handlers.js";

// =============================================================================
// Test Fixtures
// =============================================================================

let tempDir: string;
let mockVault: VaultInfo;
let sentMessages: ServerMessage[];
let sentErrors: Array<{ code: string; message: string }>;
let mockState: ConnectionState;

beforeEach(async () => {
  // Create a real temp directory for path validation tests
  tempDir = await mkdtemp(join(tmpdir(), "pair-writing-test-"));

  // Create test directory structure
  await mkdir(join(tempDir, "notes"), { recursive: true });
  await writeFile(join(tempDir, "notes", "test-file.md"), "# Test File\n\nSome content here.");
  await writeFile(join(tempDir, "CLAUDE.md"), "# Test Vault");

  mockVault = {
    id: "test-vault",
    name: "Test Vault",
    path: tempDir,
    contentRoot: tempDir,
    hasClaudeMd: true,
    inboxPath: "00_Inbox",
    metadataPath: "06_Metadata/memory-loop",
    attachmentPath: "attachments",
    setupComplete: true,
    promptsPerGeneration: 5,
    maxPoolSize: 50,
    quotesPerWeek: 1,
    badges: [],
    order: 0,
  };
  sentMessages = [];
  sentErrors = [];
  mockState = {
    currentVault: mockVault,
    currentSessionId: null,
    activeQuery: null,
    pendingPermissions: new Map(),
    pendingAskUserQuestions: new Map(),
    searchIndex: null,
    activeModel: null,
    cumulativeTokens: 0,
    contextWindow: null,
    healthCollector: null,
    activeMeeting: null,
  };
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// =============================================================================
// Helper Functions
// =============================================================================

function createMockDeps(): RequiredHandlerDependencies {
  return {
    captureToDaily: () => Promise.resolve({ success: true, timestamp: "", notePath: "" }),
    getRecentNotes: () => Promise.resolve([]),
    listDirectory: () => Promise.resolve([]),
    readMarkdownFile: () => Promise.resolve({ content: "", truncated: false }),
    writeMarkdownFile: () => Promise.resolve(),
    deleteFile: () => Promise.resolve(),
    getDirectoryContents: () => Promise.resolve({ files: [], directories: [], totalFiles: 0, totalDirectories: 0, truncated: false }),
    deleteDirectory: () => Promise.resolve({ path: "", filesDeleted: 0, directoriesDeleted: 0 }),
    archiveFile: () => Promise.resolve({ originalPath: "", archivePath: "" }),
    createDirectory: () => Promise.resolve(""),
    createFile: () => Promise.resolve(""),
    renameFile: () => Promise.resolve({ oldPath: "", newPath: "" }),
    moveFile: () => Promise.resolve({ oldPath: "", newPath: "", isDirectory: false }),
    updateReferences: () => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }),
    getInspiration: () => Promise.resolve({ contextual: null, quote: { text: "", attribution: "" } }),
    getAllTasks: () => Promise.resolve({ tasks: [], incomplete: 0, total: 0 }),
    toggleTask: () => Promise.resolve({ success: true }),
    getRecentSessions: () => Promise.resolve([]),
    resumeSession: () => Promise.resolve({ sessionId: "", events: (async function* () {})(), interrupt: async () => {}, supportedCommands: () => Promise.resolve([]) }),
    appendMessage: () => Promise.resolve(),
    loadVaultConfig: () => Promise.resolve({}),
  };
}

function createMockContext(state: ConnectionState = mockState): HandlerContext {
  return {
    state,
    send: (message: ServerMessage) => {
      sentMessages.push(message);
    },
    sendError: (code, message) => {
      sentErrors.push({ code, message });
    },
    deps: createMockDeps(),
  };
}

function createMockRequest(overrides: Partial<QuickActionRequestMessage> = {}): QuickActionRequestMessage {
  return {
    type: "quick_action_request",
    action: "tighten",
    selection: "This is some text that needs to be tightened.",
    contextBefore: "The previous paragraph sets up context.",
    contextAfter: "The following paragraph continues the thought.",
    filePath: "notes/test-file.md",
    selectionStartLine: 10,
    selectionEndLine: 12,
    totalLines: 50,
    ...overrides,
  };
}

/**
 * Creates a mock query function that simulates SDK events.
 */
function createMockQueryFn(events: Array<{
  type: string;
  [key: string]: unknown;
}>): QueryFunction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (): any => {
    // eslint-disable-next-line @typescript-eslint/require-await
    async function* generator() {
      for (const event of events) {
        yield event;
      }
    }
    // Return a query result that matches the SDK's interface
    const gen = generator();
    return Object.assign(gen, {
      interrupt: () => Promise.resolve(),
      supportedCommands: () => Promise.resolve([]),
    });
  };
}

// =============================================================================
// handleQuickAction Tests - Validation
// =============================================================================

describe("handleQuickAction - validation", () => {
  it("requires vault to be selected", async () => {
    const ctx = createMockContext({
      ...mockState,
      currentVault: null,
    });

    await handleQuickAction(ctx, createMockRequest());

    expect(sentErrors.length).toBe(1);
    const error = sentErrors[0];
    expect(error).toBeDefined();
    expect(error?.code).toBe("VAULT_NOT_FOUND");
    expect(error?.message).toContain("No vault selected");
  });

  it("validates action type", async () => {
    const ctx = createMockContext();
    const request = createMockRequest({
      action: "invalid" as "tighten",
    });

    await handleQuickAction(ctx, request);

    expect(sentErrors.length).toBe(1);
    const error = sentErrors[0];
    expect(error).toBeDefined();
    expect(error?.code).toBe("VALIDATION_ERROR");
    expect(error?.message).toContain("Invalid action type");
  });

  it("validates selection is not empty", async () => {
    const ctx = createMockContext();
    const request = createMockRequest({
      selection: "",
    });

    // Selection validation happens before path validation, no mock needed
    await handleQuickAction(ctx, request);

    expect(sentErrors.length).toBe(1);
    const error = sentErrors[0];
    expect(error).toBeDefined();
    expect(error?.code).toBe("VALIDATION_ERROR");
    expect(error?.message).toContain("Selection is required");
  });

  it("rejects path traversal attempts", async () => {
    const ctx = createMockContext();
    const request = createMockRequest({
      filePath: "../../../etc/passwd",
    });

    await handleQuickAction(ctx, request);

    expect(sentErrors.length).toBe(1);
    const error = sentErrors[0];
    expect(error).toBeDefined();
    expect(error?.code).toBe("PATH_TRAVERSAL");
    expect(error?.message).toContain("not within vault");
  });
});

// =============================================================================
// handleQuickAction Tests - Streaming
// =============================================================================

describe("handleQuickAction - streaming", () => {
  it("sends response_start at beginning", async () => {
    const ctx = createMockContext();
    const request = createMockRequest();

    // Mock SDK with minimal events
    const mockQueryFn = createMockQueryFn([
      { type: "result", subtype: "success", usage: { input_tokens: 100, output_tokens: 50 }, modelUsage: {} },
    ]);

    await handleQuickAction(ctx, request, { queryFn: mockQueryFn });

    const startMsg = sentMessages.find((m) => m.type === "response_start");
    expect(startMsg).toBeDefined();
    expect(startMsg?.type).toBe("response_start");
  });

  it("sends response_end at completion", async () => {
    const ctx = createMockContext();
    const request = createMockRequest();

    const mockQueryFn = createMockQueryFn([
      { type: "result", subtype: "success", usage: { input_tokens: 100, output_tokens: 50 }, modelUsage: {} },
    ]);

    await handleQuickAction(ctx, request, { queryFn: mockQueryFn });

    const endMsg = sentMessages.find((m) => m.type === "response_end");
    expect(endMsg).toBeDefined();
    expect(endMsg?.type).toBe("response_end");
  });

  it("streams text deltas as response_chunk", async () => {
    const ctx = createMockContext();
    const request = createMockRequest();

    const mockQueryFn = createMockQueryFn([
      {
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
      },
      {
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Tightened" } },
      },
      {
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " the text." } },
      },
      {
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      },
      { type: "result", subtype: "success", usage: { input_tokens: 100, output_tokens: 50 }, modelUsage: {} },
    ]);

    await handleQuickAction(ctx, request, { queryFn: mockQueryFn });

    const chunks = sentMessages.filter((m) => m.type === "response_chunk");
    expect(chunks.length).toBe(2);
    expect((chunks[0] as { content: string }).content).toBe("Tightened");
    expect((chunks[1] as { content: string }).content).toBe(" the text.");
  });

  it("streams tool_start and tool_end events", async () => {
    const ctx = createMockContext();
    const request = createMockRequest();

    const mockQueryFn = createMockQueryFn([
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tool_123", name: "Read" },
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"file_path":"test.md"}' },
        },
      },
      {
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      },
      {
        type: "user",
        session_id: "test",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tool_123", content: "File content here" },
          ],
        },
      },
      { type: "result", subtype: "success", usage: { input_tokens: 100, output_tokens: 50 }, modelUsage: {} },
    ]);

    await handleQuickAction(ctx, request, { queryFn: mockQueryFn });

    const toolStart = sentMessages.find((m) => m.type === "tool_start");
    expect(toolStart).toBeDefined();
    expect((toolStart as { toolName: string }).toolName).toBe("Read");
    expect((toolStart as { toolUseId: string }).toolUseId).toBe("tool_123");

    const toolInput = sentMessages.find((m) => m.type === "tool_input");
    expect(toolInput).toBeDefined();
    expect((toolInput as { toolUseId: string }).toolUseId).toBe("tool_123");

    const toolEnd = sentMessages.find((m) => m.type === "tool_end");
    expect(toolEnd).toBeDefined();
    expect((toolEnd as { toolUseId: string }).toolUseId).toBe("tool_123");
  });
});

// =============================================================================
// handleQuickAction Tests - Error Handling
// =============================================================================

describe("handleQuickAction - error handling", () => {
  it("sends SDK_ERROR on query failure", async () => {
    const ctx = createMockContext();
    const request = createMockRequest();

    // Mock SDK that throws an error
    const mockQueryFn: QueryFunction = () => {
      throw new Error("SDK connection failed");
    };

    await handleQuickAction(ctx, request, { queryFn: mockQueryFn });

    expect(sentErrors.length).toBe(1);
    const error = sentErrors[0];
    expect(error).toBeDefined();
    expect(error?.code).toBe("SDK_ERROR");
    expect(error?.message).toContain("SDK connection failed");
  });

  it("handles empty events gracefully", async () => {
    const ctx = createMockContext();
    const request = createMockRequest();

    const mockQueryFn = createMockQueryFn([]);

    await handleQuickAction(ctx, request, { queryFn: mockQueryFn });

    // Should still send response_start and response_end
    const startMsg = sentMessages.find((m) => m.type === "response_start");
    const endMsg = sentMessages.find((m) => m.type === "response_end");
    expect(startMsg).toBeDefined();
    expect(endMsg).toBeDefined();
  });
});

// =============================================================================
// handleQuickAction Tests - Action Types
// =============================================================================

describe("handleQuickAction - action types", () => {
  const actions: Array<"tighten" | "embellish" | "correct" | "polish"> = [
    "tighten",
    "embellish",
    "correct",
    "polish",
  ];

  for (const action of actions) {
    it(`accepts ${action} action type`, async () => {
      const ctx = createMockContext();
      const request = createMockRequest({ action });

      const mockQueryFn = createMockQueryFn([
        { type: "result", subtype: "success", usage: { input_tokens: 100, output_tokens: 50 }, modelUsage: {} },
      ]);

      await handleQuickAction(ctx, request, { queryFn: mockQueryFn });

      // No validation errors for valid action types
      expect(sentErrors.filter((e) => e.code === "VALIDATION_ERROR")).toHaveLength(0);

      // Should have sent response_start and response_end
      const startMsg = sentMessages.find((m) => m.type === "response_start");
      const endMsg = sentMessages.find((m) => m.type === "response_end");
      expect(startMsg).toBeDefined();
      expect(endMsg).toBeDefined();
    });
  }
});

// =============================================================================
// handleQuickAction Tests - Context Usage
// =============================================================================

describe("handleQuickAction - context usage", () => {
  it("calculates context usage from result event", async () => {
    const ctx = createMockContext();
    const request = createMockRequest();

    const mockQueryFn = createMockQueryFn([
      {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 1000, output_tokens: 500 },
        modelUsage: {
          "claude-sonnet-4-20250514": { contextWindow: 200000 },
        },
      },
    ]);

    await handleQuickAction(ctx, request, { queryFn: mockQueryFn });

    const endMsg = sentMessages.find((m) => m.type === "response_end") as {
      type: "response_end";
      contextUsage?: number;
    };
    expect(endMsg).toBeDefined();
    // 1500 / 200000 * 100 = 0.75%, rounds to 1%
    expect(endMsg.contextUsage).toBeDefined();
    expect(endMsg.contextUsage).toBeLessThanOrEqual(100);
  });

  it("includes durationMs in response_end", async () => {
    const ctx = createMockContext();
    const request = createMockRequest();

    const mockQueryFn = createMockQueryFn([
      { type: "result", subtype: "success", usage: { input_tokens: 100, output_tokens: 50 }, modelUsage: {} },
    ]);

    await handleQuickAction(ctx, request, { queryFn: mockQueryFn });

    const endMsg = sentMessages.find((m) => m.type === "response_end") as {
      type: "response_end";
      durationMs?: number;
    };
    expect(endMsg).toBeDefined();
    expect(endMsg.durationMs).toBeDefined();
    expect(endMsg.durationMs).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Tests for Browser WebSocket Handlers
 *
 * Tests cover:
 * - handleCreateDirectory message handling
 * - Success response with created path
 * - Error handling for various failure modes
 * - Vault selection validation
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { VaultInfo, ServerMessage } from "@memory-loop/shared";
import type { HandlerContext, ConnectionState, RequiredHandlerDependencies } from "../types.js";
import { handleCreateDirectory } from "../browser-handlers.js";

// =============================================================================
// Test Fixtures
// =============================================================================

let mockVault: VaultInfo;
let sentMessages: ServerMessage[];
let mockState: ConnectionState;

beforeEach(() => {
  mockVault = {
    id: "test-vault",
    name: "Test Vault",
    path: "/test/vault",
    contentRoot: "/test/vault",
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
});

// =============================================================================
// Helper Functions
// =============================================================================

function createMockDeps(
  createDirectoryFn: (vaultPath: string, parentPath: string, name: string) => Promise<string>
): RequiredHandlerDependencies {
  return {
    captureToDaily: () => Promise.resolve({ success: true, timestamp: "", notePath: "" }),
    getRecentNotes: () => Promise.resolve([]),
    listDirectory: () => Promise.resolve([]),
    readMarkdownFile: () => Promise.resolve({ content: "", truncated: false }),
    writeMarkdownFile: () => Promise.resolve(),
    deleteFile: () => Promise.resolve(),
    archiveFile: () => Promise.resolve({ originalPath: "", archivePath: "" }),
    createDirectory: createDirectoryFn,
    createFile: () => Promise.resolve(""),
    getInspiration: () => Promise.resolve({ contextual: null, quote: { text: "", attribution: "" } }),
    getAllTasks: () => Promise.resolve({ tasks: [], incomplete: 0, total: 0 }),
    toggleTask: () => Promise.resolve({ success: true }),
    getRecentSessions: () => Promise.resolve([]),
    loadVaultConfig: () => Promise.resolve({}),
    parseFrontmatter: () => ({ data: {}, content: "" }),
  };
}

function createMockContext(
  deps: RequiredHandlerDependencies,
  state: ConnectionState = mockState
): HandlerContext {
  return {
    state,
    send: (message: ServerMessage) => {
      sentMessages.push(message);
    },
    sendError: (code, message) => {
      sentMessages.push({ type: "error", code, message } as ServerMessage);
    },
    deps,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("handleCreateDirectory", () => {
  it("should send directory_created message on success", async () => {
    const mockCreateDirectory = mock(() => Promise.resolve("docs/new-folder"));
    const ctx = createMockContext(createMockDeps(mockCreateDirectory));

    await handleCreateDirectory(ctx, "docs", "new-folder");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("directory_created");
    if (sentMessages[0].type === "directory_created") {
      expect(sentMessages[0].path).toBe("docs/new-folder");
    }
  });

  it("should call createDirectory with correct parameters", async () => {
    const mockCreateDirectory = mock(() => Promise.resolve("parent/child"));
    const ctx = createMockContext(createMockDeps(mockCreateDirectory));

    await handleCreateDirectory(ctx, "parent", "child");

    expect(mockCreateDirectory).toHaveBeenCalledTimes(1);
    expect(mockCreateDirectory).toHaveBeenCalledWith("/test/vault", "parent", "child");
  });

  it("should handle root-level directory creation", async () => {
    const mockCreateDirectory = mock(() => Promise.resolve("new-folder"));
    const ctx = createMockContext(createMockDeps(mockCreateDirectory));

    await handleCreateDirectory(ctx, "", "new-folder");

    expect(mockCreateDirectory).toHaveBeenCalledWith("/test/vault", "", "new-folder");
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("directory_created");
    if (sentMessages[0].type === "directory_created") {
      expect(sentMessages[0].path).toBe("new-folder");
    }
  });

  it("should send error when no vault is selected", async () => {
    const mockCreateDirectory = mock(() => Promise.resolve("test"));
    const noVaultState: ConnectionState = {
      ...mockState,
      currentVault: null,
    };
    const ctx = createMockContext(createMockDeps(mockCreateDirectory), noVaultState);

    await handleCreateDirectory(ctx, "parent", "child");

    // Should send error and not call createDirectory
    expect(mockCreateDirectory).not.toHaveBeenCalled();
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
  });

  it("should handle InvalidDirectoryNameError (VALIDATION_ERROR)", async () => {
    const error = new Error("Invalid name");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "VALIDATION_ERROR" });
    const mockCreateDirectory = mock(() => Promise.reject(error));
    const ctx = createMockContext(createMockDeps(mockCreateDirectory));

    await handleCreateDirectory(ctx, "parent", "invalid name!");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("VALIDATION_ERROR");
    }
  });

  it("should handle DirectoryExistsError (VALIDATION_ERROR)", async () => {
    const error = new Error("Directory already exists");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "VALIDATION_ERROR" });
    const mockCreateDirectory = mock(() => Promise.reject(error));
    const ctx = createMockContext(createMockDeps(mockCreateDirectory));

    await handleCreateDirectory(ctx, "parent", "existing");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("VALIDATION_ERROR");
    }
  });

  it("should handle generic errors with INTERNAL_ERROR code", async () => {
    const mockCreateDirectory = mock(() => Promise.reject(new Error("Unexpected error")));
    const ctx = createMockContext(createMockDeps(mockCreateDirectory));

    await handleCreateDirectory(ctx, "parent", "child");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INTERNAL_ERROR");
      expect(sentMessages[0].message).toBe("Unexpected error");
    }
  });

  it("should handle non-Error objects in catch", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const mockCreateDirectory = mock(() => Promise.reject("string error"));
    const ctx = createMockContext(createMockDeps(mockCreateDirectory));

    await handleCreateDirectory(ctx, "parent", "child");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INTERNAL_ERROR");
      expect(sentMessages[0].message).toBe("Failed to create directory");
    }
  });

  it("should handle parent directory not found (DIRECTORY_NOT_FOUND)", async () => {
    const error = new Error("Parent directory not found");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "DIRECTORY_NOT_FOUND" });
    const mockCreateDirectory = mock(() => Promise.reject(error));
    const ctx = createMockContext(createMockDeps(mockCreateDirectory));

    await handleCreateDirectory(ctx, "nonexistent/parent", "child");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("DIRECTORY_NOT_FOUND");
    }
  });

  it("should handle PathSecurityError", async () => {
    const error = new Error("Path traversal detected");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "PATH_TRAVERSAL" });
    const mockCreateDirectory = mock(() => Promise.reject(error));
    const ctx = createMockContext(createMockDeps(mockCreateDirectory));

    await handleCreateDirectory(ctx, "../outside", "child");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("PATH_TRAVERSAL");
    }
  });
});

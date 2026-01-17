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
import { handleCreateDirectory, handleRenameFile, handleMoveFile, handleGetDirectoryContents, handleDeleteDirectory } from "../browser-handlers.js";
import type { RenameResult, MoveResult, DirectoryContentsResult, DeleteDirectoryResult } from "../../file-browser.js";
import type { ReferenceUpdateResult } from "../../reference-updater.js";

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
    cumulativeTokens: 0,
    contextWindow: null,
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
    getDirectoryContents: () => Promise.resolve({ files: [], directories: [], totalFiles: 0, totalDirectories: 0, truncated: false }),
    deleteDirectory: () => Promise.resolve({ path: "", filesDeleted: 0, directoriesDeleted: 0 }),
    archiveFile: () => Promise.resolve({ originalPath: "", archivePath: "" }),
    createDirectory: createDirectoryFn,
    createFile: () => Promise.resolve(""),
    renameFile: () => Promise.resolve({ oldPath: "", newPath: "" }),
    moveFile: () => Promise.resolve({ oldPath: "", newPath: "", isDirectory: false }),
    updateReferences: () => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }),
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

// =============================================================================
// handleRenameFile Tests
// =============================================================================

function createMockDepsWithRename(
  renameFn: (vaultPath: string, relativePath: string, newName: string) => Promise<RenameResult>,
  updateRefsFn: (vaultPath: string, oldPath: string, newPath: string, isDirectory: boolean) => Promise<ReferenceUpdateResult>
): RequiredHandlerDependencies {
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
    renameFile: renameFn,
    moveFile: () => Promise.resolve({ oldPath: "", newPath: "", isDirectory: false }),
    updateReferences: updateRefsFn,
    getInspiration: () => Promise.resolve({ contextual: null, quote: { text: "", attribution: "" } }),
    getAllTasks: () => Promise.resolve({ tasks: [], incomplete: 0, total: 0 }),
    toggleTask: () => Promise.resolve({ success: true }),
    getRecentSessions: () => Promise.resolve([]),
    loadVaultConfig: () => Promise.resolve({}),
    parseFrontmatter: () => ({ data: {}, content: "" }),
  };
}

describe("handleRenameFile", () => {
  it("should send file_renamed message on success", async () => {
    const mockRename = mock(() => Promise.resolve({ oldPath: "old-file.md", newPath: "new-file.md" }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 2, referencesUpdated: 5 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "old-file.md", "new-file");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("file_renamed");
    if (sentMessages[0].type === "file_renamed") {
      expect(sentMessages[0].oldPath).toBe("old-file.md");
      expect(sentMessages[0].newPath).toBe("new-file.md");
      expect(sentMessages[0].referencesUpdated).toBe(5);
    }
  });

  it("should call renameFile with correct parameters", async () => {
    const mockRename = mock(() => Promise.resolve({ oldPath: "docs/file.md", newPath: "docs/renamed.md" }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "docs/file.md", "renamed");

    expect(mockRename).toHaveBeenCalledTimes(1);
    expect(mockRename).toHaveBeenCalledWith("/test/vault", "docs/file.md", "renamed");
  });

  it("should call updateReferences after rename", async () => {
    const mockRename = mock(() => Promise.resolve({ oldPath: "old.md", newPath: "new.md" }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 1, referencesUpdated: 3 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "old.md", "new");

    expect(mockUpdateRefs).toHaveBeenCalledTimes(1);
    expect(mockUpdateRefs).toHaveBeenCalledWith("/test/vault", "old.md", "new.md", false);
  });

  it("should detect directory rename and pass isDirectory=true to updateReferences", async () => {
    const mockRename = mock(() => Promise.resolve({ oldPath: "OldFolder", newPath: "NewFolder" }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "OldFolder", "NewFolder");

    expect(mockUpdateRefs).toHaveBeenCalledWith("/test/vault", "OldFolder", "NewFolder", true);
  });

  it("should send error when no vault is selected", async () => {
    const mockRename = mock(() => Promise.resolve({ oldPath: "", newPath: "" }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const noVaultState: ConnectionState = {
      ...mockState,
      currentVault: null,
    };
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs), noVaultState);

    await handleRenameFile(ctx, "file.md", "new-name");

    expect(mockRename).not.toHaveBeenCalled();
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
  });

  it("should handle InvalidFileNameError (VALIDATION_ERROR)", async () => {
    const error = new Error("Invalid name");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "VALIDATION_ERROR" });
    const mockRename = mock(() => Promise.reject(error));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "file.md", "invalid name!");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("VALIDATION_ERROR");
    }
  });

  it("should handle FileNotFoundError", async () => {
    const error = new Error("File not found");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "FILE_NOT_FOUND" });
    const mockRename = mock(() => Promise.reject(error));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "nonexistent.md", "new-name");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("FILE_NOT_FOUND");
    }
  });

  it("should handle FileExistsError", async () => {
    const error = new Error("Destination already exists");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "VALIDATION_ERROR" });
    const mockRename = mock(() => Promise.reject(error));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "file.md", "existing");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("VALIDATION_ERROR");
    }
  });

  it("should handle PathTraversalError", async () => {
    const error = new Error("Path traversal detected");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "PATH_TRAVERSAL" });
    const mockRename = mock(() => Promise.reject(error));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "../outside.md", "new-name");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("PATH_TRAVERSAL");
    }
  });

  it("should handle generic errors with INTERNAL_ERROR code", async () => {
    const mockRename = mock(() => Promise.reject(new Error("Unexpected error")));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "file.md", "new-name");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INTERNAL_ERROR");
      expect(sentMessages[0].message).toBe("Unexpected error");
    }
  });

  it("should handle non-Error objects in catch", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const mockRename = mock(() => Promise.reject("string error"));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "file.md", "new-name");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INTERNAL_ERROR");
      expect(sentMessages[0].message).toBe("Failed to rename");
    }
  });

  it("should rename file in nested directory", async () => {
    const mockRename = mock(() => Promise.resolve({ oldPath: "docs/notes/file.md", newPath: "docs/notes/renamed.md" }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 3, referencesUpdated: 7 }));
    const ctx = createMockContext(createMockDepsWithRename(mockRename, mockUpdateRefs));

    await handleRenameFile(ctx, "docs/notes/file.md", "renamed");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("file_renamed");
    if (sentMessages[0].type === "file_renamed") {
      expect(sentMessages[0].oldPath).toBe("docs/notes/file.md");
      expect(sentMessages[0].newPath).toBe("docs/notes/renamed.md");
      expect(sentMessages[0].referencesUpdated).toBe(7);
    }
  });
});

// =============================================================================
// handleMoveFile Tests
// =============================================================================

function createMockDepsWithMove(
  moveFn: (vaultPath: string, sourcePath: string, destPath: string) => Promise<MoveResult>,
  updateRefsFn: (vaultPath: string, oldPath: string, newPath: string, isDirectory: boolean) => Promise<ReferenceUpdateResult>
): RequiredHandlerDependencies {
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
    moveFile: moveFn,
    updateReferences: updateRefsFn,
    getInspiration: () => Promise.resolve({ contextual: null, quote: { text: "", attribution: "" } }),
    getAllTasks: () => Promise.resolve({ tasks: [], incomplete: 0, total: 0 }),
    toggleTask: () => Promise.resolve({ success: true }),
    getRecentSessions: () => Promise.resolve([]),
    loadVaultConfig: () => Promise.resolve({}),
    parseFrontmatter: () => ({ data: {}, content: "" }),
  };
}

describe("handleMoveFile", () => {
  it("should send file_moved message on success", async () => {
    const mockMove = mock(() => Promise.resolve({ oldPath: "file.md", newPath: "Archive/file.md", isDirectory: false }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 2, referencesUpdated: 5 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "file.md", "Archive/file.md");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("file_moved");
    if (sentMessages[0].type === "file_moved") {
      expect(sentMessages[0].oldPath).toBe("file.md");
      expect(sentMessages[0].newPath).toBe("Archive/file.md");
      expect(sentMessages[0].referencesUpdated).toBe(5);
    }
  });

  it("should call moveFile with correct parameters", async () => {
    const mockMove = mock(() => Promise.resolve({ oldPath: "docs/file.md", newPath: "Projects/file.md", isDirectory: false }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "docs/file.md", "Projects/file.md");

    expect(mockMove).toHaveBeenCalledTimes(1);
    expect(mockMove).toHaveBeenCalledWith("/test/vault", "docs/file.md", "Projects/file.md");
  });

  it("should call updateReferences after move with isDirectory=false for files", async () => {
    const mockMove = mock(() => Promise.resolve({ oldPath: "old.md", newPath: "new/old.md", isDirectory: false }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 1, referencesUpdated: 3 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "old.md", "new/old.md");

    expect(mockUpdateRefs).toHaveBeenCalledTimes(1);
    expect(mockUpdateRefs).toHaveBeenCalledWith("/test/vault", "old.md", "new/old.md", false);
  });

  it("should call updateReferences with isDirectory=true for directories", async () => {
    const mockMove = mock(() => Promise.resolve({ oldPath: "OldFolder", newPath: "Archive/OldFolder", isDirectory: true }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 3, referencesUpdated: 10 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "OldFolder", "Archive/OldFolder");

    expect(mockUpdateRefs).toHaveBeenCalledWith("/test/vault", "OldFolder", "Archive/OldFolder", true);
  });

  it("should send error when no vault is selected", async () => {
    const mockMove = mock(() => Promise.resolve({ oldPath: "", newPath: "", isDirectory: false }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const noVaultState: ConnectionState = {
      ...mockState,
      currentVault: null,
    };
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs), noVaultState);

    await handleMoveFile(ctx, "file.md", "new-location/file.md");

    expect(mockMove).not.toHaveBeenCalled();
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
  });

  it("should handle FileNotFoundError", async () => {
    const error = new Error("File not found");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "FILE_NOT_FOUND" });
    const mockMove = mock(() => Promise.reject(error));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "nonexistent.md", "Archive/nonexistent.md");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("FILE_NOT_FOUND");
    }
  });

  it("should handle FileExistsError", async () => {
    const error = new Error("Destination already exists");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "VALIDATION_ERROR" });
    const mockMove = mock(() => Promise.reject(error));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "file.md", "existing/file.md");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("VALIDATION_ERROR");
    }
  });

  it("should handle DirectoryNotFoundError", async () => {
    const error = new Error("Parent directory not found");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "DIRECTORY_NOT_FOUND" });
    const mockMove = mock(() => Promise.reject(error));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "file.md", "nonexistent/path/file.md");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("DIRECTORY_NOT_FOUND");
    }
  });

  it("should handle PathTraversalError", async () => {
    const error = new Error("Path traversal detected");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "PATH_TRAVERSAL" });
    const mockMove = mock(() => Promise.reject(error));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "../outside.md", "Archive/outside.md");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("PATH_TRAVERSAL");
    }
  });

  it("should handle move-into-self error", async () => {
    const error = new Error("Cannot move directory into itself");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "VALIDATION_ERROR" });
    const mockMove = mock(() => Promise.reject(error));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "MyFolder", "MyFolder/SubFolder/MyFolder");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("VALIDATION_ERROR");
    }
  });

  it("should handle generic errors with INTERNAL_ERROR code", async () => {
    const mockMove = mock(() => Promise.reject(new Error("Unexpected error")));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "file.md", "new/file.md");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INTERNAL_ERROR");
      expect(sentMessages[0].message).toBe("Unexpected error");
    }
  });

  it("should handle non-Error objects in catch", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const mockMove = mock(() => Promise.reject("string error"));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 0, referencesUpdated: 0 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "file.md", "new/file.md");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INTERNAL_ERROR");
      expect(sentMessages[0].message).toBe("Failed to move");
    }
  });

  it("should move file from nested directory to vault root", async () => {
    const mockMove = mock(() => Promise.resolve({ oldPath: "docs/notes/file.md", newPath: "file.md", isDirectory: false }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 1, referencesUpdated: 2 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "docs/notes/file.md", "file.md");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("file_moved");
    if (sentMessages[0].type === "file_moved") {
      expect(sentMessages[0].oldPath).toBe("docs/notes/file.md");
      expect(sentMessages[0].newPath).toBe("file.md");
      expect(sentMessages[0].referencesUpdated).toBe(2);
    }
  });

  it("should move directory with many references updated", async () => {
    const mockMove = mock(() => Promise.resolve({ oldPath: "Projects/OldName", newPath: "Archive/OldName", isDirectory: true }));
    const mockUpdateRefs = mock(() => Promise.resolve({ filesModified: 15, referencesUpdated: 47 }));
    const ctx = createMockContext(createMockDepsWithMove(mockMove, mockUpdateRefs));

    await handleMoveFile(ctx, "Projects/OldName", "Archive/OldName");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("file_moved");
    if (sentMessages[0].type === "file_moved") {
      expect(sentMessages[0].referencesUpdated).toBe(47);
    }
  });
});

// =============================================================================
// handleGetDirectoryContents Tests
// =============================================================================

function createMockDepsWithGetDirContents(
  getDirContentsFn: (vaultPath: string, relativePath: string) => Promise<DirectoryContentsResult>
): RequiredHandlerDependencies {
  return {
    captureToDaily: () => Promise.resolve({ success: true, timestamp: "", notePath: "" }),
    getRecentNotes: () => Promise.resolve([]),
    listDirectory: () => Promise.resolve([]),
    readMarkdownFile: () => Promise.resolve({ content: "", truncated: false }),
    writeMarkdownFile: () => Promise.resolve(),
    deleteFile: () => Promise.resolve(),
    getDirectoryContents: getDirContentsFn,
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
    loadVaultConfig: () => Promise.resolve({}),
    parseFrontmatter: () => ({ data: {}, content: "" }),
  };
}

describe("handleGetDirectoryContents", () => {
  it("should send directory_contents message on success", async () => {
    const mockGetDirContents = mock(() => Promise.resolve({
      files: ["file1.md", "file2.md"],
      directories: ["subdir"],
      totalFiles: 2,
      totalDirectories: 1,
      truncated: false,
    }));
    const ctx = createMockContext(createMockDepsWithGetDirContents(mockGetDirContents));

    await handleGetDirectoryContents(ctx, "my-folder");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("directory_contents");
    if (sentMessages[0].type === "directory_contents") {
      expect(sentMessages[0].path).toBe("my-folder");
      expect(sentMessages[0].files).toEqual(["file1.md", "file2.md"]);
      expect(sentMessages[0].directories).toEqual(["subdir"]);
      expect(sentMessages[0].totalFiles).toBe(2);
      expect(sentMessages[0].totalDirectories).toBe(1);
      expect(sentMessages[0].truncated).toBe(false);
    }
  });

  it("should call getDirectoryContents with correct parameters", async () => {
    const mockGetDirContents = mock(() => Promise.resolve({
      files: [],
      directories: [],
      totalFiles: 0,
      totalDirectories: 0,
      truncated: false,
    }));
    const ctx = createMockContext(createMockDepsWithGetDirContents(mockGetDirContents));

    await handleGetDirectoryContents(ctx, "docs/notes");

    expect(mockGetDirContents).toHaveBeenCalledTimes(1);
    expect(mockGetDirContents).toHaveBeenCalledWith("/test/vault", "docs/notes");
  });

  it("should handle truncated results", async () => {
    const mockGetDirContents = mock(() => Promise.resolve({
      files: ["f1.md", "f2.md", "f3.md", "f4.md", "f5.md"],
      directories: ["d1", "d2", "d3", "d4", "d5"],
      totalFiles: 100,
      totalDirectories: 20,
      truncated: true,
    }));
    const ctx = createMockContext(createMockDepsWithGetDirContents(mockGetDirContents));

    await handleGetDirectoryContents(ctx, "large-folder");

    expect(sentMessages.length).toBe(1);
    if (sentMessages[0].type === "directory_contents") {
      expect(sentMessages[0].truncated).toBe(true);
      expect(sentMessages[0].totalFiles).toBe(100);
      expect(sentMessages[0].totalDirectories).toBe(20);
    }
  });

  it("should send error when no vault is selected", async () => {
    const mockGetDirContents = mock(() => Promise.resolve({
      files: [],
      directories: [],
      totalFiles: 0,
      totalDirectories: 0,
      truncated: false,
    }));
    const noVaultState: ConnectionState = {
      ...mockState,
      currentVault: null,
    };
    const ctx = createMockContext(createMockDepsWithGetDirContents(mockGetDirContents), noVaultState);

    await handleGetDirectoryContents(ctx, "some-folder");

    expect(mockGetDirContents).not.toHaveBeenCalled();
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
  });

  it("should handle DirectoryNotFoundError", async () => {
    const error = new Error("Directory not found");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "DIRECTORY_NOT_FOUND" });
    const mockGetDirContents = mock(() => Promise.reject(error));
    const ctx = createMockContext(createMockDepsWithGetDirContents(mockGetDirContents));

    await handleGetDirectoryContents(ctx, "nonexistent");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("DIRECTORY_NOT_FOUND");
    }
  });

  it("should handle InvalidFileTypeError (path is a file)", async () => {
    const error = new Error("Path is a file, not a directory");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "INVALID_FILE_TYPE" });
    const mockGetDirContents = mock(() => Promise.reject(error));
    const ctx = createMockContext(createMockDepsWithGetDirContents(mockGetDirContents));

    await handleGetDirectoryContents(ctx, "file.md");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INVALID_FILE_TYPE");
    }
  });

  it("should handle PathTraversalError", async () => {
    const error = new Error("Path traversal detected");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "PATH_TRAVERSAL" });
    const mockGetDirContents = mock(() => Promise.reject(error));
    const ctx = createMockContext(createMockDepsWithGetDirContents(mockGetDirContents));

    await handleGetDirectoryContents(ctx, "../outside");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("PATH_TRAVERSAL");
    }
  });

  it("should handle generic errors with INTERNAL_ERROR code", async () => {
    const mockGetDirContents = mock(() => Promise.reject(new Error("Unexpected error")));
    const ctx = createMockContext(createMockDepsWithGetDirContents(mockGetDirContents));

    await handleGetDirectoryContents(ctx, "folder");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INTERNAL_ERROR");
      expect(sentMessages[0].message).toBe("Unexpected error");
    }
  });

  it("should handle non-Error objects in catch", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const mockGetDirContents = mock(() => Promise.reject("string error"));
    const ctx = createMockContext(createMockDepsWithGetDirContents(mockGetDirContents));

    await handleGetDirectoryContents(ctx, "folder");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INTERNAL_ERROR");
      expect(sentMessages[0].message).toBe("Failed to get directory contents");
    }
  });
});

// =============================================================================
// handleDeleteDirectory Tests
// =============================================================================

function createMockDepsWithDeleteDir(
  deleteDirFn: (vaultPath: string, relativePath: string) => Promise<DeleteDirectoryResult>
): RequiredHandlerDependencies {
  return {
    captureToDaily: () => Promise.resolve({ success: true, timestamp: "", notePath: "" }),
    getRecentNotes: () => Promise.resolve([]),
    listDirectory: () => Promise.resolve([]),
    readMarkdownFile: () => Promise.resolve({ content: "", truncated: false }),
    writeMarkdownFile: () => Promise.resolve(),
    deleteFile: () => Promise.resolve(),
    getDirectoryContents: () => Promise.resolve({ files: [], directories: [], totalFiles: 0, totalDirectories: 0, truncated: false }),
    deleteDirectory: deleteDirFn,
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
    loadVaultConfig: () => Promise.resolve({}),
    parseFrontmatter: () => ({ data: {}, content: "" }),
  };
}

describe("handleDeleteDirectory", () => {
  it("should send directory_deleted message on success", async () => {
    const mockDeleteDir = mock(() => Promise.resolve({
      path: "my-folder",
      filesDeleted: 5,
      directoriesDeleted: 2,
    }));
    const ctx = createMockContext(createMockDepsWithDeleteDir(mockDeleteDir));

    await handleDeleteDirectory(ctx, "my-folder");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("directory_deleted");
    if (sentMessages[0].type === "directory_deleted") {
      expect(sentMessages[0].path).toBe("my-folder");
      expect(sentMessages[0].filesDeleted).toBe(5);
      expect(sentMessages[0].directoriesDeleted).toBe(2);
    }
  });

  it("should call deleteDirectory with correct parameters", async () => {
    const mockDeleteDir = mock(() => Promise.resolve({
      path: "docs/old-notes",
      filesDeleted: 0,
      directoriesDeleted: 0,
    }));
    const ctx = createMockContext(createMockDepsWithDeleteDir(mockDeleteDir));

    await handleDeleteDirectory(ctx, "docs/old-notes");

    expect(mockDeleteDir).toHaveBeenCalledTimes(1);
    expect(mockDeleteDir).toHaveBeenCalledWith("/test/vault", "docs/old-notes");
  });

  it("should handle empty directory deletion", async () => {
    const mockDeleteDir = mock(() => Promise.resolve({
      path: "empty-folder",
      filesDeleted: 0,
      directoriesDeleted: 0,
    }));
    const ctx = createMockContext(createMockDepsWithDeleteDir(mockDeleteDir));

    await handleDeleteDirectory(ctx, "empty-folder");

    expect(sentMessages.length).toBe(1);
    if (sentMessages[0].type === "directory_deleted") {
      expect(sentMessages[0].filesDeleted).toBe(0);
      expect(sentMessages[0].directoriesDeleted).toBe(0);
    }
  });

  it("should send error when no vault is selected", async () => {
    const mockDeleteDir = mock(() => Promise.resolve({
      path: "",
      filesDeleted: 0,
      directoriesDeleted: 0,
    }));
    const noVaultState: ConnectionState = {
      ...mockState,
      currentVault: null,
    };
    const ctx = createMockContext(createMockDepsWithDeleteDir(mockDeleteDir), noVaultState);

    await handleDeleteDirectory(ctx, "some-folder");

    expect(mockDeleteDir).not.toHaveBeenCalled();
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
  });

  it("should handle DirectoryNotFoundError", async () => {
    const error = new Error("Directory not found");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "DIRECTORY_NOT_FOUND" });
    const mockDeleteDir = mock(() => Promise.reject(error));
    const ctx = createMockContext(createMockDepsWithDeleteDir(mockDeleteDir));

    await handleDeleteDirectory(ctx, "nonexistent");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("DIRECTORY_NOT_FOUND");
    }
  });

  it("should handle InvalidFileTypeError (path is a file)", async () => {
    const error = new Error("Path is a file, not a directory");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "INVALID_FILE_TYPE" });
    const mockDeleteDir = mock(() => Promise.reject(error));
    const ctx = createMockContext(createMockDepsWithDeleteDir(mockDeleteDir));

    await handleDeleteDirectory(ctx, "file.md");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INVALID_FILE_TYPE");
    }
  });

  it("should handle PathTraversalError", async () => {
    const error = new Error("Path traversal detected");
    error.name = "FileBrowserError";
    Object.assign(error, { code: "PATH_TRAVERSAL" });
    const mockDeleteDir = mock(() => Promise.reject(error));
    const ctx = createMockContext(createMockDepsWithDeleteDir(mockDeleteDir));

    await handleDeleteDirectory(ctx, "../outside");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("PATH_TRAVERSAL");
    }
  });

  it("should handle generic errors with INTERNAL_ERROR code", async () => {
    const mockDeleteDir = mock(() => Promise.reject(new Error("Unexpected error")));
    const ctx = createMockContext(createMockDepsWithDeleteDir(mockDeleteDir));

    await handleDeleteDirectory(ctx, "folder");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INTERNAL_ERROR");
      expect(sentMessages[0].message).toBe("Unexpected error");
    }
  });

  it("should handle non-Error objects in catch", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const mockDeleteDir = mock(() => Promise.reject("string error"));
    const ctx = createMockContext(createMockDepsWithDeleteDir(mockDeleteDir));

    await handleDeleteDirectory(ctx, "folder");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("error");
    if (sentMessages[0].type === "error") {
      expect(sentMessages[0].code).toBe("INTERNAL_ERROR");
      expect(sentMessages[0].message).toBe("Failed to delete directory");
    }
  });

  it("should delete nested directory with many files", async () => {
    const mockDeleteDir = mock(() => Promise.resolve({
      path: "docs/archive/old-project",
      filesDeleted: 150,
      directoriesDeleted: 25,
    }));
    const ctx = createMockContext(createMockDepsWithDeleteDir(mockDeleteDir));

    await handleDeleteDirectory(ctx, "docs/archive/old-project");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("directory_deleted");
    if (sentMessages[0].type === "directory_deleted") {
      expect(sentMessages[0].filesDeleted).toBe(150);
      expect(sentMessages[0].directoriesDeleted).toBe(25);
    }
  });
});

/**
 * File Watcher Tests
 *
 * Unit tests with mocked chokidar and fake timers.
 * Tests the FileWatcher's debouncing, hash comparison, and callback logic
 * without depending on actual filesystem event timing.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { FileWatcher, createFileWatcher } from "../file-watcher";

// =============================================================================
// Mock Setup
// =============================================================================

// Mock FSWatcher that we can control
class MockFSWatcher extends EventEmitter {
  closed = false;

  close(): Promise<void> {
    this.closed = true;
    this.removeAllListeners();
    return Promise.resolve();
  }
}

// Track mock instances for assertions
let mockWatcher: MockFSWatcher;

// Mock chokidar.watch
const mockWatch = mock(() => {
  mockWatcher = new MockFSWatcher();
  // Auto-emit 'ready' after a microtask to simulate async initialization
  queueMicrotask(() => mockWatcher.emit("ready"));
  return mockWatcher;
});

// Mock fs readFile for content hashing
const mockReadFile = mock((path: string) => {
  // Default: return path as content (deterministic hash)
  return Promise.resolve(Buffer.from(`content-of-${path}`));
});

// Apply mocks before importing the module
void mock.module("chokidar", () => ({
  watch: mockWatch,
}));

void mock.module("node:fs/promises", () => ({
  readFile: mockReadFile,
  stat: mock(() => Promise.resolve({ isFile: () => true })),
}));

// =============================================================================
// Test Helpers
// =============================================================================

function createTestWatcher(
  options: {
    debounceMs?: number;
    onFilesChanged?: (paths: string[]) => void;
    onError?: (error: Error) => void;
  } = {}
): FileWatcher {
  return new FileWatcher("/test/vault", {
    debounceMs: options.debounceMs ?? 100,
    onFilesChanged: options.onFilesChanged ?? (() => {}),
    onError: options.onError,
  });
}

// Simulate file events from chokidar
function emitAdd(path: string): void {
  mockWatcher.emit("add", path);
}

function emitChange(path: string): void {
  mockWatcher.emit("change", path);
}

function emitUnlink(path: string): void {
  mockWatcher.emit("unlink", path);
}

function emitError(error: Error): void {
  mockWatcher.emit("error", error);
}

// Wait for debounce timer and async processing
async function waitForDebounce(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms + 50));
}

// =============================================================================
// Configuration Tests
// =============================================================================

describe("FileWatcher Configuration", () => {
  test("creates watcher with default debounce of 500ms", () => {
    const watcher = new FileWatcher("/test/vault", {
      onFilesChanged: () => {},
    });
    expect(watcher.getDebounceMs()).toBe(500);
  });

  test("creates watcher with custom debounce", () => {
    const watcher = new FileWatcher("/test/vault", {
      debounceMs: 1000,
      onFilesChanged: () => {},
    });
    expect(watcher.getDebounceMs()).toBe(1000);
  });

  test("returns correct vault path", () => {
    const watcher = new FileWatcher("/test/vault", {
      onFilesChanged: () => {},
    });
    expect(watcher.getVaultPath()).toBe("/test/vault");
  });

  test("throws on negative debounceMs", () => {
    expect(() => {
      new FileWatcher("/test/vault", {
        debounceMs: -1,
        onFilesChanged: () => {},
      });
    }).toThrow("debounceMs must be non-negative");
  });

  test("allows zero debounceMs", () => {
    const watcher = new FileWatcher("/test/vault", {
      debounceMs: 0,
      onFilesChanged: () => {},
    });
    expect(watcher.getDebounceMs()).toBe(0);
  });
});

// =============================================================================
// Lifecycle Tests
// =============================================================================

describe("FileWatcher Lifecycle", () => {
  beforeEach(() => {
    mockWatch.mockClear();
    mockReadFile.mockClear();
  });

  test("isActive returns false before start", () => {
    const watcher = createTestWatcher();
    expect(watcher.isActive()).toBe(false);
  });

  test("isActive returns true after start", async () => {
    const watcher = createTestWatcher();
    await watcher.start(["**/*.md"]);
    expect(watcher.isActive()).toBe(true);
  });

  test("isActive returns false after stop", async () => {
    const watcher = createTestWatcher();
    await watcher.start(["**/*.md"]);
    await watcher.stop();
    expect(watcher.isActive()).toBe(false);
  });

  test("stop is idempotent", async () => {
    const watcher = createTestWatcher();
    await watcher.start(["**/*.md"]);

    // Should not throw when called multiple times
    await watcher.stop();
    await watcher.stop();
    await watcher.stop();

    expect(watcher.isActive()).toBe(false);
  });

  test("start ignores if already running", async () => {
    const watcher = createTestWatcher();
    await watcher.start(["**/*.md"]);

    // Should not throw or restart
    await watcher.start(["**/*.txt"]);

    expect(watcher.isActive()).toBe(true);
    // chokidar.watch should only be called once
    expect(mockWatch).toHaveBeenCalledTimes(1);
  });

  test("start with empty patterns does not start watcher", async () => {
    const watcher = createTestWatcher();
    await watcher.start([]);
    expect(watcher.isActive()).toBe(false);
    expect(mockWatch).not.toHaveBeenCalled();
  });

  test("closes watcher on stop", async () => {
    const watcher = createTestWatcher();
    await watcher.start(["**/*.md"]);
    await watcher.stop();
    expect(mockWatcher.closed).toBe(true);
  });
});

// =============================================================================
// File Change Detection Tests
// =============================================================================

describe("FileWatcher Change Detection", () => {
  beforeEach(() => {
    mockWatch.mockClear();
    mockReadFile.mockClear();
  });

  test("detects new file creation after start", async () => {
    const changedPaths: string[] = [];
    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: (paths) => changedPaths.push(...paths),
    });

    await watcher.start(["**/*.md"]);

    // Simulate file creation
    emitAdd("/test/vault/new-file.md");

    await waitForDebounce(50);

    expect(changedPaths).toContain("new-file.md");
  });

  test("detects file modification", async () => {
    const changedPaths: string[] = [];
    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: (paths) => changedPaths.push(...paths),
    });

    await watcher.start(["**/*.md"]);

    // Simulate initial file
    emitAdd("/test/vault/existing.md");
    await waitForDebounce(50);
    changedPaths.length = 0; // Reset

    // Change the mock to return different content
    mockReadFile.mockImplementationOnce(() =>
      Promise.resolve(Buffer.from("modified-content"))
    );

    // Simulate modification
    emitChange("/test/vault/existing.md");
    await waitForDebounce(50);

    expect(changedPaths).toContain("existing.md");
  });

  test("detects file deletion", async () => {
    const changedPaths: string[] = [];
    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: (paths) => changedPaths.push(...paths),
    });

    await watcher.start(["**/*.md"]);

    // Simulate initial file
    emitAdd("/test/vault/to-delete.md");
    await waitForDebounce(50);
    changedPaths.length = 0;

    // Simulate deletion
    emitUnlink("/test/vault/to-delete.md");
    await waitForDebounce(50);

    expect(changedPaths).toContain("to-delete.md");
  });

  test("returns relative paths from vault root", async () => {
    const changedPaths: string[] = [];
    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: (paths) => changedPaths.push(...paths),
    });

    await watcher.start(["**/*.md"]);

    emitAdd("/test/vault/subdir/nested.md");
    await waitForDebounce(50);

    expect(changedPaths).toContain("subdir/nested.md");
  });
});

// =============================================================================
// Debounce Tests
// =============================================================================

describe("FileWatcher Debouncing", () => {
  beforeEach(() => {
    mockWatch.mockClear();
    mockReadFile.mockClear();
  });

  test("batches rapid changes into single callback", async () => {
    let callbackCount = 0;
    let lastPaths: string[] = [];

    const watcher = createTestWatcher({
      debounceMs: 100,
      onFilesChanged: (paths) => {
        callbackCount++;
        lastPaths = paths;
      },
    });

    await watcher.start(["**/*.md"]);

    // Emit multiple files rapidly (within debounce window)
    emitAdd("/test/vault/file1.md");
    emitAdd("/test/vault/file2.md");
    emitAdd("/test/vault/file3.md");

    await waitForDebounce(100);

    // Should have been called only once with all files
    expect(callbackCount).toBe(1);
    expect(lastPaths.length).toBe(3);
    expect(lastPaths).toContain("file1.md");
    expect(lastPaths).toContain("file2.md");
    expect(lastPaths).toContain("file3.md");
  });

  test("resets debounce timer on each change", async () => {
    let callbackCount = 0;

    const watcher = createTestWatcher({
      debounceMs: 100,
      onFilesChanged: () => {
        callbackCount++;
      },
    });

    await watcher.start(["**/*.md"]);

    // Emit file, wait less than debounce
    emitAdd("/test/vault/file1.md");
    await new Promise((r) => setTimeout(r, 50));

    // Emit another file (should reset timer)
    emitAdd("/test/vault/file2.md");
    await new Promise((r) => setTimeout(r, 50));

    // Emit third file (should reset timer again)
    emitAdd("/test/vault/file3.md");

    // At this point, 100ms haven't passed since last event
    expect(callbackCount).toBe(0);

    // Now wait for debounce
    await waitForDebounce(100);

    expect(callbackCount).toBe(1);
  });

  test("zero debounce fires quickly", async () => {
    let callbackCount = 0;

    const watcher = createTestWatcher({
      debounceMs: 0,
      onFilesChanged: () => {
        callbackCount++;
      },
    });

    await watcher.start(["**/*.md"]);

    emitAdd("/test/vault/file1.md");

    // Even with 0 debounce, there's still setTimeout(fn, 0)
    await new Promise((r) => setTimeout(r, 10));

    expect(callbackCount).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Content Hash Tests
// =============================================================================

describe("FileWatcher Content Hash", () => {
  beforeEach(() => {
    mockWatch.mockClear();
    mockReadFile.mockClear();
  });

  test("does not report unchanged content", async () => {
    let callbackCount = 0;

    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: () => {
        callbackCount++;
      },
    });

    await watcher.start(["**/*.md"]);

    // Initial add
    emitAdd("/test/vault/unchanged.md");
    await waitForDebounce(50);
    callbackCount = 0;

    // Same content (mockReadFile returns same by default)
    emitChange("/test/vault/unchanged.md");
    await waitForDebounce(50);

    // Should not have triggered callback (content unchanged)
    expect(callbackCount).toBe(0);
  });

  test("reports when content actually changes", async () => {
    const changedPaths: string[] = [];

    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: (paths) => changedPaths.push(...paths),
    });

    await watcher.start(["**/*.md"]);

    // Initial add
    emitAdd("/test/vault/changing.md");
    await waitForDebounce(50);
    changedPaths.length = 0;

    // Change content
    mockReadFile.mockImplementationOnce(() =>
      Promise.resolve(Buffer.from("different-content"))
    );

    emitChange("/test/vault/changing.md");
    await waitForDebounce(50);

    expect(changedPaths).toContain("changing.md");
  });

  test("getContentHash returns hash for tracked files", async () => {
    const watcher = createTestWatcher();
    await watcher.start(["**/*.md"]);

    emitAdd("/test/vault/tracked.md");
    await waitForDebounce(100);

    const hash = watcher.getContentHash("tracked.md");
    expect(hash).not.toBeNull();
    expect(typeof hash).toBe("string");
    expect(hash!.length).toBe(64); // SHA-256 hex length
  });

  test("getContentHash returns null for untracked files", async () => {
    const watcher = createTestWatcher();
    await watcher.start(["**/*.md"]);

    const hash = watcher.getContentHash("nonexistent.md");
    expect(hash).toBeNull();
  });

  test("clearHashes forces next change to report", async () => {
    let callbackCount = 0;

    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: () => {
        callbackCount++;
      },
    });

    await watcher.start(["**/*.md"]);

    // Initial add
    emitAdd("/test/vault/force-report.md");
    await waitForDebounce(50);
    callbackCount = 0;

    // Clear hashes
    watcher.clearHashes();

    // Same content change (normally would be skipped)
    emitChange("/test/vault/force-report.md");
    await waitForDebounce(50);

    // Should have triggered because hash was cleared
    expect(callbackCount).toBe(1);
  });

  test("handles file read errors gracefully", async () => {
    const changedPaths: string[] = [];

    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: (paths) => changedPaths.push(...paths),
    });

    await watcher.start(["**/*.md"]);

    // Mock read error
    mockReadFile.mockImplementationOnce(() =>
      Promise.reject(new Error("ENOENT"))
    );

    emitAdd("/test/vault/error-file.md");
    await waitForDebounce(50);

    // File not reported (couldn't read)
    expect(changedPaths).not.toContain("error-file.md");
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("FileWatcher Error Handling", () => {
  beforeEach(() => {
    mockWatch.mockClear();
    mockReadFile.mockClear();
  });

  test("invokes onError callback on watcher error", async () => {
    let errorReceived: Error | undefined;

    const watcher = createTestWatcher({
      onError: (error) => {
        errorReceived = error;
      },
    });

    await watcher.start(["**/*.md"]);

    const testError = new Error("Test watcher error");
    emitError(testError);

    expect(errorReceived).toBeDefined();
    expect(errorReceived?.message).toBe("Test watcher error");
  });

  test("continues operation after error", async () => {
    const changedPaths: string[] = [];

    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: (paths) => changedPaths.push(...paths),
      onError: () => {}, // Swallow error
    });

    await watcher.start(["**/*.md"]);

    // Emit error
    emitError(new Error("Transient error"));

    // Watcher should still work
    emitAdd("/test/vault/after-error.md");
    await waitForDebounce(50);

    expect(changedPaths).toContain("after-error.md");
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createFileWatcher", () => {
  test("creates watcher with callback", () => {
    const watcher = createFileWatcher("/test/vault", () => {});
    expect(watcher).toBeInstanceOf(FileWatcher);
    expect(watcher.getVaultPath()).toBe("/test/vault");
  });

  test("creates watcher with custom options", () => {
    const watcher = createFileWatcher("/test/vault", () => {}, {
      debounceMs: 750,
    });
    expect(watcher.getDebounceMs()).toBe(750);
  });

  test("creates watcher with error handler", () => {
    const watcher = createFileWatcher("/test/vault", () => {}, {
      onError: () => {},
    });
    expect(watcher).toBeInstanceOf(FileWatcher);
  });
});

// =============================================================================
// Multiple Events Tests
// =============================================================================

describe("FileWatcher Multiple Events", () => {
  beforeEach(() => {
    mockWatch.mockClear();
    mockReadFile.mockClear();
  });

  test("handles multiple file types in single batch", async () => {
    const changedPaths: string[] = [];

    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: (paths) => changedPaths.push(...paths),
    });

    await watcher.start(["**/*.md"]);

    emitAdd("/test/vault/Games/game1.md");
    emitAdd("/test/vault/Notes/note1.md");
    emitAdd("/test/vault/root.md");

    await waitForDebounce(50);

    expect(changedPaths).toContain("Games/game1.md");
    expect(changedPaths).toContain("Notes/note1.md");
    expect(changedPaths).toContain("root.md");
  });

  test("deduplicates same file events", async () => {
    const changedPaths: string[] = [];

    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: (paths) => changedPaths.push(...paths),
    });

    await watcher.start(["**/*.md"]);

    // Multiple events for same file
    emitAdd("/test/vault/same-file.md");
    emitChange("/test/vault/same-file.md");
    emitChange("/test/vault/same-file.md");

    await waitForDebounce(50);

    // Should only appear once
    const occurrences = changedPaths.filter((p) => p === "same-file.md").length;
    expect(occurrences).toBe(1);
  });

  test("tracks file count correctly", async () => {
    const watcher = createTestWatcher({ debounceMs: 50 });
    await watcher.start(["**/*.md"]);

    expect(watcher.getTrackedFileCount()).toBe(0);

    emitAdd("/test/vault/file1.md");
    emitAdd("/test/vault/file2.md");
    await waitForDebounce(50);

    expect(watcher.getTrackedFileCount()).toBe(2);

    emitUnlink("/test/vault/file1.md");
    await waitForDebounce(50);

    expect(watcher.getTrackedFileCount()).toBe(1);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("FileWatcher Edge Cases", () => {
  beforeEach(() => {
    mockWatch.mockClear();
    mockReadFile.mockClear();
  });

  test("handles rapid add-delete sequence", async () => {
    let callbackCount = 0;

    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: () => {
        callbackCount++;
      },
    });

    await watcher.start(["**/*.md"]);

    // Add then immediately delete
    emitAdd("/test/vault/ephemeral.md");
    emitUnlink("/test/vault/ephemeral.md");

    await waitForDebounce(50);

    // Should handle gracefully (behavior depends on implementation)
    // Main thing is it doesn't crash
    expect(callbackCount).toBeLessThanOrEqual(1);
  });

  test("handles empty callback gracefully", async () => {
    const watcher = createTestWatcher({
      debounceMs: 50,
      onFilesChanged: () => {}, // Empty callback
    });

    await watcher.start(["**/*.md"]);

    // Should not throw
    emitAdd("/test/vault/file.md");
    await waitForDebounce(50);

    expect(true).toBe(true); // Reached here without error
  });

  test("clears state on stop", async () => {
    const watcher = createTestWatcher({ debounceMs: 50 });
    await watcher.start(["**/*.md"]);

    emitAdd("/test/vault/file1.md");
    await waitForDebounce(50);

    expect(watcher.getTrackedFileCount()).toBe(1);

    await watcher.stop();

    expect(watcher.getTrackedFileCount()).toBe(0);
    expect(watcher.getContentHash("file1.md")).toBeNull();
  });
});

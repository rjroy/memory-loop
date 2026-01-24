/**
 * Card Discovery State Tests
 *
 * Tests for discovery state persistence and file tracking.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  CardDiscoveryStateSchema,
  type CardDiscoveryState,
  createEmptyState,
  getStateFilePath,
  readDiscoveryState,
  writeDiscoveryState,
  isFileProcessed,
  markFileProcessed,
} from "../card-discovery-state.js";

describe("card-discovery-state", () => {
  // =============================================================================
  // Schema Tests
  // =============================================================================

  describe("CardDiscoveryStateSchema", () => {
    test("validates complete valid state", () => {
      const state = {
        lastDailyRun: "2026-01-23T10:00:00.000Z",
        lastWeeklyRun: "2026-01-20T08:00:00.000Z",
        processedFiles: {
          "/path/to/file.md": {
            checksum: "abc123",
            processedAt: "2026-01-23T10:00:00.000Z",
          },
        },
        weeklyProgress: {
          bytesProcessed: 1024,
          weekStartDate: "2026-01-20",
        },
      };

      const result = CardDiscoveryStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    test("validates state with null datetime fields", () => {
      const state = {
        lastDailyRun: null,
        lastWeeklyRun: null,
        processedFiles: {},
        weeklyProgress: {
          bytesProcessed: 0,
          weekStartDate: null,
        },
      };

      const result = CardDiscoveryStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    test("validates state without weeklyProgress (optional)", () => {
      const state = {
        lastDailyRun: null,
        lastWeeklyRun: null,
        processedFiles: {},
      };

      const result = CardDiscoveryStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    test("rejects invalid datetime format", () => {
      const state = {
        lastDailyRun: "not-a-datetime",
        lastWeeklyRun: null,
        processedFiles: {},
      };

      const result = CardDiscoveryStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });

    test("rejects invalid weekStartDate format", () => {
      const state = {
        lastDailyRun: null,
        lastWeeklyRun: null,
        processedFiles: {},
        weeklyProgress: {
          bytesProcessed: 0,
          weekStartDate: "01-20-2026", // Wrong format
        },
      };

      const result = CardDiscoveryStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });

    test("rejects negative bytesProcessed", () => {
      const state = {
        lastDailyRun: null,
        lastWeeklyRun: null,
        processedFiles: {},
        weeklyProgress: {
          bytesProcessed: -100,
          weekStartDate: null,
        },
      };

      const result = CardDiscoveryStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });

    test("validates multiple processed files", () => {
      const state = {
        lastDailyRun: null,
        lastWeeklyRun: null,
        processedFiles: {
          "/path/one.md": {
            checksum: "hash1",
            processedAt: "2026-01-23T10:00:00.000Z",
          },
          "/path/two.md": {
            checksum: "hash2",
            processedAt: "2026-01-23T11:00:00.000Z",
          },
          "/path/three.md": {
            checksum: "hash3",
            processedAt: "2026-01-23T12:00:00.000Z",
          },
        },
      };

      const result = CardDiscoveryStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // Empty State Tests
  // =============================================================================

  describe("createEmptyState", () => {
    test("returns state with null timestamps", () => {
      const state = createEmptyState();
      expect(state.lastDailyRun).toBeNull();
      expect(state.lastWeeklyRun).toBeNull();
    });

    test("returns state with empty processedFiles", () => {
      const state = createEmptyState();
      expect(state.processedFiles).toEqual({});
    });

    test("returns state with zero weeklyProgress", () => {
      const state = createEmptyState();
      expect(state.weeklyProgress).toEqual({
        bytesProcessed: 0,
        weekStartDate: null,
      });
    });

    test("returns valid state per schema", () => {
      const state = createEmptyState();
      const result = CardDiscoveryStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // Path Resolution Tests
  // =============================================================================

  describe("getStateFilePath", () => {
    test("returns path under home directory", () => {
      const path = getStateFilePath();
      expect(path.startsWith(homedir())).toBe(true);
    });

    test("returns path with correct directory structure", () => {
      const path = getStateFilePath();
      expect(path).toContain(".config/memory-loop");
    });

    test("returns path with correct filename", () => {
      const path = getStateFilePath();
      expect(path.endsWith("card-discovery-state.json")).toBe(true);
    });
  });

  // =============================================================================
  // File Processing Utilities Tests
  // =============================================================================

  describe("isFileProcessed", () => {
    test("returns false for file not in state", () => {
      const state = createEmptyState();
      const result = isFileProcessed(state, "/path/to/file.md", "abc123");
      expect(result).toBe(false);
    });

    test("returns true for file with matching checksum", () => {
      const state: CardDiscoveryState = {
        ...createEmptyState(),
        processedFiles: {
          "/path/to/file.md": {
            checksum: "abc123",
            processedAt: "2026-01-23T10:00:00.000Z",
          },
        },
      };

      const result = isFileProcessed(state, "/path/to/file.md", "abc123");
      expect(result).toBe(true);
    });

    test("returns false for file with different checksum", () => {
      const state: CardDiscoveryState = {
        ...createEmptyState(),
        processedFiles: {
          "/path/to/file.md": {
            checksum: "abc123",
            processedAt: "2026-01-23T10:00:00.000Z",
          },
        },
      };

      const result = isFileProcessed(state, "/path/to/file.md", "different-hash");
      expect(result).toBe(false);
    });

    test("handles different file paths correctly", () => {
      const state: CardDiscoveryState = {
        ...createEmptyState(),
        processedFiles: {
          "/path/one.md": {
            checksum: "hash1",
            processedAt: "2026-01-23T10:00:00.000Z",
          },
        },
      };

      expect(isFileProcessed(state, "/path/one.md", "hash1")).toBe(true);
      expect(isFileProcessed(state, "/path/two.md", "hash1")).toBe(false);
    });
  });

  describe("markFileProcessed", () => {
    test("adds new file to empty state", () => {
      const state = createEmptyState();
      const newState = markFileProcessed(state, "/path/to/file.md", "abc123");

      expect(newState.processedFiles["/path/to/file.md"]).toBeDefined();
      expect(newState.processedFiles["/path/to/file.md"].checksum).toBe("abc123");
    });

    test("sets processedAt to current time", () => {
      const before = new Date().toISOString();
      const state = createEmptyState();
      const newState = markFileProcessed(state, "/path/to/file.md", "abc123");
      const after = new Date().toISOString();

      const processedAt = newState.processedFiles["/path/to/file.md"].processedAt;
      expect(processedAt >= before).toBe(true);
      expect(processedAt <= after).toBe(true);
    });

    test("does not mutate original state", () => {
      const state = createEmptyState();
      const newState = markFileProcessed(state, "/path/to/file.md", "abc123");

      expect(state.processedFiles["/path/to/file.md"]).toBeUndefined();
      expect(newState.processedFiles["/path/to/file.md"]).toBeDefined();
    });

    test("updates existing file with new checksum", () => {
      const state: CardDiscoveryState = {
        ...createEmptyState(),
        processedFiles: {
          "/path/to/file.md": {
            checksum: "old-hash",
            processedAt: "2026-01-20T10:00:00.000Z",
          },
        },
      };

      const newState = markFileProcessed(state, "/path/to/file.md", "new-hash");

      expect(newState.processedFiles["/path/to/file.md"].checksum).toBe("new-hash");
    });

    test("preserves other files in state", () => {
      const state: CardDiscoveryState = {
        ...createEmptyState(),
        processedFiles: {
          "/path/existing.md": {
            checksum: "existing-hash",
            processedAt: "2026-01-20T10:00:00.000Z",
          },
        },
      };

      const newState = markFileProcessed(state, "/path/new.md", "new-hash");

      expect(newState.processedFiles["/path/existing.md"]).toBeDefined();
      expect(newState.processedFiles["/path/existing.md"].checksum).toBe("existing-hash");
      expect(newState.processedFiles["/path/new.md"]).toBeDefined();
    });

    test("preserves other state fields", () => {
      const state: CardDiscoveryState = {
        lastDailyRun: "2026-01-23T10:00:00.000Z",
        lastWeeklyRun: "2026-01-20T08:00:00.000Z",
        processedFiles: {},
        weeklyProgress: {
          bytesProcessed: 1024,
          weekStartDate: "2026-01-20",
        },
      };

      const newState = markFileProcessed(state, "/path/to/file.md", "abc123");

      expect(newState.lastDailyRun).toBe(state.lastDailyRun);
      expect(newState.lastWeeklyRun).toBe(state.lastWeeklyRun);
      expect(newState.weeklyProgress).toEqual(state.weeklyProgress);
    });
  });

  // =============================================================================
  // File I/O Tests (using temp directory)
  // =============================================================================

  describe("readDiscoveryState and writeDiscoveryState", () => {
    let testDir: string;
    let originalHome: string;

    beforeEach(async () => {
      // Create temp directory to simulate home
      testDir = join(
        tmpdir(),
        `discovery-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(testDir, { recursive: true });

      // Override HOME environment variable
      originalHome = process.env.HOME ?? "";
      process.env.HOME = testDir;
    });

    afterEach(async () => {
      // Restore HOME
      process.env.HOME = originalHome;

      // Cleanup
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    test("returns empty state when file does not exist", async () => {
      const state = await readDiscoveryState();
      expect(state).toEqual(createEmptyState());
    });

    test("writes and reads state correctly", async () => {
      const state: CardDiscoveryState = {
        lastDailyRun: "2026-01-23T10:00:00.000Z",
        lastWeeklyRun: "2026-01-20T08:00:00.000Z",
        processedFiles: {
          "/path/to/file.md": {
            checksum: "abc123",
            processedAt: "2026-01-23T10:00:00.000Z",
          },
        },
        weeklyProgress: {
          bytesProcessed: 1024,
          weekStartDate: "2026-01-20",
        },
      };

      await writeDiscoveryState(state);
      const loaded = await readDiscoveryState();

      expect(loaded).toEqual(state);
    });

    test("creates config directory if not exists", async () => {
      const state = createEmptyState();
      await writeDiscoveryState(state);

      const statePath = getStateFilePath();
      const content = await readFile(statePath, "utf-8");
      expect(content).toBeDefined();
    });

    test("overwrites existing state file", async () => {
      const state1: CardDiscoveryState = {
        ...createEmptyState(),
        lastDailyRun: "2026-01-20T10:00:00.000Z",
      };
      const state2: CardDiscoveryState = {
        ...createEmptyState(),
        lastDailyRun: "2026-01-23T10:00:00.000Z",
      };

      await writeDiscoveryState(state1);
      await writeDiscoveryState(state2);

      const loaded = await readDiscoveryState();
      expect(loaded.lastDailyRun).toBe("2026-01-23T10:00:00.000Z");
    });

    test("returns empty state for invalid JSON", async () => {
      const statePath = getStateFilePath();
      await mkdir(join(testDir, ".config/memory-loop"), { recursive: true });
      await writeFile(statePath, "not valid json {{{", "utf-8");

      const state = await readDiscoveryState();
      expect(state).toEqual(createEmptyState());
    });

    test("returns empty state for invalid schema", async () => {
      const statePath = getStateFilePath();
      await mkdir(join(testDir, ".config/memory-loop"), { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify({ invalid: "schema", missing: "required fields" }),
        "utf-8"
      );

      const state = await readDiscoveryState();
      expect(state).toEqual(createEmptyState());
    });

    test("writes pretty-formatted JSON", async () => {
      const state = createEmptyState();
      await writeDiscoveryState(state);

      const statePath = getStateFilePath();
      const content = await readFile(statePath, "utf-8");

      // Pretty-printed JSON has newlines
      expect(content).toContain("\n");
      expect(content).toContain("  "); // Indentation
    });

    test("preserves all data types through round-trip", async () => {
      const state: CardDiscoveryState = {
        lastDailyRun: "2026-01-23T10:00:00.000Z",
        lastWeeklyRun: null,
        processedFiles: {
          "/path/with/special chars & stuff.md": {
            checksum: "abc123def456",
            processedAt: "2026-01-23T10:00:00.000Z",
          },
        },
        weeklyProgress: {
          bytesProcessed: 999999,
          weekStartDate: "2026-01-20",
        },
      };

      await writeDiscoveryState(state);
      const loaded = await readDiscoveryState();

      expect(loaded.lastDailyRun).toBe("2026-01-23T10:00:00.000Z");
      expect(loaded.lastWeeklyRun).toBeNull();
      expect(loaded.processedFiles["/path/with/special chars & stuff.md"]).toBeDefined();
      expect(loaded.weeklyProgress?.bytesProcessed).toBe(999999);
    });
  });

  // =============================================================================
  // Integration Tests
  // =============================================================================

  describe("integration: mark and check workflow", () => {
    let testDir: string;
    let originalHome: string;

    beforeEach(async () => {
      testDir = join(
        tmpdir(),
        `discovery-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(testDir, { recursive: true });
      originalHome = process.env.HOME ?? "";
      process.env.HOME = testDir;
    });

    afterEach(async () => {
      process.env.HOME = originalHome;
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    test("tracks file processing across read/write cycles", async () => {
      // First run: mark a file as processed
      let state = await readDiscoveryState();
      expect(isFileProcessed(state, "/file.md", "hash1")).toBe(false);

      state = markFileProcessed(state, "/file.md", "hash1");
      await writeDiscoveryState(state);

      // Second run: file should be marked as processed
      state = await readDiscoveryState();
      expect(isFileProcessed(state, "/file.md", "hash1")).toBe(true);
    });

    test("detects content changes via checksum", async () => {
      // Process file with original content
      let state = await readDiscoveryState();
      state = markFileProcessed(state, "/file.md", "original-hash");
      await writeDiscoveryState(state);

      // Later: file content changed
      state = await readDiscoveryState();
      expect(isFileProcessed(state, "/file.md", "original-hash")).toBe(true);
      expect(isFileProcessed(state, "/file.md", "updated-hash")).toBe(false);

      // Re-process with new hash
      state = markFileProcessed(state, "/file.md", "updated-hash");
      await writeDiscoveryState(state);

      // Verify new hash is tracked
      state = await readDiscoveryState();
      expect(isFileProcessed(state, "/file.md", "updated-hash")).toBe(true);
    });

    test("handles multiple files independently", async () => {
      let state = await readDiscoveryState();

      // Process multiple files
      state = markFileProcessed(state, "/file1.md", "hash1");
      state = markFileProcessed(state, "/file2.md", "hash2");
      state = markFileProcessed(state, "/file3.md", "hash3");
      await writeDiscoveryState(state);

      // Verify all are tracked
      state = await readDiscoveryState();
      expect(isFileProcessed(state, "/file1.md", "hash1")).toBe(true);
      expect(isFileProcessed(state, "/file2.md", "hash2")).toBe(true);
      expect(isFileProcessed(state, "/file3.md", "hash3")).toBe(true);

      // Change one file
      expect(isFileProcessed(state, "/file2.md", "new-hash")).toBe(false);
    });
  });
});

/**
 * Tests for Sync Pipeline Manager
 *
 * Tests cover:
 * - Pipeline orchestration
 * - File discovery and matching
 * - Full vs incremental sync modes
 * - Progress reporting
 * - Error handling with continuation
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import matter from "gray-matter";
import type { ApiConnector, ApiResponse } from "../connector-interface.js";
import type { SyncProgress, GetConnectorFn } from "../sync-pipeline.js";
import {
  SyncPipelineManager,
  createSyncPipelineManager,
} from "../sync-pipeline.js";

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
  mechanics: ["Worker Placement"],
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

// =============================================================================
// Temp Directory Management
// =============================================================================

let vaultRoot: string;

beforeEach(async () => {
  vaultRoot = await mkdtemp(join(tmpdir(), "sync-pipeline-test-"));
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

async function readGameFile(
  relativePath: string
): Promise<{ data: Record<string, unknown>; content: string }> {
  const { readFile } = await import("node:fs/promises");
  const fullPath = join(vaultRoot, relativePath);
  const content = await readFile(fullPath, "utf-8");
  const parsed = matter(content);
  return { data: parsed.data as Record<string, unknown>, content: parsed.content };
}

// =============================================================================
// Basic Sync Tests
// =============================================================================

describe("SyncPipelineManager", () => {
  let manager: SyncPipelineManager;

  beforeEach(() => {
    // Inject mock connector via DI
    manager = new SyncPipelineManager({ getConnector: mockGetConnector });
    // Reset mock call counts between tests
    mockFetchById.mockClear();
  });

  describe("sync", () => {
    it("should sync files matching pattern", async () => {
      await createPipelineConfig(PIPELINE_CONFIG);
      await createGameFile("Games/test-game.md", { game_id: "123" });

      const result = await manager.sync({
        vaultRoot,
        mode: "full",
      });

      expect(result.status).toBe("success");
      expect(result.filesProcessed).toBe(1);
      expect(result.filesUpdated).toBe(1);

      const { data } = await readGameFile("Games/test-game.md");
      expect(data.title).toBe("Test Game");
      expect(data.rating).toBe(8.5);
      expect(data._sync_meta).toBeDefined();
    });

    it("should skip files without external ID", async () => {
      await createPipelineConfig(PIPELINE_CONFIG);
      await createGameFile("Games/no-id.md", { title: "No ID" });

      const result = await manager.sync({
        vaultRoot,
        mode: "full",
      });

      expect(result.filesProcessed).toBe(1);
      expect(result.filesUpdated).toBe(0);
    });

    it("should skip files not matching pattern", async () => {
      await createPipelineConfig(PIPELINE_CONFIG);
      await createGameFile("Games/test-game.md", { game_id: "123" });
      await createGameFile("Notes/other.md", { game_id: "456" });

      const result = await manager.sync({
        vaultRoot,
        mode: "full",
      });

      // Only the Games/ file should be processed
      expect(result.filesProcessed).toBe(1);
    });

    it("should return success when no pipelines configured", async () => {
      const result = await manager.sync({
        vaultRoot,
        mode: "full",
      });

      expect(result.status).toBe("success");
      expect(result.filesProcessed).toBe(0);
    });
  });

  // ===========================================================================
  // Incremental Sync Tests
  // ===========================================================================

  describe("incremental sync", () => {
    it("should skip recently synced files", async () => {
      await createPipelineConfig(PIPELINE_CONFIG);
      await createGameFile("Games/recent.md", {
        game_id: "123",
        _sync_meta: {
          last_synced: new Date().toISOString(),
          source: "test",
          source_id: "123",
        },
      });

      const result = await manager.sync({
        vaultRoot,
        mode: "incremental",
        incrementalThresholdHours: 24,
      });

      expect(result.filesProcessed).toBe(1);
      expect(result.filesUpdated).toBe(0); // Skipped due to recent sync
    });

    it("should sync files not recently synced", async () => {
      await createPipelineConfig(PIPELINE_CONFIG);
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 2); // 2 days ago

      await createGameFile("Games/old.md", {
        game_id: "123",
        _sync_meta: {
          last_synced: oldDate.toISOString(),
          source: "test",
          source_id: "123",
        },
      });

      const result = await manager.sync({
        vaultRoot,
        mode: "incremental",
        incrementalThresholdHours: 24,
      });

      expect(result.filesProcessed).toBe(1);
      expect(result.filesUpdated).toBe(1);
    });

    it("should sync files never synced before in full mode", async () => {
      await createPipelineConfig(PIPELINE_CONFIG);
      await createGameFile("Games/new.md", { game_id: "123" });

      const result = await manager.sync({
        vaultRoot,
        mode: "full",
      });

      expect(result.filesUpdated).toBe(1);

      // Verify sync metadata was added
      const { data } = await readGameFile("Games/new.md");
      expect(data._sync_meta).toBeDefined();
    });
  });

  // ===========================================================================
  // Progress Reporting Tests
  // ===========================================================================

  describe("progress reporting", () => {
    it("should call progress callback during sync", async () => {
      await createPipelineConfig(PIPELINE_CONFIG);
      await createGameFile("Games/game1.md", { game_id: "123" });
      await createGameFile("Games/game2.md", { game_id: "456" });

      const progressUpdates: SyncProgress[] = [];
      const onProgress = (progress: SyncProgress) => {
        progressUpdates.push({ ...progress });
      };

      await manager.sync({
        vaultRoot,
        mode: "full",
        onProgress,
      });

      // Should have initial and per-file updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0].status).toBe("syncing");

      // Final status should be success or error
      const finalStatus = progressUpdates[progressUpdates.length - 1].status;
      expect(["success", "error"]).toContain(finalStatus);
    });

    it("should report current file in progress", async () => {
      await createPipelineConfig(PIPELINE_CONFIG);
      await createGameFile("Games/test.md", { game_id: "123" });

      const progressUpdates: SyncProgress[] = [];

      await manager.sync({
        vaultRoot,
        mode: "full",
        onProgress: (p) => progressUpdates.push({ ...p }),
      });

      // At least one update should have the current file
      const hasFileProgress = progressUpdates.some((p) => p.currentFile !== undefined);
      expect(hasFileProgress).toBe(true);
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe("error handling", () => {
    it("should report unknown connector as error", async () => {
      // Use an unknown connector name that the mock won't return
      await createPipelineConfig({
        ...PIPELINE_CONFIG,
        connector: "unknown-connector",
      });
      await createGameFile("Games/test.md", { game_id: "123" });

      const result = await manager.sync({
        vaultRoot,
        mode: "full",
      });

      expect(result.errors.length).toBe(1);
      expect(result.errors[0].message).toContain("Unknown connector");
    });

    it("should handle missing external ID gracefully", async () => {
      await createPipelineConfig(PIPELINE_CONFIG);
      await createGameFile("Games/no-id.md", { title: "No ID here" });

      const result = await manager.sync({
        vaultRoot,
        mode: "full",
      });

      // File processed but not updated (no ID to fetch)
      expect(result.filesProcessed).toBe(1);
      expect(result.filesUpdated).toBe(0);
      expect(result.errors.length).toBe(0);
    });
  });

  // ===========================================================================
  // Pipeline Filtering Tests
  // ===========================================================================

  describe("pipeline filtering", () => {
    it("should sync only specified pipeline", async () => {
      // Create two pipelines
      const syncDir = join(vaultRoot, ".memory-loop", "sync");
      await mkdir(syncDir, { recursive: true });
      await writeFile(
        join(syncDir, "games.yaml"),
        yaml.dump({ ...PIPELINE_CONFIG, name: "games" }),
        "utf-8"
      );
      await writeFile(
        join(syncDir, "other.yaml"),
        yaml.dump({
          ...PIPELINE_CONFIG,
          name: "other",
          match: { pattern: "Other/**/*.md", field: "other_id" },
        }),
        "utf-8"
      );

      await createGameFile("Games/test.md", { game_id: "123" });
      await createGameFile("Other/test.md", { other_id: "456" });

      const result = await manager.sync({
        vaultRoot,
        mode: "full",
        pipeline: "games",
      });

      // Should only process games pipeline
      expect(result.filesProcessed).toBe(1);
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createSyncPipelineManager", () => {
  it("should create a SyncPipelineManager instance", () => {
    const manager = createSyncPipelineManager();
    expect(manager).toBeInstanceOf(SyncPipelineManager);
  });
});

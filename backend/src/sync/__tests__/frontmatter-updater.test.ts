/**
 * Tests for Frontmatter Updater
 *
 * Tests cover:
 * - Merge strategies (overwrite, preserve, merge)
 * - Namespace writing
 * - Atomic write operations
 * - Sync metadata updates
 * - Field mapping from API data
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import {
  FrontmatterUpdater,
  applyMergeStrategy,
  createFrontmatterUpdater,
} from "../frontmatter-updater.js";
import type { SyncMeta, FieldMapping, DefaultsConfig } from "../schemas.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const SAMPLE_SYNC_META: SyncMeta = {
  last_synced: "2026-01-15T10:30:00Z",
  source: "bgg",
  source_id: "174430",
};

// =============================================================================
// Temp Directory Management
// =============================================================================

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "frontmatter-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// =============================================================================
// Helper Functions
// =============================================================================

async function createTestFile(
  filename: string,
  frontmatter: Record<string, unknown>,
  content = "# Test Note\n\nSome content here."
): Promise<string> {
  const filePath = join(tempDir, filename);
  const fileContent = matter.stringify(content, frontmatter);
  await writeFile(filePath, fileContent, "utf-8");
  return filePath;
}

async function readFrontmatter(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, "utf-8");
  const parsed = matter(content);
  return parsed.data as Record<string, unknown>;
}

// =============================================================================
// Merge Strategy Tests
// =============================================================================

describe("applyMergeStrategy", () => {
  describe("overwrite", () => {
    it("should replace existing value", () => {
      const result = applyMergeStrategy("old", "new", "overwrite");
      expect(result.value).toBe("new");
      expect(result.wasPreserved).toBe(false);
    });

    it("should replace undefined with new value", () => {
      const result = applyMergeStrategy(undefined, "new", "overwrite");
      expect(result.value).toBe("new");
      expect(result.wasPreserved).toBe(false);
    });

    it("should replace arrays", () => {
      const result = applyMergeStrategy(["a", "b"], ["c", "d"], "overwrite");
      expect(result.value).toEqual(["c", "d"]);
      expect(result.wasPreserved).toBe(false);
    });
  });

  describe("preserve", () => {
    it("should keep existing value when present", () => {
      const result = applyMergeStrategy("existing", "new", "preserve");
      expect(result.value).toBe("existing");
      expect(result.wasPreserved).toBe(true);
    });

    it("should use new value when existing is undefined", () => {
      const result = applyMergeStrategy(undefined, "new", "preserve");
      expect(result.value).toBe("new");
      expect(result.wasPreserved).toBe(false);
    });

    it("should use new value when existing is null", () => {
      const result = applyMergeStrategy(null, "new", "preserve");
      expect(result.value).toBe("new");
      expect(result.wasPreserved).toBe(false);
    });

    it("should preserve empty string", () => {
      const result = applyMergeStrategy("", "new", "preserve");
      expect(result.value).toBe("");
      expect(result.wasPreserved).toBe(true);
    });

    it("should preserve zero", () => {
      const result = applyMergeStrategy(0, 42, "preserve");
      expect(result.value).toBe(0);
      expect(result.wasPreserved).toBe(true);
    });

    it("should preserve false", () => {
      const result = applyMergeStrategy(false, true, "preserve");
      expect(result.value).toBe(false);
      expect(result.wasPreserved).toBe(true);
    });
  });

  describe("merge", () => {
    it("should combine arrays without duplicates", () => {
      const result = applyMergeStrategy(["a", "b"], ["b", "c"], "merge");
      expect(result.value).toEqual(["a", "b", "c"]);
      expect(result.wasPreserved).toBe(false);
    });

    it("should preserve if merged array is same", () => {
      const result = applyMergeStrategy(["a", "b"], ["a", "b"], "merge");
      expect(result.value).toEqual(["a", "b"]);
      expect(result.wasPreserved).toBe(true);
    });

    it("should overwrite non-arrays", () => {
      const result = applyMergeStrategy("old", "new", "merge");
      expect(result.value).toBe("new");
      expect(result.wasPreserved).toBe(false);
    });

    it("should use new array when existing is undefined", () => {
      const result = applyMergeStrategy(undefined, ["a", "b"], "merge");
      expect(result.value).toEqual(["a", "b"]);
      expect(result.wasPreserved).toBe(false);
    });

    it("should use new array when existing is not an array", () => {
      const result = applyMergeStrategy("not-array", ["a", "b"], "merge");
      expect(result.value).toEqual(["a", "b"]);
      expect(result.wasPreserved).toBe(false);
    });
  });
});

// =============================================================================
// FrontmatterUpdater Tests
// =============================================================================

describe("FrontmatterUpdater", () => {
  let updater: FrontmatterUpdater;

  beforeEach(() => {
    updater = new FrontmatterUpdater();
  });

  // ===========================================================================
  // Basic Update Tests
  // ===========================================================================

  describe("update", () => {
    it("should update frontmatter fields", async () => {
      const filePath = await createTestFile("test.md", { title: "Original" });

      const result = await updater.update({
        filePath,
        updates: [{ target: "title", value: "Updated", strategy: "overwrite" }],
        syncMeta: SAMPLE_SYNC_META,
      });

      expect(result.modified).toBe(true);
      expect(result.changedFields).toContain("title");

      const data = await readFrontmatter(filePath);
      expect(data.title).toBe("Updated");
    });

    it("should add new fields", async () => {
      const filePath = await createTestFile("test.md", { title: "Test" });

      await updater.update({
        filePath,
        updates: [{ target: "rating", value: 8.5, strategy: "overwrite" }],
        syncMeta: SAMPLE_SYNC_META,
      });

      const data = await readFrontmatter(filePath);
      expect(data.title).toBe("Test");
      expect(data.rating).toBe(8.5);
    });

    it("should update sync metadata", async () => {
      const filePath = await createTestFile("test.md", { title: "Test" });

      await updater.update({
        filePath,
        updates: [],
        syncMeta: SAMPLE_SYNC_META,
      });

      const data = await readFrontmatter(filePath);
      expect(data._sync_meta).toEqual(SAMPLE_SYNC_META);
    });

    it("should report no changes when nothing changed", async () => {
      const filePath = await createTestFile("test.md", {
        title: "Test",
        _sync_meta: SAMPLE_SYNC_META,
      });

      const result = await updater.update({
        filePath,
        updates: [{ target: "title", value: "Test", strategy: "overwrite" }],
        syncMeta: SAMPLE_SYNC_META,
      });

      expect(result.modified).toBe(false);
      expect(result.changedFields).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Namespace Tests
  // ===========================================================================

  describe("namespace support", () => {
    it("should write to namespace when configured", async () => {
      const filePath = await createTestFile("test.md", { title: "Test" });

      await updater.update({
        filePath,
        updates: [{ target: "rating", value: 8.5, strategy: "overwrite" }],
        syncMeta: SAMPLE_SYNC_META,
        namespace: "bgg",
      });

      const data = await readFrontmatter(filePath);
      expect(data.title).toBe("Test");
      expect((data.bgg as Record<string, unknown>).rating).toBe(8.5);
    });

    it("should create nested namespace structure", async () => {
      const filePath = await createTestFile("test.md", {});

      await updater.update({
        filePath,
        updates: [
          { target: "rating", value: 8.5, strategy: "overwrite" },
          { target: "weight", value: 3.2, strategy: "overwrite" },
        ],
        syncMeta: SAMPLE_SYNC_META,
        namespace: "bgg",
      });

      const data = await readFrontmatter(filePath);
      const bgg = data.bgg as Record<string, unknown>;
      expect(bgg.rating).toBe(8.5);
      expect(bgg.weight).toBe(3.2);
    });

    it("should preserve existing namespace data", async () => {
      const filePath = await createTestFile("test.md", {
        bgg: { plays: 10, rating: 7.0 },
      });

      await updater.update({
        filePath,
        updates: [{ target: "rating", value: 8.5, strategy: "overwrite" }],
        syncMeta: SAMPLE_SYNC_META,
        namespace: "bgg",
      });

      const data = await readFrontmatter(filePath);
      const bgg = data.bgg as Record<string, unknown>;
      expect(bgg.plays).toBe(10);
      expect(bgg.rating).toBe(8.5);
    });
  });

  // ===========================================================================
  // Merge Strategy Integration Tests
  // ===========================================================================

  describe("merge strategy integration", () => {
    it("should preserve existing values with preserve strategy", async () => {
      const filePath = await createTestFile("test.md", { rating: 7.0 });

      const result = await updater.update({
        filePath,
        updates: [{ target: "rating", value: 8.5, strategy: "preserve" }],
        syncMeta: SAMPLE_SYNC_META,
      });

      expect(result.preservedFields).toContain("rating");

      const data = await readFrontmatter(filePath);
      expect(data.rating).toBe(7.0);
    });

    it("should merge arrays with merge strategy", async () => {
      const filePath = await createTestFile("test.md", {
        mechanics: ["Worker Placement", "Deck Building"],
      });

      await updater.update({
        filePath,
        updates: [
          {
            target: "mechanics",
            value: ["Deck Building", "Area Control"],
            strategy: "merge",
          },
        ],
        syncMeta: SAMPLE_SYNC_META,
      });

      const data = await readFrontmatter(filePath);
      expect(data.mechanics).toEqual(["Worker Placement", "Deck Building", "Area Control"]);
    });
  });

  // ===========================================================================
  // Content Preservation Tests
  // ===========================================================================

  describe("content preservation", () => {
    it("should preserve markdown content", async () => {
      const originalContent = "# My Game\n\nThis is my review.";
      const filePath = await createTestFile("test.md", { title: "Test" }, originalContent);

      await updater.update({
        filePath,
        updates: [{ target: "rating", value: 8.5, strategy: "overwrite" }],
        syncMeta: SAMPLE_SYNC_META,
      });

      const content = await readFile(filePath, "utf-8");
      const parsed = matter(content);
      expect(parsed.content.trim()).toBe(originalContent);
    });
  });

  // ===========================================================================
  // createFieldUpdates Tests
  // ===========================================================================

  describe("createFieldUpdates", () => {
    it("should create updates from API data and field mappings", () => {
      const apiData = {
        name: "Test Game",
        rating: 8.5,
        mechanics: ["Worker Placement"],
      };
      const fields: FieldMapping[] = [
        { source: "name", target: "title" },
        { source: "rating", target: "bgg_rating" },
      ];

      const updates = updater.createFieldUpdates(apiData, fields);

      expect(updates).toHaveLength(2);
      expect(updates[0]).toEqual({
        target: "title",
        value: "Test Game",
        strategy: "overwrite",
      });
      expect(updates[1]).toEqual({
        target: "bgg_rating",
        value: 8.5,
        strategy: "overwrite",
      });
    });

    it("should use field-specific strategy when provided", () => {
      const apiData = { rating: 8.5 };
      const fields: FieldMapping[] = [
        { source: "rating", target: "rating", strategy: "preserve" },
      ];

      const updates = updater.createFieldUpdates(apiData, fields);

      expect(updates[0].strategy).toBe("preserve");
    });

    it("should use default strategy from config", () => {
      const apiData = { rating: 8.5 };
      const fields: FieldMapping[] = [{ source: "rating", target: "rating" }];
      const defaults: DefaultsConfig = { merge_strategy: "preserve" };

      const updates = updater.createFieldUpdates(apiData, fields, defaults);

      expect(updates[0].strategy).toBe("preserve");
    });

    it("should skip fields not in API response", () => {
      const apiData = { name: "Test" };
      const fields: FieldMapping[] = [
        { source: "name", target: "title" },
        { source: "rating", target: "rating" },
      ];

      const updates = updater.createFieldUpdates(apiData, fields);

      expect(updates).toHaveLength(1);
      expect(updates[0].target).toBe("title");
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createFrontmatterUpdater", () => {
  it("should create a FrontmatterUpdater instance", () => {
    const updater = createFrontmatterUpdater();
    expect(updater).toBeInstanceOf(FrontmatterUpdater);
  });
});

// =============================================================================
// Atomic Write Tests
// =============================================================================

describe("atomic writes", () => {
  it("should create file atomically", async () => {
    const updater = new FrontmatterUpdater();
    const filePath = await createTestFile("test.md", { title: "Original" });

    // Update should succeed
    await updater.update({
      filePath,
      updates: [{ target: "rating", value: 8.5, strategy: "overwrite" }],
      syncMeta: SAMPLE_SYNC_META,
    });

    // Verify file is correct
    const data = await readFrontmatter(filePath);
    expect(data.rating).toBe(8.5);
  });

  it("should handle nested directories", async () => {
    const updater = new FrontmatterUpdater();
    const subDir = join(tempDir, "subdir");
    await mkdir(subDir, { recursive: true });
    const filePath = await createTestFile("subdir/test.md", { title: "Test" });

    await updater.update({
      filePath,
      updates: [{ target: "rating", value: 8.5, strategy: "overwrite" }],
      syncMeta: SAMPLE_SYNC_META,
    });

    const data = await readFrontmatter(filePath);
    expect(data.rating).toBe(8.5);
  });
});

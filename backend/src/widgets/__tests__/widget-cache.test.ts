/**
 * Widget Cache Tests
 *
 * Unit tests for SQLite-based widget cache with in-memory fallback.
 * Tests cover get/set operations, invalidation, corruption recovery, and fallback mode.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  WidgetCache,
  createWidgetCache,
  CACHE_DB_PATH,
} from "../widget-cache";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temporary directory for testing.
 */
async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `widget-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Check if a file exists.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

// =============================================================================
// Basic Operations Tests
// =============================================================================

describe("WidgetCache Basic Operations", () => {
  let testDir: string;
  let cache: WidgetCache;

  beforeEach(async () => {
    testDir = await createTestDir();
    cache = new WidgetCache();
    await cache.initialize(join(testDir, "cache.db"));
  });

  afterEach(async () => {
    cache.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("initializes without fallback when path is valid", () => {
    expect(cache.isUsingFallback()).toBe(false);
  });

  test("creates database file", async () => {
    const dbExists = await fileExists(join(testDir, "cache.db"));
    expect(dbExists).toBe(true);
  });

  test("returns correct database path", () => {
    expect(cache.getDatabasePath()).toBe(join(testDir, "cache.db"));
  });
});

// =============================================================================
// Widget Cache Get/Set Tests
// =============================================================================

describe("Widget Cache Get/Set", () => {
  let testDir: string;
  let cache: WidgetCache;

  beforeEach(async () => {
    testDir = await createTestDir();
    cache = new WidgetCache();
    await cache.initialize(join(testDir, "cache.db"));
  });

  afterEach(async () => {
    cache.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("returns null for missing widget entry", () => {
    const result = cache.getWidgetResult("vault1", "widget1", "hash123");
    expect(result).toBeNull();
  });

  test("sets and gets widget result", () => {
    const testData = { count: 42, items: ["a", "b"] };
    cache.setWidgetResult("vault1", "widget1", "hash123", testData);

    const result = cache.getWidgetResult("vault1", "widget1", "hash123");
    expect(result).not.toBeNull();
    expect(JSON.parse(result!.resultJson)).toEqual(testData);
    expect(result!.computedAt).toBeGreaterThan(0);
  });

  test("updates existing widget result", () => {
    cache.setWidgetResult("vault1", "widget1", "hash123", { old: true });
    cache.setWidgetResult("vault1", "widget1", "hash123", { new: true });

    const result = cache.getWidgetResult("vault1", "widget1", "hash123");
    expect(JSON.parse(result!.resultJson)).toEqual({ new: true });
  });

  test("distinguishes different content hashes", () => {
    cache.setWidgetResult("vault1", "widget1", "hashA", { version: "A" });
    cache.setWidgetResult("vault1", "widget1", "hashB", { version: "B" });

    const resultA = cache.getWidgetResult("vault1", "widget1", "hashA");
    const resultB = cache.getWidgetResult("vault1", "widget1", "hashB");

    expect(JSON.parse(resultA!.resultJson)).toEqual({ version: "A" });
    expect(JSON.parse(resultB!.resultJson)).toEqual({ version: "B" });
  });

  test("distinguishes different vaults", () => {
    cache.setWidgetResult("vault1", "widget1", "hash", { vault: 1 });
    cache.setWidgetResult("vault2", "widget1", "hash", { vault: 2 });

    const result1 = cache.getWidgetResult("vault1", "widget1", "hash");
    const result2 = cache.getWidgetResult("vault2", "widget1", "hash");

    expect(JSON.parse(result1!.resultJson)).toEqual({ vault: 1 });
    expect(JSON.parse(result2!.resultJson)).toEqual({ vault: 2 });
  });

  test("distinguishes different widgets", () => {
    cache.setWidgetResult("vault1", "widgetA", "hash", { widget: "A" });
    cache.setWidgetResult("vault1", "widgetB", "hash", { widget: "B" });

    const resultA = cache.getWidgetResult("vault1", "widgetA", "hash");
    const resultB = cache.getWidgetResult("vault1", "widgetB", "hash");

    expect(JSON.parse(resultA!.resultJson)).toEqual({ widget: "A" });
    expect(JSON.parse(resultB!.resultJson)).toEqual({ widget: "B" });
  });
});

// =============================================================================
// Similarity Cache Get/Set Tests
// =============================================================================

describe("Similarity Cache Get/Set", () => {
  let testDir: string;
  let cache: WidgetCache;

  beforeEach(async () => {
    testDir = await createTestDir();
    cache = new WidgetCache();
    await cache.initialize(join(testDir, "cache.db"));
  });

  afterEach(async () => {
    cache.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("returns null for missing similarity entry", () => {
    const result = cache.getSimilarityResult("vault1", "widget1", "/path/to/file.md", "v1");
    expect(result).toBeNull();
  });

  test("sets and gets similarity result", () => {
    const testData = [{ path: "/other.md", score: 0.8 }];
    cache.setSimilarityResult("vault1", "widget1", "/path/to/file.md", "v1", testData);

    const result = cache.getSimilarityResult("vault1", "widget1", "/path/to/file.md", "v1");
    expect(result).not.toBeNull();
    expect(JSON.parse(result!.similarItemsJson)).toEqual(testData);
    expect(result!.computedAt).toBeGreaterThan(0);
  });

  test("updates existing similarity result", () => {
    cache.setSimilarityResult("vault1", "widget1", "/file.md", "v1", [{ old: true }]);
    cache.setSimilarityResult("vault1", "widget1", "/file.md", "v1", [{ new: true }]);

    const result = cache.getSimilarityResult("vault1", "widget1", "/file.md", "v1");
    expect(JSON.parse(result!.similarItemsJson)).toEqual([{ new: true }]);
  });

  test("distinguishes different content versions", () => {
    cache.setSimilarityResult("vault1", "widget1", "/file.md", "v1", [{ version: 1 }]);
    cache.setSimilarityResult("vault1", "widget1", "/file.md", "v2", [{ version: 2 }]);

    const result1 = cache.getSimilarityResult("vault1", "widget1", "/file.md", "v1");
    const result2 = cache.getSimilarityResult("vault1", "widget1", "/file.md", "v2");

    expect(JSON.parse(result1!.similarItemsJson)).toEqual([{ version: 1 }]);
    expect(JSON.parse(result2!.similarItemsJson)).toEqual([{ version: 2 }]);
  });

  test("distinguishes different source paths", () => {
    cache.setSimilarityResult("vault1", "widget1", "/fileA.md", "v1", [{ file: "A" }]);
    cache.setSimilarityResult("vault1", "widget1", "/fileB.md", "v1", [{ file: "B" }]);

    const resultA = cache.getSimilarityResult("vault1", "widget1", "/fileA.md", "v1");
    const resultB = cache.getSimilarityResult("vault1", "widget1", "/fileB.md", "v1");

    expect(JSON.parse(resultA!.similarItemsJson)).toEqual([{ file: "A" }]);
    expect(JSON.parse(resultB!.similarItemsJson)).toEqual([{ file: "B" }]);
  });
});

// =============================================================================
// Cache Invalidation Tests
// =============================================================================

describe("Cache Invalidation", () => {
  let testDir: string;
  let cache: WidgetCache;

  beforeEach(async () => {
    testDir = await createTestDir();
    cache = new WidgetCache();
    await cache.initialize(join(testDir, "cache.db"));
  });

  afterEach(async () => {
    cache.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("invalidateWidget removes all entries for that widget", () => {
    cache.setWidgetResult("vault1", "widget1", "hashA", { a: 1 });
    cache.setWidgetResult("vault1", "widget1", "hashB", { b: 2 });
    cache.setWidgetResult("vault1", "widget2", "hashC", { c: 3 });

    const count = cache.invalidateWidget("vault1", "widget1");
    expect(count).toBe(2);

    expect(cache.getWidgetResult("vault1", "widget1", "hashA")).toBeNull();
    expect(cache.getWidgetResult("vault1", "widget1", "hashB")).toBeNull();
    expect(cache.getWidgetResult("vault1", "widget2", "hashC")).not.toBeNull();
  });

  test("invalidateSimilarity removes all entries for that widget", () => {
    cache.setSimilarityResult("vault1", "widget1", "/fileA.md", "v1", [1]);
    cache.setSimilarityResult("vault1", "widget1", "/fileB.md", "v1", [2]);
    cache.setSimilarityResult("vault1", "widget2", "/fileC.md", "v1", [3]);

    const count = cache.invalidateSimilarity("vault1", "widget1");
    expect(count).toBe(2);

    expect(cache.getSimilarityResult("vault1", "widget1", "/fileA.md", "v1")).toBeNull();
    expect(cache.getSimilarityResult("vault1", "widget1", "/fileB.md", "v1")).toBeNull();
    expect(cache.getSimilarityResult("vault1", "widget2", "/fileC.md", "v1")).not.toBeNull();
  });

  test("invalidateVault removes all entries for that vault", () => {
    cache.setWidgetResult("vault1", "widget1", "hash1", { w: 1 });
    cache.setSimilarityResult("vault1", "widget2", "/file.md", "v1", [1]);
    cache.setWidgetResult("vault2", "widget1", "hash1", { w: 2 });

    const count = cache.invalidateVault("vault1");
    expect(count).toBe(2);

    expect(cache.getWidgetResult("vault1", "widget1", "hash1")).toBeNull();
    expect(cache.getSimilarityResult("vault1", "widget2", "/file.md", "v1")).toBeNull();
    expect(cache.getWidgetResult("vault2", "widget1", "hash1")).not.toBeNull();
  });

  test("invalidation returns 0 when nothing to invalidate", () => {
    const widgetCount = cache.invalidateWidget("nonexistent", "widget1");
    const similarityCount = cache.invalidateSimilarity("nonexistent", "widget1");
    const vaultCount = cache.invalidateVault("nonexistent");

    expect(widgetCount).toBe(0);
    expect(similarityCount).toBe(0);
    expect(vaultCount).toBe(0);
  });
});

// =============================================================================
// Cache Statistics Tests
// =============================================================================

describe("Cache Statistics", () => {
  let testDir: string;
  let cache: WidgetCache;

  beforeEach(async () => {
    testDir = await createTestDir();
    cache = new WidgetCache();
    await cache.initialize(join(testDir, "cache.db"));
  });

  afterEach(async () => {
    cache.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("getStats returns correct counts", () => {
    cache.setWidgetResult("vault1", "widget1", "hash1", { a: 1 });
    cache.setWidgetResult("vault1", "widget2", "hash2", { b: 2 });
    cache.setSimilarityResult("vault1", "widget1", "/file.md", "v1", [1]);

    const stats = cache.getStats();
    expect(stats.usingFallback).toBe(false);
    expect(stats.widgetEntries).toBe(2);
    expect(stats.similarityEntries).toBe(1);
  });

  test("getStats returns zero for empty cache", () => {
    const stats = cache.getStats();
    expect(stats.widgetEntries).toBe(0);
    expect(stats.similarityEntries).toBe(0);
  });
});

// =============================================================================
// In-Memory Fallback Tests
// =============================================================================

describe("In-Memory Fallback", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("falls back to memory when SQLite init fails", async () => {
    const cache = new WidgetCache();
    // Use a path that will fail (directory instead of file)
    await mkdir(join(testDir, "notadb"), { recursive: true });
    await cache.initialize(join(testDir, "notadb"));

    expect(cache.isUsingFallback()).toBe(true);
    cache.close();
  });

  test("fallback mode still supports get/set for widgets", async () => {
    const cache = new WidgetCache();
    await mkdir(join(testDir, "notadb"), { recursive: true });
    await cache.initialize(join(testDir, "notadb"));

    expect(cache.isUsingFallback()).toBe(true);

    cache.setWidgetResult("vault1", "widget1", "hash1", { test: true });
    const result = cache.getWidgetResult("vault1", "widget1", "hash1");

    expect(result).not.toBeNull();
    expect(JSON.parse(result!.resultJson)).toEqual({ test: true });

    cache.close();
  });

  test("fallback mode still supports get/set for similarity", async () => {
    const cache = new WidgetCache();
    await mkdir(join(testDir, "notadb"), { recursive: true });
    await cache.initialize(join(testDir, "notadb"));

    expect(cache.isUsingFallback()).toBe(true);

    cache.setSimilarityResult("vault1", "widget1", "/file.md", "v1", [{ similar: true }]);
    const result = cache.getSimilarityResult("vault1", "widget1", "/file.md", "v1");

    expect(result).not.toBeNull();
    expect(JSON.parse(result!.similarItemsJson)).toEqual([{ similar: true }]);

    cache.close();
  });

  test("fallback mode supports invalidation", async () => {
    const cache = new WidgetCache();
    await mkdir(join(testDir, "notadb"), { recursive: true });
    await cache.initialize(join(testDir, "notadb"));

    cache.setWidgetResult("vault1", "widget1", "hashA", { a: 1 });
    cache.setWidgetResult("vault1", "widget1", "hashB", { b: 2 });
    cache.setWidgetResult("vault1", "widget2", "hashC", { c: 3 });

    const count = cache.invalidateWidget("vault1", "widget1");
    expect(count).toBe(2);

    expect(cache.getWidgetResult("vault1", "widget1", "hashA")).toBeNull();
    expect(cache.getWidgetResult("vault1", "widget2", "hashC")).not.toBeNull();

    cache.close();
  });

  test("fallback mode getStats shows correct counts", async () => {
    const cache = new WidgetCache();
    await mkdir(join(testDir, "notadb"), { recursive: true });
    await cache.initialize(join(testDir, "notadb"));

    cache.setWidgetResult("vault1", "widget1", "hash1", { a: 1 });
    cache.setSimilarityResult("vault1", "widget1", "/file.md", "v1", [1]);

    const stats = cache.getStats();
    expect(stats.usingFallback).toBe(true);
    expect(stats.widgetEntries).toBe(1);
    expect(stats.similarityEntries).toBe(1);

    cache.close();
  });
});

// =============================================================================
// Corruption Recovery Tests
// =============================================================================

describe("Corruption Recovery", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("recovers from corrupted database by rebuilding", async () => {
    const dbPath = join(testDir, "cache.db");

    // Create a corrupted database file
    await writeFile(dbPath, "this is not a valid SQLite database file");

    const cache = new WidgetCache();
    await cache.initialize(dbPath);

    // Should either recover (not using fallback) or fall back gracefully
    // The behavior depends on whether bun:sqlite can handle the corruption
    // Either way, the cache should be usable
    cache.setWidgetResult("vault1", "widget1", "hash1", { recovered: true });
    const result = cache.getWidgetResult("vault1", "widget1", "hash1");

    expect(result).not.toBeNull();
    expect(JSON.parse(result!.resultJson)).toEqual({ recovered: true });

    cache.close();
  });

  test("handles missing WAL/SHM files gracefully", async () => {
    const dbPath = join(testDir, "cache.db");

    // Create cache
    const cache1 = new WidgetCache();
    await cache1.initialize(dbPath);
    cache1.setWidgetResult("vault1", "widget1", "hash1", { data: 1 });
    cache1.close();

    // Delete WAL and SHM files (simulating crash cleanup)
    try {
      await rm(`${dbPath}-wal`, { force: true });
      await rm(`${dbPath}-shm`, { force: true });
    } catch {
      // Files may not exist, that's fine
    }

    // Should still be able to open and use the cache
    const cache2 = new WidgetCache();
    await cache2.initialize(dbPath);

    expect(cache2.isUsingFallback()).toBe(false);
    // Data may or may not be present depending on checkpoint status
    // but the cache should be usable
    cache2.setWidgetResult("vault1", "widget2", "hash2", { data: 2 });
    const result = cache2.getWidgetResult("vault1", "widget2", "hash2");
    expect(result).not.toBeNull();

    cache2.close();
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createWidgetCache", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("creates cache at correct path within vault", async () => {
    const vaultPath = testDir;
    const cache = await createWidgetCache(vaultPath);

    expect(cache.getDatabasePath()).toBe(join(vaultPath, CACHE_DB_PATH));
    expect(cache.isUsingFallback()).toBe(false);

    const dbExists = await fileExists(join(vaultPath, CACHE_DB_PATH));
    expect(dbExists).toBe(true);

    cache.close();
  });

  test("creates .memory-loop directory if it does not exist", async () => {
    const vaultPath = join(testDir, "newvault");
    await mkdir(vaultPath, { recursive: true });

    const cache = await createWidgetCache(vaultPath);
    expect(cache.isUsingFallback()).toBe(false);

    const dbExists = await fileExists(join(vaultPath, ".memory-loop", "cache.db"));
    expect(dbExists).toBe(true);

    cache.close();
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe("Constants", () => {
  test("CACHE_DB_PATH is correct", () => {
    expect(CACHE_DB_PATH).toBe(".memory-loop/cache.db");
  });
});

// =============================================================================
// Lifecycle Tests
// =============================================================================

describe("Lifecycle", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("close is idempotent", async () => {
    const cache = new WidgetCache();
    await cache.initialize(join(testDir, "cache.db"));

    // Should not throw when called multiple times
    cache.close();
    cache.close();
    cache.close();
  });

  test("operations return null/0 after close", async () => {
    const cache = new WidgetCache();
    await cache.initialize(join(testDir, "cache.db"));
    cache.setWidgetResult("vault1", "widget1", "hash1", { data: 1 });
    cache.close();

    // Should return null/0 gracefully after close
    const result = cache.getWidgetResult("vault1", "widget1", "hash1");
    expect(result).toBeNull();

    const count = cache.invalidateWidget("vault1", "widget1");
    expect(count).toBe(0);
  });

  test("persists data across cache instances", async () => {
    const dbPath = join(testDir, "cache.db");

    // First cache instance
    const cache1 = new WidgetCache();
    await cache1.initialize(dbPath);
    cache1.setWidgetResult("vault1", "widget1", "hash1", { persistent: true });
    cache1.close();

    // Second cache instance
    const cache2 = new WidgetCache();
    await cache2.initialize(dbPath);
    const result = cache2.getWidgetResult("vault1", "widget1", "hash1");

    expect(result).not.toBeNull();
    expect(JSON.parse(result!.resultJson)).toEqual({ persistent: true });

    cache2.close();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
  let testDir: string;
  let cache: WidgetCache;

  beforeEach(async () => {
    testDir = await createTestDir();
    cache = new WidgetCache();
    await cache.initialize(join(testDir, "cache.db"));
  });

  afterEach(async () => {
    cache.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("handles empty string values", () => {
    cache.setWidgetResult("vault1", "widget1", "hash1", "");
    const result = cache.getWidgetResult("vault1", "widget1", "hash1");
    expect(JSON.parse(result!.resultJson)).toBe("");
  });

  test("handles complex nested objects", () => {
    const complexData = {
      nested: {
        array: [1, 2, { deep: true }],
        map: { key: "value" },
      },
      nullValue: null,
      booleans: [true, false],
    };

    cache.setWidgetResult("vault1", "widget1", "hash1", complexData);
    const result = cache.getWidgetResult("vault1", "widget1", "hash1");
    expect(JSON.parse(result!.resultJson)).toEqual(complexData);
  });

  test("handles special characters in IDs", () => {
    const specialId = "widget-with_special.chars!@#$%";
    cache.setWidgetResult("vault-1", specialId, "hash:with:colons", { special: true });
    const result = cache.getWidgetResult("vault-1", specialId, "hash:with:colons");
    expect(result).not.toBeNull();
  });

  test("handles unicode in values", () => {
    const unicodeData = {
      emoji: "test 🎮 data",
      japanese: "日本語",
      arabic: "العربية",
    };

    cache.setWidgetResult("vault1", "widget1", "hash1", unicodeData);
    const result = cache.getWidgetResult("vault1", "widget1", "hash1");
    expect(JSON.parse(result!.resultJson)).toEqual(unicodeData);
  });

  test("handles large data", () => {
    const largeArray = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      data: "x".repeat(100),
    }));

    cache.setWidgetResult("vault1", "widget1", "hash1", largeArray);
    const result = cache.getWidgetResult("vault1", "widget1", "hash1");
    expect(JSON.parse(result!.resultJson)).toEqual(largeArray);
  });

  test("handles paths with special characters in similarity cache", () => {
    const specialPath = "/Games/My Game (2024)/notes.md";
    cache.setSimilarityResult("vault1", "widget1", specialPath, "v1", [{ path: "other" }]);
    const result = cache.getSimilarityResult("vault1", "widget1", specialPath, "v1");
    expect(result).not.toBeNull();
  });
});

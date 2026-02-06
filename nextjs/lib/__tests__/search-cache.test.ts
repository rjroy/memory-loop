/**
 * Search Cache Tests
 *
 * Unit tests for the search index cache module.
 * Tests cover cache hit/miss, LRU eviction, TTL expiration,
 * cache invalidation, and configuration.
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-009)
 */

import { describe, test, expect, beforeEach, afterEach, jest, setSystemTime } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  getOrCreateIndex,
  invalidateCache,
  clearCache,
  getCacheSize,
  getCacheStats,
  configureSearchCache,
  getSearchCacheConfig,
} from "../search-cache";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temporary directory for testing.
 */
async function createTestVault(suffix: string = ""): Promise<string> {
  // Use real time for unique directory names (not affected by system time mock)
  const realNow = Bun.nanoseconds();
  const testDir = join(
    tmpdir(),
    `search-cache-test-${realNow}-${Math.random().toString(36).slice(2)}${suffix}`
  );
  await mkdir(testDir, { recursive: true });
  // Create at least one .md file so the index has something to work with
  await writeFile(join(testDir, "test.md"), "# Test\n\nTest content");
  return testDir;
}

/**
 * Recursively removes a test directory.
 */
async function cleanupTestVault(testDir: string): Promise<void> {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Search Cache Tests
// =============================================================================

describe("SearchCache", () => {
  let testVaults: string[] = [];
  let testTime: Date;

  beforeEach(() => {
    // Use fake timers to control Date.now()
    jest.useFakeTimers();
    testTime = new Date("2026-01-24T12:00:00.000Z");
    setSystemTime(testTime);

    // Clear cache and reset config before each test
    clearCache();
    configureSearchCache({ maxVaults: 10, ttlMs: 5 * 60 * 1000 });
    testVaults = [];
  });

  afterEach(async () => {
    // Restore real timers before async cleanup
    jest.useRealTimers();

    // Cleanup all test vaults
    for (const vault of testVaults) {
      await cleanupTestVault(vault);
    }
    clearCache();
  });

  /**
   * Helper to advance the mocked system time.
   */
  function advanceTime(ms: number): void {
    testTime = new Date(testTime.getTime() + ms);
    setSystemTime(testTime);
  }

  // ===========================================================================
  // Basic Cache Operations
  // ===========================================================================

  describe("basic operations", () => {
    test("getOrCreateIndex creates new index on first call", async () => {
      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      expect(getCacheSize()).toBe(0);

      const index = getOrCreateIndex("vault1", vaultPath);

      expect(index).toBeDefined();
      expect(getCacheSize()).toBe(1);
    });

    test("getOrCreateIndex returns same index on subsequent calls", async () => {
      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      const index1 = getOrCreateIndex("vault1", vaultPath);
      const index2 = getOrCreateIndex("vault1", vaultPath);

      expect(index1).toBe(index2); // Same reference
      expect(getCacheSize()).toBe(1); // Still only one entry
    });

    test("different vault IDs create different indexes", async () => {
      const vault1Path = await createTestVault("-1");
      const vault2Path = await createTestVault("-2");
      testVaults.push(vault1Path, vault2Path);

      const index1 = getOrCreateIndex("vault1", vault1Path);
      const index2 = getOrCreateIndex("vault2", vault2Path);

      expect(index1).not.toBe(index2);
      expect(getCacheSize()).toBe(2);
    });

    test("clearCache removes all entries", async () => {
      const vault1Path = await createTestVault("-1");
      const vault2Path = await createTestVault("-2");
      testVaults.push(vault1Path, vault2Path);

      getOrCreateIndex("vault1", vault1Path);
      getOrCreateIndex("vault2", vault2Path);
      expect(getCacheSize()).toBe(2);

      clearCache();

      expect(getCacheSize()).toBe(0);
    });

    test("invalidateCache removes specific entry", async () => {
      const vault1Path = await createTestVault("-1");
      const vault2Path = await createTestVault("-2");
      testVaults.push(vault1Path, vault2Path);

      getOrCreateIndex("vault1", vault1Path);
      getOrCreateIndex("vault2", vault2Path);
      expect(getCacheSize()).toBe(2);

      const removed = invalidateCache("vault1");

      expect(removed).toBe(true);
      expect(getCacheSize()).toBe(1);
    });

    test("invalidateCache returns false for non-existent entry", () => {
      const removed = invalidateCache("nonexistent");
      expect(removed).toBe(false);
    });
  });

  // ===========================================================================
  // LRU Eviction Tests
  // ===========================================================================

  describe("LRU eviction", () => {
    test("evicts least recently used entry when exceeding maxVaults", async () => {
      // Configure small cache for testing
      configureSearchCache({ maxVaults: 3 });

      const vaultPaths: string[] = [];
      for (let i = 1; i <= 4; i++) {
        const path = await createTestVault(`-${i}`);
        vaultPaths.push(path);
        testVaults.push(path);
      }

      // Add 3 vaults (fills cache)
      getOrCreateIndex("vault1", vaultPaths[0]);
      advanceTime(10); // Ensure different timestamps
      getOrCreateIndex("vault2", vaultPaths[1]);
      advanceTime(10);
      getOrCreateIndex("vault3", vaultPaths[2]);

      expect(getCacheSize()).toBe(3);

      // Add 4th vault (should evict vault1 - least recently used)
      getOrCreateIndex("vault4", vaultPaths[3]);

      expect(getCacheSize()).toBe(3); // Still at max

      // Verify vault1 was evicted
      const stats = getCacheStats();
      const vaultIds = stats.entries.map((e) => e.vaultId);
      expect(vaultIds).not.toContain("vault1");
      expect(vaultIds).toContain("vault2");
      expect(vaultIds).toContain("vault3");
      expect(vaultIds).toContain("vault4");
    });

    test("accessing an entry updates its LRU priority", async () => {
      configureSearchCache({ maxVaults: 3 });

      const vaultPaths: string[] = [];
      for (let i = 1; i <= 4; i++) {
        const path = await createTestVault(`-${i}`);
        vaultPaths.push(path);
        testVaults.push(path);
      }

      // Add 3 vaults
      getOrCreateIndex("vault1", vaultPaths[0]);
      advanceTime(10);
      getOrCreateIndex("vault2", vaultPaths[1]);
      advanceTime(10);
      getOrCreateIndex("vault3", vaultPaths[2]);

      // Access vault1 again (makes it most recently used)
      advanceTime(10);
      getOrCreateIndex("vault1", vaultPaths[0]);

      // Add 4th vault (should evict vault2 now, not vault1)
      advanceTime(10);
      getOrCreateIndex("vault4", vaultPaths[3]);

      const stats = getCacheStats();
      const vaultIds = stats.entries.map((e) => e.vaultId);
      expect(vaultIds).toContain("vault1"); // vault1 was accessed recently, kept
      expect(vaultIds).not.toContain("vault2"); // vault2 was evicted
      expect(vaultIds).toContain("vault3");
      expect(vaultIds).toContain("vault4");
    });

    test("eviction only happens when exceeding maxVaults", async () => {
      configureSearchCache({ maxVaults: 5 });

      const vaultPaths: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const path = await createTestVault(`-${i}`);
        vaultPaths.push(path);
        testVaults.push(path);
      }

      // Fill cache exactly to maxVaults
      for (let i = 0; i < 5; i++) {
        getOrCreateIndex(`vault${i + 1}`, vaultPaths[i]);
      }

      expect(getCacheSize()).toBe(5);

      // All 5 should still be present
      const stats = getCacheStats();
      expect(stats.entries.length).toBe(5);
    });
  });

  // ===========================================================================
  // TTL Expiration Tests
  // ===========================================================================

  describe("TTL expiration", () => {
    test("returns cached index before TTL expires", async () => {
      configureSearchCache({ ttlMs: 60000 }); // 1 minute TTL

      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      const index1 = getOrCreateIndex("vault1", vaultPath);
      advanceTime(10);
      const index2 = getOrCreateIndex("vault1", vaultPath);

      expect(index1).toBe(index2); // Same reference (cache hit)
    });

    test("creates new index after TTL expires", async () => {
      configureSearchCache({ ttlMs: 50 }); // Very short TTL for testing

      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      const index1 = getOrCreateIndex("vault1", vaultPath);

      // Wait for TTL to expire
      advanceTime(100);

      const index2 = getOrCreateIndex("vault1", vaultPath);

      expect(index1).not.toBe(index2); // Different reference (cache miss due to TTL)
    });

    test("TTL is reset when new index is created after expiration", async () => {
      configureSearchCache({ ttlMs: 50 });

      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      getOrCreateIndex("vault1", vaultPath);
      advanceTime(100); // Let TTL expire

      // This creates a new entry with fresh createdAt
      getOrCreateIndex("vault1", vaultPath);

      const stats = getCacheStats();
      const entry = stats.entries.find((e) => e.vaultId === "vault1");
      expect(entry).toBeDefined();
      expect(entry!.ageMs).toBeLessThan(50); // Fresh entry
    });
  });

  // ===========================================================================
  // Configuration Tests
  // ===========================================================================

  describe("configuration", () => {
    test("configureSearchCache updates settings", () => {
      configureSearchCache({ maxVaults: 20, ttlMs: 10000 });

      const config = getSearchCacheConfig();
      expect(config.maxVaults).toBe(20);
      expect(config.ttlMs).toBe(10000);
    });

    test("partial configuration uses defaults for missing values", () => {
      configureSearchCache({ maxVaults: 5 });

      const config = getSearchCacheConfig();
      expect(config.maxVaults).toBe(5);
      expect(config.ttlMs).toBe(5 * 60 * 1000); // Default
    });

    test("getSearchCacheConfig returns current configuration", () => {
      configureSearchCache({ maxVaults: 15, ttlMs: 30000 });

      const config = getSearchCacheConfig();
      expect(config.maxVaults).toBe(15);
      expect(config.ttlMs).toBe(30000);
    });

    test("default maxVaults is 10", () => {
      // Reset to defaults
      configureSearchCache({});

      const config = getSearchCacheConfig();
      expect(config.maxVaults).toBe(10);
    });

    test("default TTL is 5 minutes", () => {
      configureSearchCache({});

      const config = getSearchCacheConfig();
      expect(config.ttlMs).toBe(5 * 60 * 1000);
    });
  });

  // ===========================================================================
  // Cache Statistics Tests
  // ===========================================================================

  describe("getCacheStats", () => {
    test("returns correct cache statistics", async () => {
      const vault1Path = await createTestVault("-1");
      const vault2Path = await createTestVault("-2");
      testVaults.push(vault1Path, vault2Path);

      getOrCreateIndex("vault1", vault1Path);
      advanceTime(50);
      getOrCreateIndex("vault2", vault2Path);

      const stats = getCacheStats();

      expect(stats.size).toBe(2);
      expect(stats.maxVaults).toBe(10);
      expect(stats.ttlMs).toBe(5 * 60 * 1000);
      expect(stats.entries.length).toBe(2);
    });

    test("entry statistics include correct metadata", async () => {
      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      getOrCreateIndex("vault1", vaultPath);
      advanceTime(50);

      const stats = getCacheStats();
      const entry = stats.entries.find((e) => e.vaultId === "vault1");

      expect(entry).toBeDefined();
      expect(entry!.vaultId).toBe("vault1");
      expect(entry!.ageMs).toBe(50);
      expect(entry!.lastAccessMs).toBe(50);
      expect(typeof entry!.isIndexBuilt).toBe("boolean");
    });

    test("lastAccessMs updates when entry is accessed", async () => {
      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      getOrCreateIndex("vault1", vaultPath);
      advanceTime(100);

      const stats1 = getCacheStats();
      const lastAccess1 = stats1.entries[0].lastAccessMs;

      // Access the entry again
      getOrCreateIndex("vault1", vaultPath);
      advanceTime(10);

      const stats2 = getCacheStats();
      const lastAccess2 = stats2.entries[0].lastAccessMs;

      // lastAccess should be reset (smaller value) after re-access
      expect(lastAccess2).toBeLessThan(lastAccess1);
    });

    test("returns empty entries when cache is empty", () => {
      const stats = getCacheStats();

      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });
  });

  // ===========================================================================
  // Index Functionality Tests
  // ===========================================================================

  describe("index functionality", () => {
    test("cached index can perform file search", async () => {
      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      // Create additional test files
      await writeFile(join(vaultPath, "notes.md"), "# Notes\n\nMy notes");
      await writeFile(join(vaultPath, "readme.md"), "# README\n\nDescription");

      const index = getOrCreateIndex("vault1", vaultPath);

      // Perform a search
      const results = await index.searchFiles("notes");

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.name === "notes.md")).toBe(true);
    });

    test("cached index can perform content search", async () => {
      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      await writeFile(join(vaultPath, "todo.md"), "# TODO\n\n- Buy groceries\n- TODO: Clean house");

      const index = getOrCreateIndex("vault1", vaultPath);

      const results = await index.searchContent("TODO");

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.name === "todo.md")).toBe(true);
    });

    test("different vaults maintain independent indexes", async () => {
      const vault1Path = await createTestVault("-1");
      const vault2Path = await createTestVault("-2");
      testVaults.push(vault1Path, vault2Path);

      await writeFile(join(vault1Path, "unique1.md"), "Unique content for vault 1");
      await writeFile(join(vault2Path, "unique2.md"), "Unique content for vault 2");

      const index1 = getOrCreateIndex("vault1", vault1Path);
      const index2 = getOrCreateIndex("vault2", vault2Path);

      // Each index should only find its own files
      const results1 = await index1.searchFiles("unique");
      const results2 = await index2.searchFiles("unique");

      expect(results1.some((r) => r.name === "unique1.md")).toBe(true);
      expect(results1.some((r) => r.name === "unique2.md")).toBe(false);

      expect(results2.some((r) => r.name === "unique2.md")).toBe(true);
      expect(results2.some((r) => r.name === "unique1.md")).toBe(false);
    });

    test("invalidated cache creates fresh index on next access", async () => {
      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      // Create initial index
      const index1 = getOrCreateIndex("vault1", vaultPath);
      await index1.searchFiles("test"); // Build the index

      // Add a new file
      await writeFile(join(vaultPath, "newfile.md"), "# New File\n\nNew content");

      // Invalidate and get new index
      invalidateCache("vault1");
      const index2 = getOrCreateIndex("vault1", vaultPath);

      // Force rebuild by searching
      await index2.rebuildIndex();

      const results = await index2.searchFiles("newfile");
      expect(results.some((r) => r.name === "newfile.md")).toBe(true);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    test("handles rapid sequential accesses", async () => {
      const vaultPath = await createTestVault();
      testVaults.push(vaultPath);

      // Rapid sequential accesses should all return same index
      const indexes = [];
      for (let i = 0; i < 10; i++) {
        indexes.push(getOrCreateIndex("vault1", vaultPath));
      }

      // All should be the same reference
      for (const index of indexes) {
        expect(index).toBe(indexes[0]);
      }
      expect(getCacheSize()).toBe(1);
    });

    test("handles same vault ID with different paths gracefully", async () => {
      // This is a potential misuse but shouldn't crash
      const vault1Path = await createTestVault("-1");
      const vault2Path = await createTestVault("-2");
      testVaults.push(vault1Path, vault2Path);

      // Same vault ID, different paths
      const index1 = getOrCreateIndex("vault1", vault1Path);
      // Second call with different path returns cached index (uses vaultId as key)
      const index2 = getOrCreateIndex("vault1", vault2Path);

      // Returns same cached index (warning: this is based on vaultId, not path)
      expect(index1).toBe(index2);
    });

    test("handles empty vault gracefully", async () => {
      // Use real time for unique directory name
      const realNow = Bun.nanoseconds();
      const vaultPath = join(
        tmpdir(),
        `search-cache-empty-${realNow}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(vaultPath, { recursive: true });
      testVaults.push(vaultPath);

      const index = getOrCreateIndex("empty-vault", vaultPath);
      const results = await index.searchFiles("anything");

      expect(results).toEqual([]);
    });

    test("handles many vaults with eviction", async () => {
      configureSearchCache({ maxVaults: 5 });

      const vaultPaths: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const path = await createTestVault(`-${i}`);
        vaultPaths.push(path);
        testVaults.push(path);
      }

      // Add 10 vaults (should evict older ones)
      for (let i = 0; i < 10; i++) {
        getOrCreateIndex(`vault${i + 1}`, vaultPaths[i]);
        advanceTime(5); // Small time advance to ensure ordering
      }

      // Should only have last 5 vaults
      expect(getCacheSize()).toBe(5);

      const stats = getCacheStats();
      const vaultIds = stats.entries.map((e) => e.vaultId).sort();
      expect(vaultIds).toEqual(["vault10", "vault6", "vault7", "vault8", "vault9"]);
    });
  });
});

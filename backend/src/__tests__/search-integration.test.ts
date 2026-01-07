/**
 * Search Integration Tests
 *
 * End-to-end acceptance tests for the search feature.
 * Maps directly to spec acceptance tests (TASK-014).
 *
 * These tests validate the complete search system against the specification's
 * acceptance criteria. They use realistic file names and content patterns
 * from the spec.
 *
 * @see .sdd/tasks/2026-01-07-recall-search-tasks.md (TASK-014)
 * @see .sdd/specs/2026-01-07-recall-search.md
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SearchIndexManager } from "../search/search-index";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temporary directory for testing.
 */
async function createTestVault(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `search-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
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
// Search Integration Tests
// =============================================================================

describe("Search Integration Tests", () => {
  let tempDir: string;
  let manager: SearchIndexManager;

  beforeAll(async () => {
    // Create temp vault with test files that map to spec acceptance criteria
    tempDir = await createTestVault();

    // Create directory structure
    await mkdir(join(tempDir, "notes"), { recursive: true });
    await mkdir(join(tempDir, "projects"), { recursive: true });
    await mkdir(join(tempDir, ".obsidian"), { recursive: true });

    // Files for fuzzy match tests (REQ-F-7)
    await writeFile(
      join(tempDir, "notes", "Performance EOS SDK Testing.md"),
      "# Performance EOS SDK Testing\n\nTest file for validating EOS SDK performance metrics."
    );
    await writeFile(
      join(tempDir, "notes", "Performance Testing.md"),
      "# Performance Testing\n\nGeneral performance testing guidelines."
    );

    // Files for consecutive preference test
    await writeFile(join(tempDir, "notes", "foobar.md"), "# Foobar\n\nConsecutive match test file.");
    await writeFile(join(tempDir, "notes", "f_o_o.md"), "# F_O_O\n\nNon-consecutive match test file.");

    // Files for content search tests (REQ-F-4)
    await writeFile(
      join(tempDir, "notes", "todos.md"),
      "# Todo List\n\n- TODO: Review code\n- TODO: Write tests\n- TODO: Update docs"
    );
    await writeFile(
      join(tempDir, "notes", "notes.md"),
      "# Notes\n\nNo tasks here, just general notes."
    );
    await writeFile(
      join(tempDir, "projects", "project-alpha.md"),
      "# Project Alpha\n\nStatus: In Progress\n\nTODO: Complete milestone 1"
    );

    // Hidden files that should NOT be searchable (REQ-F-9)
    await writeFile(
      join(tempDir, ".obsidian", "workspace.json"),
      '{"hidden": true, "TODO": "this should not be found"}'
    );
    await writeFile(
      join(tempDir, ".obsidian", "app.md"),
      "# App Config\n\nThis markdown in .obsidian should be excluded."
    );

    // Build initial index
    manager = new SearchIndexManager(tempDir);
    await manager.rebuildIndex();
  });

  afterAll(async () => {
    await cleanupTestVault(tempDir);
  });

  // ===========================================================================
  // Fuzzy Name Search (REQ-F-7)
  // ===========================================================================

  describe("Fuzzy name search (REQ-F-7)", () => {
    test("'perftst' finds 'Performance EOS SDK Testing.md'", async () => {
      const results = await manager.searchFiles("perftst");
      const names = results.map((r) => r.name);

      expect(names).toContain("Performance EOS SDK Testing.md");
    });

    test("'perftest' finds 'Performance Testing.md'", async () => {
      const results = await manager.searchFiles("perftest");
      const names = results.map((r) => r.name);

      expect(names).toContain("Performance Testing.md");
    });

    test("'eossdk' finds 'Performance EOS SDK Testing.md'", async () => {
      const results = await manager.searchFiles("eossdk");
      const names = results.map((r) => r.name);

      expect(names).toContain("Performance EOS SDK Testing.md");
    });
  });

  // ===========================================================================
  // Consecutive Character Preference
  // ===========================================================================

  describe("Consecutive preference", () => {
    test("'foo' ranks 'foobar.md' above 'f_o_o.md'", async () => {
      const results = await manager.searchFiles("foo");
      const foobarIndex = results.findIndex((r) => r.name === "foobar.md");
      const f_o_oIndex = results.findIndex((r) => r.name === "f_o_o.md");

      // Both files should be found
      expect(foobarIndex).toBeGreaterThanOrEqual(0);
      expect(f_o_oIndex).toBeGreaterThanOrEqual(0);

      // Consecutive match (foobar) should rank higher
      expect(foobarIndex).toBeLessThan(f_o_oIndex);
    });

    test("'bar' in 'foobar.md' ranks based on consecutive scoring", async () => {
      const results = await manager.searchFiles("bar");
      const names = results.map((r) => r.name);

      // foobar.md contains 'bar' as consecutive characters
      expect(names).toContain("foobar.md");
    });
  });

  // ===========================================================================
  // Word Boundary Matching
  // ===========================================================================

  describe("Word boundary match", () => {
    test("'PT' finds 'Performance Testing.md'", async () => {
      const results = await manager.searchFiles("PT");
      const names = results.map((r) => r.name);

      expect(names).toContain("Performance Testing.md");
    });

    test("'PEST' finds 'Performance EOS SDK Testing.md'", async () => {
      // P(erformance) E(OS) S(DK) T(esting)
      const results = await manager.searchFiles("PEST");
      const names = results.map((r) => r.name);

      expect(names).toContain("Performance EOS SDK Testing.md");
    });
  });

  // ===========================================================================
  // Content Search (REQ-F-4)
  // ===========================================================================

  describe("Content search (REQ-F-4)", () => {
    test("'TODO' finds files containing 'TODO'", async () => {
      const results = await manager.searchContent("TODO");
      const names = results.map((r) => r.name);

      // Should find files with TODO
      expect(names).toContain("todos.md");
      expect(names).toContain("project-alpha.md");

      // Should NOT find files without TODO
      expect(names).not.toContain("notes.md");
    });

    test("'TODO' returns correct match counts", async () => {
      const results = await manager.searchContent("TODO");

      // todos.md has 4 matches: "Todo" in header + 3 "TODO:" items (case-insensitive)
      const todosResult = results.find((r) => r.name === "todos.md");
      expect(todosResult).toBeDefined();
      expect(todosResult!.matchCount).toBe(4);

      // project-alpha.md has 1 TODO
      const alphaResult = results.find((r) => r.name === "project-alpha.md");
      expect(alphaResult).toBeDefined();
      expect(alphaResult!.matchCount).toBe(1);
    });

    test("content search is case-insensitive", async () => {
      const resultsUpper = await manager.searchContent("TODO");
      const resultsLower = await manager.searchContent("todo");
      const resultsMixed = await manager.searchContent("ToDo");

      // All searches should find the same files
      expect(resultsUpper.length).toBe(resultsLower.length);
      expect(resultsLower.length).toBe(resultsMixed.length);
    });
  });

  // ===========================================================================
  // Scope Boundary (REQ-F-9)
  // ===========================================================================

  describe("Scope boundary (REQ-F-9)", () => {
    test(".obsidian files are not searchable via file search", async () => {
      const workspaceResults = await manager.searchFiles("workspace");
      const appResults = await manager.searchFiles("app");

      // No results should include .obsidian paths
      expect(workspaceResults.every((r) => !r.path.includes(".obsidian"))).toBe(true);
      expect(appResults.every((r) => !r.path.includes(".obsidian"))).toBe(true);
    });

    test(".obsidian files are not searchable via content search", async () => {
      // The workspace.json contains "TODO" - should not be found
      const todoResults = await manager.searchContent("hidden");

      expect(todoResults.every((r) => !r.path.includes(".obsidian"))).toBe(true);
    });

    test("hidden files (starting with .) are excluded", () => {
      const fileList = manager.getFileList();

      // No files should start with . or be in directories starting with .
      const hiddenFiles = fileList.filter(
        (f) => f.path.startsWith(".") || f.path.includes("/.")
      );
      expect(hiddenFiles).toEqual([]);
    });
  });

  // ===========================================================================
  // Empty Query Handling (REQ-F-26)
  // ===========================================================================

  describe("Empty query handling (REQ-F-26)", () => {
    test("empty string query returns empty file results", async () => {
      const results = await manager.searchFiles("");
      expect(results).toEqual([]);
    });

    test("whitespace-only query returns empty file results", async () => {
      const results = await manager.searchFiles("   ");
      expect(results).toEqual([]);
    });

    test("empty string query returns empty content results", async () => {
      const results = await manager.searchContent("");
      expect(results).toEqual([]);
    });

    test("whitespace-only query returns empty content results", async () => {
      const results = await manager.searchContent("   ");
      expect(results).toEqual([]);
    });
  });
});

// =============================================================================
// Index Persistence Tests (REQ-F-23)
// =============================================================================

describe("Index persistence (REQ-F-23)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTestVault();

    // Create test files
    await mkdir(join(tempDir, "notes"), { recursive: true });
    await writeFile(join(tempDir, "notes", "foobar.md"), "# Foobar\n\nTest content");
    await writeFile(join(tempDir, "notes", "f_o_o.md"), "# F_O_O\n\nTest content");
    await writeFile(join(tempDir, "notes", "todos.md"), "# Todos\n\n- TODO: Test item");
  });

  afterEach(async () => {
    await cleanupTestVault(tempDir);
  });

  test("second instance loads persisted index without rebuild", async () => {
    // First manager: build and save index
    const manager1 = new SearchIndexManager(tempDir);
    await manager1.rebuildIndex();
    await manager1.saveIndex();

    const firstIndexFileList = manager1.getFileList();

    // Second manager: should load from persistence
    const manager2 = new SearchIndexManager(tempDir);
    expect(manager2.isIndexBuilt()).toBe(false);

    // Search triggers lazy load from persisted index
    const results = await manager2.searchFiles("foo");

    expect(manager2.isIndexBuilt()).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(manager2.getFileList().length).toBe(firstIndexFileList.length);
  });

  test("file search works after loading persisted index", async () => {
    // First manager: build and save
    const manager1 = new SearchIndexManager(tempDir);
    await manager1.rebuildIndex();
    await manager1.saveIndex();

    // Second manager: load and search
    const manager2 = new SearchIndexManager(tempDir);
    const results = await manager2.searchFiles("foobar");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("foobar.md");
  });

  test("content search works after loading persisted index", async () => {
    // First manager: build and save
    const manager1 = new SearchIndexManager(tempDir);
    await manager1.rebuildIndex();
    await manager1.saveIndex();

    // Second manager: load and search
    const manager2 = new SearchIndexManager(tempDir);
    const results = await manager2.searchContent("TODO");

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.name === "todos.md")).toBe(true);
  });

  test("consecutive preference preserved after persistence round-trip", async () => {
    // First manager: build and save
    const manager1 = new SearchIndexManager(tempDir);
    await manager1.rebuildIndex();
    await manager1.saveIndex();

    // Second manager: verify ranking preserved
    const manager2 = new SearchIndexManager(tempDir);
    const results = await manager2.searchFiles("foo");

    const foobarIndex = results.findIndex((r) => r.name === "foobar.md");
    const f_o_oIndex = results.findIndex((r) => r.name === "f_o_o.md");

    expect(foobarIndex).toBeLessThan(f_o_oIndex);
  });
});

// =============================================================================
// Incremental Index Update Tests
// =============================================================================

describe("Incremental index updates", () => {
  let tempDir: string;
  let manager: SearchIndexManager;

  beforeEach(async () => {
    tempDir = await createTestVault();

    await mkdir(join(tempDir, "notes"), { recursive: true });
    await writeFile(join(tempDir, "notes", "existing.md"), "# Existing\n\nOriginal content");

    manager = new SearchIndexManager(tempDir);
    await manager.rebuildIndex();
    await manager.saveIndex();
  });

  afterEach(async () => {
    await cleanupTestVault(tempDir);
  });

  test("new files are indexed incrementally", async () => {
    // Add new file after initial index
    await writeFile(join(tempDir, "notes", "new-file.md"), "# New File\n\nNEW_UNIQUE_CONTENT");

    // Run incremental update
    const result = await manager.updateIndex();

    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);

    // Verify new file is searchable
    const fileResults = await manager.searchFiles("new-file");
    expect(fileResults.some((r) => r.name === "new-file.md")).toBe(true);

    const contentResults = await manager.searchContent("NEW_UNIQUE_CONTENT");
    expect(contentResults.some((r) => r.name === "new-file.md")).toBe(true);
  });

  test("modified files are re-indexed", async () => {
    // Wait to ensure mtime changes
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Modify existing file
    await writeFile(
      join(tempDir, "notes", "existing.md"),
      "# Existing\n\nMODIFIED_UNIQUE_CONTENT"
    );

    // Run incremental update
    const result = await manager.updateIndex();

    expect(result.updated).toBe(1);

    // Verify modified content is searchable
    const results = await manager.searchContent("MODIFIED_UNIQUE_CONTENT");
    expect(results.some((r) => r.name === "existing.md")).toBe(true);
  });

  test("deleted files are removed from index", async () => {
    // Delete existing file
    await rm(join(tempDir, "notes", "existing.md"));

    // Run incremental update
    const result = await manager.updateIndex();

    expect(result.removed).toBe(1);

    // Verify deleted file is not in results
    const fileResults = await manager.searchFiles("existing");
    expect(fileResults.some((r) => r.name === "existing.md")).toBe(false);

    expect(manager.getFileList().some((f) => f.name === "existing.md")).toBe(false);
  });
});

// =============================================================================
// Context Snippets Tests
// =============================================================================

describe("Context snippets", () => {
  let tempDir: string;
  let manager: SearchIndexManager;

  beforeAll(async () => {
    tempDir = await createTestVault();

    await mkdir(join(tempDir, "notes"), { recursive: true });
    await writeFile(
      join(tempDir, "notes", "context-test.md"),
      "Line 1\nLine 2\nLine 3 SEARCHTERM here\nLine 4\nLine 5\nLine 6\nLine 7 SEARCHTERM again\nLine 8\nLine 9"
    );

    manager = new SearchIndexManager(tempDir);
    await manager.rebuildIndex();
  });

  afterAll(async () => {
    await cleanupTestVault(tempDir);
  });

  test("snippets include matched line with context", async () => {
    const snippets = await manager.getSnippets("notes/context-test.md", "SEARCHTERM");

    expect(snippets.length).toBe(2);

    // First match on line 3
    expect(snippets[0].lineNumber).toBe(3);
    expect(snippets[0].line).toBe("Line 3 SEARCHTERM here");
    expect(snippets[0].contextBefore).toEqual(["Line 1", "Line 2"]);
    expect(snippets[0].contextAfter).toEqual(["Line 4", "Line 5"]);

    // Second match on line 7
    expect(snippets[1].lineNumber).toBe(7);
    expect(snippets[1].line).toBe("Line 7 SEARCHTERM again");
    expect(snippets[1].contextBefore).toEqual(["Line 5", "Line 6"]);
    expect(snippets[1].contextAfter).toEqual(["Line 8", "Line 9"]);
  });

  test("snippets handle file start boundary", async () => {
    await writeFile(join(tempDir, "notes", "start-match.md"), "MATCH on first line\nLine 2\nLine 3");
    await manager.rebuildIndex();

    const snippets = await manager.getSnippets("notes/start-match.md", "MATCH");

    expect(snippets.length).toBe(1);
    expect(snippets[0].lineNumber).toBe(1);
    expect(snippets[0].contextBefore).toEqual([]);
    expect(snippets[0].contextAfter.length).toBe(2);
  });

  test("snippets handle file end boundary", async () => {
    await writeFile(join(tempDir, "notes", "end-match.md"), "Line 1\nLine 2\nMATCH on last line");
    await manager.rebuildIndex();

    const snippets = await manager.getSnippets("notes/end-match.md", "MATCH");

    expect(snippets.length).toBe(1);
    expect(snippets[0].lineNumber).toBe(3);
    expect(snippets[0].contextBefore.length).toBe(2);
    expect(snippets[0].contextAfter).toEqual([]);
  });

  test("snippets are case-insensitive", async () => {
    const snippetsLower = await manager.getSnippets("notes/context-test.md", "searchterm");
    const snippetsUpper = await manager.getSnippets("notes/context-test.md", "SEARCHTERM");

    expect(snippetsLower.length).toBe(snippetsUpper.length);
  });

  test("snippets limit to 10 per file", async () => {
    // Create file with many matches
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} MATCH`);
    await writeFile(join(tempDir, "notes", "many-matches.md"), lines.join("\n"));
    await manager.rebuildIndex();

    const snippets = await manager.getSnippets("notes/many-matches.md", "MATCH");

    expect(snippets.length).toBeLessThanOrEqual(10);
  });
});

// =============================================================================
// Error Recovery Tests
// =============================================================================

describe("Error recovery", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTestVault();

    await mkdir(join(tempDir, "notes"), { recursive: true });
    await writeFile(join(tempDir, "notes", "test.md"), "# Test\n\nContent here");
  });

  afterEach(async () => {
    await cleanupTestVault(tempDir);
  });

  test("search recovers from corrupted index file (REQ-F-27)", async () => {
    // Build and save valid index
    const manager1 = new SearchIndexManager(tempDir);
    await manager1.rebuildIndex();
    await manager1.saveIndex();

    // Corrupt the index file
    const indexPath = manager1.getIndexPath();
    await writeFile(indexPath, "not valid json {{{");

    // New manager should recover and rebuild
    const manager2 = new SearchIndexManager(tempDir);
    const results = await manager2.searchFiles("test");

    expect(results.length).toBeGreaterThan(0);
    expect(manager2.isIndexBuilt()).toBe(true);
  });

  test("content search excludes files deleted after indexing (REQ-F-28)", async () => {
    await writeFile(join(tempDir, "notes", "will-delete.md"), "UNIQUE_CONTENT here");

    const manager = new SearchIndexManager(tempDir);
    await manager.rebuildIndex();

    // Verify file is found
    const resultsBefore = await manager.searchContent("UNIQUE_CONTENT");
    expect(resultsBefore.some((r) => r.name === "will-delete.md")).toBe(true);

    // Delete file externally
    await rm(join(tempDir, "notes", "will-delete.md"));

    // Search should exclude deleted file gracefully
    const resultsAfter = await manager.searchContent("UNIQUE_CONTENT");
    expect(resultsAfter.some((r) => r.name === "will-delete.md")).toBe(false);
  });

  test("snippets return empty for deleted file", async () => {
    const manager = new SearchIndexManager(tempDir);
    await manager.rebuildIndex();

    // Delete file
    await rm(join(tempDir, "notes", "test.md"));

    // Snippets should return empty, not error
    const snippets = await manager.getSnippets("notes/test.md", "Content");
    expect(snippets).toEqual([]);
  });

  test("handles version mismatch gracefully", async () => {
    // Build and save index
    const manager1 = new SearchIndexManager(tempDir);
    await manager1.rebuildIndex();
    await manager1.saveIndex();

    // Modify version in saved index
    const indexPath = manager1.getIndexPath();
    const content = await readFile(indexPath, "utf-8");
    const indexData = JSON.parse(content) as { version: string };
    indexData.version = "0.0.1"; // Old version
    await writeFile(indexPath, JSON.stringify(indexData));

    // New manager should detect mismatch and rebuild
    const manager2 = new SearchIndexManager(tempDir);
    const loaded = await manager2.loadIndex();

    expect(loaded).toBe(false); // Version mismatch triggers rebuild
  });
});

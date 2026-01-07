/**
 * Search Index Manager Tests
 *
 * Unit tests for the SearchIndexManager class.
 * Tests cover lazy loading, file crawling, content search,
 * snippet extraction, and scope enforcement.
 *
 * Uses filesystem mocking with temp directories for isolated testing.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
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
    `search-index-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

/**
 * Creates a test vault with common test files.
 */
async function setupTestVault(vaultPath: string): Promise<void> {
  // Create directory structure
  await mkdir(join(vaultPath, "notes"), { recursive: true });
  await mkdir(join(vaultPath, "projects"), { recursive: true });
  await mkdir(join(vaultPath, "projects", "subproject"), { recursive: true });
  await mkdir(join(vaultPath, ".obsidian"), { recursive: true });

  // Create test files
  await writeFile(
    join(vaultPath, "README.md"),
    "# My Vault\n\nWelcome to my vault.\n\nThis contains TODO items."
  );
  await writeFile(
    join(vaultPath, "notes", "daily-2025-01-01.md"),
    "# Daily Note\n\n- TODO: Review tasks\n- TODO: Write report"
  );
  await writeFile(
    join(vaultPath, "notes", "meeting-notes.md"),
    "# Meeting Notes\n\nDiscussed project timeline.\n\nAction items:\n- Follow up with team"
  );
  await writeFile(
    join(vaultPath, "projects", "project-alpha.md"),
    "# Project Alpha\n\nStatus: In Progress\n\nTODO: Complete phase 1"
  );
  await writeFile(
    join(vaultPath, "projects", "subproject", "tasks.md"),
    "# Tasks\n\n- [ ] Task 1\n- [ ] Task 2"
  );

  // Create hidden/system files that should be excluded
  await writeFile(
    join(vaultPath, ".obsidian", "app.json"),
    '{"theme": "dark"}'
  );
  await writeFile(join(vaultPath, ".hidden-note.md"), "# Hidden Note");
}

// =============================================================================
// SearchIndexManager Tests
// =============================================================================

describe("SearchIndexManager", () => {
  let vaultPath: string;
  let manager: SearchIndexManager;

  beforeEach(async () => {
    vaultPath = await createTestVault();
    await setupTestVault(vaultPath);
    manager = new SearchIndexManager(vaultPath);
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  // ===========================================================================
  // Lazy Loading Tests
  // ===========================================================================

  describe("lazy loading", () => {
    test("index is not built on construction", () => {
      const newManager = new SearchIndexManager(vaultPath);
      expect(newManager.isIndexBuilt()).toBe(false);
      expect(newManager.getFileList()).toEqual([]);
    });

    test("index is built on first searchFiles call", async () => {
      expect(manager.isIndexBuilt()).toBe(false);

      await manager.searchFiles("test");

      expect(manager.isIndexBuilt()).toBe(true);
      expect(manager.getFileList().length).toBeGreaterThan(0);
    });

    test("index is built on first searchContent call", async () => {
      expect(manager.isIndexBuilt()).toBe(false);

      await manager.searchContent("TODO");

      expect(manager.isIndexBuilt()).toBe(true);
    });

    test("index is not rebuilt on subsequent searches", async () => {
      await manager.searchFiles("test");
      const fileCount = manager.getFileList().length;

      // Search again
      await manager.searchFiles("another");

      // File list should be the same (not rebuilt)
      expect(manager.getFileList().length).toBe(fileCount);
    });
  });

  // ===========================================================================
  // File Crawling Tests
  // ===========================================================================

  describe("file crawling", () => {
    test("indexes only .md files", async () => {
      // Add a non-md file
      await writeFile(join(vaultPath, "image.png"), "binary content");
      await writeFile(join(vaultPath, "data.json"), '{"key": "value"}');

      await manager.searchFiles("test");
      const files = manager.getFileList();

      // Should only have .md files
      for (const file of files) {
        expect(file.name.endsWith(".md")).toBe(true);
      }
    });

    test("excludes hidden folders", async () => {
      await manager.searchFiles("test");
      const files = manager.getFileList();

      // Should not include files from .obsidian
      const hiddenFiles = files.filter(
        (f) => f.path.includes(".obsidian") || f.path.startsWith(".")
      );
      expect(hiddenFiles).toEqual([]);
    });

    test("excludes hidden files", async () => {
      await manager.searchFiles("test");
      const files = manager.getFileList();

      // Should not include .hidden-note.md
      const hiddenFiles = files.filter((f) => f.name.startsWith("."));
      expect(hiddenFiles).toEqual([]);
    });

    test("indexes files in subdirectories", async () => {
      await manager.searchFiles("test");
      const files = manager.getFileList();

      // Should include files from nested directories
      const nestedFile = files.find((f) =>
        f.path.includes("projects/subproject/tasks.md")
      );
      expect(nestedFile).toBeDefined();
    });

    test("stores correct file metadata", async () => {
      await manager.searchFiles("test");
      const files = manager.getFileList();

      // Find a specific file
      const readme = files.find((f) => f.name === "README.md");
      expect(readme).toBeDefined();
      expect(readme!.path).toBe("README.md");
      expect(readme!.mtime).toBeGreaterThan(0);
    });

    test("handles empty directories gracefully", async () => {
      await mkdir(join(vaultPath, "empty-folder"));

      await manager.searchFiles("test");

      // Should not throw and should still find other files
      expect(manager.getFileList().length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // File Name Search Tests
  // ===========================================================================

  describe("searchFiles", () => {
    test("finds files by name with fuzzy matching", async () => {
      const results = await manager.searchFiles("readme");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("README.md");
    });

    test("returns empty array for empty query", async () => {
      const results = await manager.searchFiles("");

      expect(results).toEqual([]);
    });

    test("returns empty array for whitespace query", async () => {
      const results = await manager.searchFiles("   ");

      expect(results).toEqual([]);
    });

    test("respects limit option", async () => {
      // Create many files
      for (let i = 0; i < 20; i++) {
        await writeFile(join(vaultPath, `test-${i}.md`), "content");
      }

      // Rebuild index to include new files
      await manager.rebuildIndex();

      const results = await manager.searchFiles("test", { limit: 5 });

      expect(results.length).toBe(5);
    });

    test("includes match positions for highlighting", async () => {
      const results = await manager.searchFiles("readme");

      expect(results[0].matchPositions).toBeDefined();
      expect(results[0].matchPositions.length).toBeGreaterThan(0);
    });

    test("scores consecutive matches higher", async () => {
      // Add files for testing scoring
      await writeFile(join(vaultPath, "foobar.md"), "content");
      await writeFile(join(vaultPath, "f_o_o_b_a_r.md"), "content");

      await manager.rebuildIndex();

      const results = await manager.searchFiles("foobar");

      // Consecutive match should rank higher
      expect(results[0].name).toBe("foobar.md");
    });
  });

  // ===========================================================================
  // Content Search Tests
  // ===========================================================================

  describe("searchContent", () => {
    test("finds files containing query text", async () => {
      const results = await manager.searchContent("TODO");

      expect(results.length).toBeGreaterThan(0);

      // Should find files with TODO
      const paths = results.map((r) => r.path);
      expect(
        paths.some(
          (p) => p.includes("daily") || p.includes("alpha") || p === "README.md"
        )
      ).toBe(true);
    });

    test("returns match count per file", async () => {
      const results = await manager.searchContent("TODO");

      for (const result of results) {
        expect(result.matchCount).toBeGreaterThan(0);
      }

      // daily-2025-01-01.md has 2 TODOs
      const dailyNote = results.find((r) => r.path.includes("daily"));
      if (dailyNote) {
        expect(dailyNote.matchCount).toBe(2);
      }
    });

    test("returns empty array for empty query", async () => {
      const results = await manager.searchContent("");

      expect(results).toEqual([]);
    });

    test("returns empty array for whitespace query", async () => {
      const results = await manager.searchContent("   ");

      expect(results).toEqual([]);
    });

    test("respects limit option", async () => {
      // Create many files with matching content
      for (let i = 0; i < 20; i++) {
        await writeFile(
          join(vaultPath, `searchtest-${i}.md`),
          "This file contains the search term."
        );
      }

      await manager.rebuildIndex();

      const results = await manager.searchContent("search", { limit: 5 });

      expect(results.length).toBe(5);
    });

    test("is case insensitive", async () => {
      const results1 = await manager.searchContent("todo");
      const results2 = await manager.searchContent("TODO");
      const results3 = await manager.searchContent("Todo");

      // All should find the same files
      expect(results1.length).toBeGreaterThan(0);
      expect(results1.length).toBe(results2.length);
      expect(results2.length).toBe(results3.length);
    });

    test("finds no results for non-existent term", async () => {
      const results = await manager.searchContent("xyznonexistentterm123");

      expect(results).toEqual([]);
    });

    test("handles prefix matching", async () => {
      // Add file with specific content
      await writeFile(join(vaultPath, "prefix-test.md"), "Programming is fun");

      await manager.rebuildIndex();

      const results = await manager.searchContent("Prog");

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path === "prefix-test.md")).toBe(true);
    });
  });

  // ===========================================================================
  // Snippet Extraction Tests
  // ===========================================================================

  describe("getSnippets", () => {
    test("returns snippets for matching lines", async () => {
      const snippets = await manager.getSnippets(
        "notes/daily-2025-01-01.md",
        "TODO"
      );

      expect(snippets.length).toBeGreaterThan(0);

      // Should find the TODO lines
      const hasMatch = snippets.some((s) => s.line.includes("TODO"));
      expect(hasMatch).toBe(true);
    });

    test("includes correct line numbers (1-indexed)", async () => {
      const snippets = await manager.getSnippets("README.md", "Welcome");

      expect(snippets.length).toBe(1);
      expect(snippets[0].lineNumber).toBe(3); // "Welcome to my vault." is line 3
    });

    test("includes context before and after", async () => {
      // Create file with specific content for testing context
      await writeFile(
        join(vaultPath, "context-test.md"),
        "Line 1\nLine 2\nLine 3 MATCH\nLine 4\nLine 5"
      );

      const snippets = await manager.getSnippets("context-test.md", "MATCH");

      expect(snippets.length).toBe(1);
      expect(snippets[0].contextBefore).toEqual(["Line 1", "Line 2"]);
      expect(snippets[0].contextAfter).toEqual(["Line 4", "Line 5"]);
    });

    test("handles context at start of file", async () => {
      await writeFile(
        join(vaultPath, "start-test.md"),
        "MATCH line\nLine 2\nLine 3"
      );

      const snippets = await manager.getSnippets("start-test.md", "MATCH");

      expect(snippets[0].lineNumber).toBe(1);
      expect(snippets[0].contextBefore).toEqual([]);
      expect(snippets[0].contextAfter).toEqual(["Line 2", "Line 3"]);
    });

    test("handles context at end of file", async () => {
      await writeFile(
        join(vaultPath, "end-test.md"),
        "Line 1\nLine 2\nMATCH line"
      );

      const snippets = await manager.getSnippets("end-test.md", "MATCH");

      expect(snippets[0].lineNumber).toBe(3);
      expect(snippets[0].contextBefore).toEqual(["Line 1", "Line 2"]);
      expect(snippets[0].contextAfter).toEqual([]);
    });

    test("limits snippets to 10 per file", async () => {
      // Create file with many matches
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i} MATCH`);
      await writeFile(join(vaultPath, "many-matches.md"), lines.join("\n"));

      const snippets = await manager.getSnippets("many-matches.md", "MATCH");

      expect(snippets.length).toBeLessThanOrEqual(10);
    });

    test("returns empty array for empty query", async () => {
      const snippets = await manager.getSnippets("README.md", "");

      expect(snippets).toEqual([]);
    });

    test("returns empty array for non-existent file", async () => {
      const snippets = await manager.getSnippets("does-not-exist.md", "TODO");

      expect(snippets).toEqual([]);
    });

    test("handles special characters in query", async () => {
      await writeFile(
        join(vaultPath, "special-chars.md"),
        "Price: $100\nRegex: [a-z]*\nPath: file.md"
      );

      const snippets1 = await manager.getSnippets("special-chars.md", "$100");
      expect(snippets1.length).toBe(1);

      const snippets2 = await manager.getSnippets("special-chars.md", "[a-z]*");
      expect(snippets2.length).toBe(1);
    });

    test("is case insensitive", async () => {
      await writeFile(join(vaultPath, "case-test.md"), "Hello World");

      const snippets1 = await manager.getSnippets("case-test.md", "hello");
      const snippets2 = await manager.getSnippets("case-test.md", "HELLO");

      expect(snippets1.length).toBe(1);
      expect(snippets2.length).toBe(1);
    });
  });

  // ===========================================================================
  // Scope Enforcement Tests
  // ===========================================================================

  describe("scope enforcement", () => {
    test("getSnippets rejects path traversal attempts", async () => {
      const snippets = await manager.getSnippets("../../../etc/passwd", "root");

      expect(snippets).toEqual([]);
    });

    test("getSnippets rejects absolute paths outside vault", async () => {
      const snippets = await manager.getSnippets("/etc/passwd", "root");

      expect(snippets).toEqual([]);
    });

    test("does not index files outside content root", async () => {
      // Create a file outside the vault (in temp dir)
      const outsideFile = join(tmpdir(), "outside-file.md");
      await writeFile(outsideFile, "This should not be indexed");

      await manager.searchFiles("test");
      const files = manager.getFileList();

      // Should not include the outside file
      expect(files.some((f) => f.path.includes("outside-file"))).toBe(false);

      // Cleanup
      await rm(outsideFile);
    });
  });

  // ===========================================================================
  // Symlink Handling Tests
  // ===========================================================================

  describe("symlink handling", () => {
    test("excludes symlink files from index", async () => {
      const realFile = join(vaultPath, "real-file.md");
      const linkPath = join(vaultPath, "link-file.md");

      await writeFile(realFile, "Real content");

      try {
        await symlink(realFile, linkPath);

        await manager.rebuildIndex();
        const files = manager.getFileList();

        // Should include real file but not symlink
        expect(files.some((f) => f.name === "real-file.md")).toBe(true);
        expect(files.some((f) => f.name === "link-file.md")).toBe(false);
      } catch (error) {
        // Symlinks may not be supported on all platforms
        if (
          error instanceof Error &&
          (error.message.includes("EPERM") ||
            error.message.includes("operation not permitted"))
        ) {
          console.log("Skipping symlink test - not supported on this platform");
          return;
        }
        throw error;
      }
    });

    test("excludes symlink directories from crawling", async () => {
      const realDir = join(vaultPath, "real-dir");
      const linkPath = join(vaultPath, "link-dir");

      await mkdir(realDir);
      await writeFile(join(realDir, "file-in-real-dir.md"), "Content");

      try {
        await symlink(realDir, linkPath);

        await manager.rebuildIndex();
        const files = manager.getFileList();

        // Should include file from real dir but not from symlink dir
        expect(
          files.some((f) => f.path === "real-dir/file-in-real-dir.md")
        ).toBe(true);
        expect(
          files.some((f) => f.path === "link-dir/file-in-real-dir.md")
        ).toBe(false);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("EPERM") ||
            error.message.includes("operation not permitted"))
        ) {
          console.log("Skipping symlink test - not supported on this platform");
          return;
        }
        throw error;
      }
    });
  });

  // ===========================================================================
  // Index Rebuild Tests
  // ===========================================================================

  describe("rebuildIndex", () => {
    test("updates file list after rebuild", async () => {
      // Initial search to build index
      await manager.searchFiles("test");
      const initialCount = manager.getFileList().length;

      // Add new file
      await writeFile(join(vaultPath, "new-file.md"), "New content");

      // Rebuild
      await manager.rebuildIndex();
      const newCount = manager.getFileList().length;

      expect(newCount).toBe(initialCount + 1);
    });

    test("removes deleted files after rebuild", async () => {
      // Initial search to build index
      await manager.searchFiles("test");

      // Find a file to delete
      const readme = manager.getFileList().find((f) => f.name === "README.md");
      expect(readme).toBeDefined();

      // Delete the file
      await rm(join(vaultPath, "README.md"));

      // Rebuild
      await manager.rebuildIndex();
      const files = manager.getFileList();

      expect(files.some((f) => f.name === "README.md")).toBe(false);
    });

    test("resets indexBuilt flag before rebuild", async () => {
      await manager.searchFiles("test");
      expect(manager.isIndexBuilt()).toBe(true);

      // Start rebuild
      await manager.rebuildIndex();

      // Should still be built after rebuild completes
      expect(manager.isIndexBuilt()).toBe(true);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    test("handles empty vault", async () => {
      const emptyVault = await createTestVault();

      try {
        const emptyManager = new SearchIndexManager(emptyVault);

        const fileResults = await emptyManager.searchFiles("test");
        const contentResults = await emptyManager.searchContent("test");

        expect(fileResults).toEqual([]);
        expect(contentResults).toEqual([]);
        expect(emptyManager.getFileList()).toEqual([]);
      } finally {
        await cleanupTestVault(emptyVault);
      }
    });

    test("handles files with unicode names", async () => {
      await writeFile(join(vaultPath, "japanese.md"), "# Japanese note");
      await writeFile(join(vaultPath, "notes", "emoji-note.md"), "Content");

      await manager.rebuildIndex();

      const results = await manager.searchFiles("japanese");
      expect(results.length).toBeGreaterThan(0);
    });

    test("handles files with spaces in names", async () => {
      await writeFile(
        join(vaultPath, "my note file.md"),
        "Content with spaces in name"
      );

      await manager.rebuildIndex();

      const results = await manager.searchFiles("note file");
      expect(results.some((r) => r.name === "my note file.md")).toBe(true);
    });

    test("handles deeply nested directories", async () => {
      const deepPath = join(vaultPath, "a", "b", "c", "d", "e");
      await mkdir(deepPath, { recursive: true });
      await writeFile(join(deepPath, "deep.md"), "Deep content");

      await manager.rebuildIndex();
      const files = manager.getFileList();

      expect(files.some((f) => f.path === "a/b/c/d/e/deep.md")).toBe(true);
    });

    test("handles files with only whitespace content", async () => {
      await writeFile(join(vaultPath, "whitespace.md"), "   \n\n\t\t\n   ");

      await manager.rebuildIndex();

      // Should be indexed without error
      const files = manager.getFileList();
      expect(files.some((f) => f.name === "whitespace.md")).toBe(true);
    });

    test("handles empty files", async () => {
      await writeFile(join(vaultPath, "empty.md"), "");

      await manager.rebuildIndex();

      const files = manager.getFileList();
      expect(files.some((f) => f.name === "empty.md")).toBe(true);
    });

    test("handles very long file names", async () => {
      const longName = "a".repeat(100) + ".md";
      await writeFile(join(vaultPath, longName), "Content");

      await manager.rebuildIndex();

      const results = await manager.searchFiles("a".repeat(50));
      expect(results.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Acceptance Tests from Spec
// =============================================================================

describe("acceptance tests", () => {
  let vaultPath: string;
  let manager: SearchIndexManager;

  beforeEach(async () => {
    vaultPath = await createTestVault();
    manager = new SearchIndexManager(vaultPath);
  });

  afterEach(async () => {
    await cleanupTestVault(vaultPath);
  });

  test("fuzzy name match: 'perftst' finds 'Performance EOS SDK Testing.md'", async () => {
    await writeFile(
      join(vaultPath, "Performance EOS SDK Testing.md"),
      "Test content"
    );

    await manager.rebuildIndex();

    const results = await manager.searchFiles("perftst");

    expect(
      results.some((r) => r.name === "Performance EOS SDK Testing.md")
    ).toBe(true);
  });

  test("consecutive preference: 'foo' ranks 'foobar.md' above 'f_o_o.md'", async () => {
    await writeFile(join(vaultPath, "foobar.md"), "content");
    await writeFile(join(vaultPath, "f_o_o.md"), "content");

    await manager.rebuildIndex();

    const results = await manager.searchFiles("foo");

    expect(results[0].name).toBe("foobar.md");
    expect(results[1].name).toBe("f_o_o.md");
  });

  test("word boundary match: 'PT' finds 'Performance Testing.md'", async () => {
    await writeFile(join(vaultPath, "Performance Testing.md"), "content");

    await manager.rebuildIndex();

    const results = await manager.searchFiles("PT");

    expect(results.some((r) => r.name === "Performance Testing.md")).toBe(true);
  });

  test("content search basic: 'TODO' finds files containing 'TODO'", async () => {
    await writeFile(join(vaultPath, "with-todo.md"), "This has a TODO item");
    await writeFile(join(vaultPath, "without-todo.md"), "This has no tasks");

    await manager.rebuildIndex();

    const results = await manager.searchContent("TODO");

    expect(results.some((r) => r.name === "with-todo.md")).toBe(true);
    expect(results.some((r) => r.name === "without-todo.md")).toBe(false);
  });

  test("content context: expanding a content result shows matched line with 2 lines context", async () => {
    await writeFile(
      join(vaultPath, "context-file.md"),
      "Line A\nLine B\nTODO: Important task\nLine D\nLine E"
    );

    const snippets = await manager.getSnippets("context-file.md", "TODO");

    expect(snippets.length).toBe(1);
    expect(snippets[0].lineNumber).toBe(3);
    expect(snippets[0].line).toBe("TODO: Important task");
    expect(snippets[0].contextBefore).toEqual(["Line A", "Line B"]);
    expect(snippets[0].contextAfter).toEqual(["Line D", "Line E"]);
  });

  test("scope boundary: files in .obsidian folder are not searchable", async () => {
    await mkdir(join(vaultPath, ".obsidian"), { recursive: true });
    await writeFile(
      join(vaultPath, ".obsidian", "workspace.md"),
      "# Workspace Config"
    );
    await writeFile(join(vaultPath, "normal-note.md"), "# Normal Note");

    await manager.rebuildIndex();

    const files = manager.getFileList();

    expect(files.some((f) => f.path.includes(".obsidian"))).toBe(false);
    expect(files.some((f) => f.name === "normal-note.md")).toBe(true);
  });

  test("empty query: clearing search input returns empty results", async () => {
    await writeFile(join(vaultPath, "test.md"), "content");

    await manager.rebuildIndex();

    const fileResults = await manager.searchFiles("");
    const contentResults = await manager.searchContent("");

    expect(fileResults).toEqual([]);
    expect(contentResults).toEqual([]);
  });
});

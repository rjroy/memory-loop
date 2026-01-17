/**
 * Reference Updater Tests
 *
 * Unit tests for updating internal references in markdown files
 * when files or directories are renamed.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { updateReferences } from "../reference-updater";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temporary directory for testing.
 */
async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `ref-updater-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Recursively removes a test directory.
 */
async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Wikilink Reference Tests
// =============================================================================

describe("updateReferences - Wikilinks", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("updates simple wikilink [[name]]", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "See [[old-file]] for more info."
    );

    const result = await updateReferences(testDir, "old-file.md", "new-file.md", false);

    expect(result.referencesUpdated).toBe(1);
    expect(result.filesModified).toBe(1);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("See [[new-file]] for more info.");
  });

  test("updates wikilink with path [[path/name]]", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "See [[Projects/old-note]] for details."
    );

    const result = await updateReferences(testDir, "Projects/old-note.md", "Projects/new-note.md", false);

    expect(result.referencesUpdated).toBe(1);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("See [[Projects/new-note]] for details.");
  });

  test("updates multiple wikilinks in same file", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "First link: [[old-file]]\nSecond link: [[old-file]]\nDone."
    );

    const result = await updateReferences(testDir, "old-file.md", "new-file.md", false);

    expect(result.referencesUpdated).toBe(2);
    expect(result.filesModified).toBe(1);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("First link: [[new-file]]\nSecond link: [[new-file]]\nDone.");
  });

  test("updates wikilinks across multiple files", async () => {
    await writeFile(join(testDir, "file1.md"), "Link: [[old-file]]");
    await writeFile(join(testDir, "file2.md"), "Another link: [[old-file]]");

    const result = await updateReferences(testDir, "old-file.md", "new-file.md", false);

    expect(result.referencesUpdated).toBe(2);
    expect(result.filesModified).toBe(2);

    const content1 = await readFile(join(testDir, "file1.md"), "utf-8");
    const content2 = await readFile(join(testDir, "file2.md"), "utf-8");
    expect(content1).toBe("Link: [[new-file]]");
    expect(content2).toBe("Another link: [[new-file]]");
  });

  test("does not modify unrelated wikilinks", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "See [[old-file]] and [[other-file]] for info."
    );

    await updateReferences(testDir, "old-file.md", "new-file.md", false);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("See [[new-file]] and [[other-file]] for info.");
  });
});

// =============================================================================
// Markdown Link Reference Tests
// =============================================================================

describe("updateReferences - Markdown Links", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("updates markdown link [text](path)", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "See [this file](old-file.md) for more."
    );

    const result = await updateReferences(testDir, "old-file.md", "new-file.md", false);

    expect(result.referencesUpdated).toBe(1);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("See [this file](new-file.md) for more.");
  });

  test("updates markdown link with full path", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "See [details](Projects/old-note.md) here."
    );

    const result = await updateReferences(testDir, "Projects/old-note.md", "Projects/new-note.md", false);

    expect(result.referencesUpdated).toBe(1);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("See [details](Projects/new-note.md) here.");
  });

  test("preserves link text when updating path", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "Check out [my important document](old-file.md)!"
    );

    await updateReferences(testDir, "old-file.md", "new-file.md", false);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("Check out [my important document](new-file.md)!");
  });

  test("updates multiple markdown links", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "[First](old-file.md) and [Second](old-file.md)"
    );

    const result = await updateReferences(testDir, "old-file.md", "new-file.md", false);

    expect(result.referencesUpdated).toBe(2);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("[First](new-file.md) and [Second](new-file.md)");
  });
});

// =============================================================================
// Directory Rename Reference Tests
// =============================================================================

describe("updateReferences - Directory Rename", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("updates wikilinks to files inside renamed directory", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "See [[OldDir/some-file]] for details."
    );

    const result = await updateReferences(testDir, "OldDir", "NewDir", true);

    expect(result.referencesUpdated).toBe(1);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("See [[NewDir/some-file]] for details.");
  });

  test("updates markdown links to files inside renamed directory", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "See [doc](OldDir/file.md) here."
    );

    const result = await updateReferences(testDir, "OldDir", "NewDir", true);

    expect(result.referencesUpdated).toBe(1);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("See [doc](NewDir/file.md) here.");
  });

  test("updates deeply nested directory references", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "Link: [[old-parent/child/file]]\nAnother: [doc](old-parent/child/other.md)"
    );

    const result = await updateReferences(testDir, "old-parent", "new-parent", true);

    expect(result.referencesUpdated).toBe(2);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toContain("[[new-parent/child/file]]");
    expect(content).toContain("[doc](new-parent/child/other.md)");
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("updateReferences - Edge Cases", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("handles files in nested directories", async () => {
    await mkdir(join(testDir, "docs", "guides"), { recursive: true });
    await writeFile(
      join(testDir, "docs", "guides", "index.md"),
      "Link: [[old-file]]"
    );

    const result = await updateReferences(testDir, "old-file.md", "new-file.md", false);

    expect(result.referencesUpdated).toBe(1);

    const content = await readFile(join(testDir, "docs", "guides", "index.md"), "utf-8");
    expect(content).toBe("Link: [[new-file]]");
  });

  test("skips hidden files", async () => {
    await writeFile(join(testDir, ".hidden.md"), "Link: [[old-file]]");
    await writeFile(join(testDir, "visible.md"), "Link: [[old-file]]");

    const result = await updateReferences(testDir, "old-file.md", "new-file.md", false);

    // Only the visible file should be updated
    expect(result.filesModified).toBe(1);

    // Hidden file should be unchanged
    const hidden = await readFile(join(testDir, ".hidden.md"), "utf-8");
    expect(hidden).toBe("Link: [[old-file]]");
  });

  test("skips hidden directories", async () => {
    await mkdir(join(testDir, ".hidden"));
    await writeFile(join(testDir, ".hidden", "file.md"), "Link: [[old-file]]");
    await writeFile(join(testDir, "visible.md"), "Link: [[old-file]]");

    const result = await updateReferences(testDir, "old-file.md", "new-file.md", false);

    expect(result.filesModified).toBe(1);
  });

  test("returns zero counts when no references found", async () => {
    await writeFile(join(testDir, "index.md"), "No references here.");

    const result = await updateReferences(testDir, "old-file.md", "new-file.md", false);

    expect(result.referencesUpdated).toBe(0);
    expect(result.filesModified).toBe(0);
  });

  test("handles empty vault", async () => {
    const result = await updateReferences(testDir, "old-file.md", "new-file.md", false);

    expect(result.referencesUpdated).toBe(0);
    expect(result.filesModified).toBe(0);
  });

  test("handles special regex characters in file names", async () => {
    await writeFile(
      join(testDir, "index.md"),
      "Link: [[file-with-dash]]"
    );

    const result = await updateReferences(testDir, "file-with-dash.md", "new-name.md", false);

    expect(result.referencesUpdated).toBe(1);

    const content = await readFile(join(testDir, "index.md"), "utf-8");
    expect(content).toBe("Link: [[new-name]]");
  });
});

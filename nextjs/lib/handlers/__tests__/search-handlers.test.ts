/**
 * Search Handlers Tests
 *
 * Verifies that search handlers use the content root path (not the vault root)
 * for indexing and search operations. This is the integration point where
 * issue #449 manifests: when contentRoot is non-empty, search results must
 * return paths relative to the content root.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { searchFilesRest, searchContentRest, getSnippetsRest } from "../search-handlers";
import { clearCache } from "../../search-cache";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `search-handler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("search handlers with contentRoot", () => {
  let vaultRoot: string;
  let contentRoot: string;

  afterEach(async () => {
    clearCache();
    if (vaultRoot) {
      await cleanupTestDir(vaultRoot);
    }
  });

  /**
   * Sets up a vault with contentRoot="content" containing files that should
   * be indexed relative to the content directory, not the vault root.
   *
   * Structure:
   *   vault-root/
   *     CLAUDE.md           (at vault root, outside content)
   *     content/
   *       A/
   *         B/
   *           C.md          (the file we search for)
   *       notes/
   *         meeting.md
   */
  async function setupVaultWithContentRoot(): Promise<void> {
    vaultRoot = await createTestDir();
    contentRoot = join(vaultRoot, "content");

    await mkdir(join(contentRoot, "A", "B"), { recursive: true });
    await mkdir(join(contentRoot, "notes"), { recursive: true });

    await writeFile(
      join(vaultRoot, "CLAUDE.md"),
      "# Test Vault\n"
    );
    await writeFile(
      join(contentRoot, "A", "B", "C.md"),
      "# Deep File\n\nThis is a deeply nested file with unique search term xylophone.\n"
    );
    await writeFile(
      join(contentRoot, "notes", "meeting.md"),
      "# Meeting Notes\n\nDiscussed the xylophone implementation.\n"
    );
  }

  test("searchFilesRest returns paths relative to contentRoot, not vault root", async () => {
    await setupVaultWithContentRoot();

    const result = await searchFilesRest("test-vault", contentRoot, "C", 10);

    expect(result.results.length).toBeGreaterThanOrEqual(1);

    const cFile = result.results.find((r) => r.name === "C.md");
    expect(cFile).toBeDefined();
    // Path should be relative to contentRoot: "A/B/C.md"
    // NOT relative to vault root: "content/A/B/C.md"
    expect(cFile!.path).toBe("A/B/C.md");
    expect(cFile!.path).not.toContain("content/");
  });

  test("searchContentRest returns paths relative to contentRoot", async () => {
    await setupVaultWithContentRoot();

    const result = await searchContentRest("test-vault-content", contentRoot, "xylophone", 10);

    expect(result.results.length).toBeGreaterThanOrEqual(1);

    for (const r of result.results) {
      // No result path should contain "content/" prefix
      expect(r.path).not.toContain("content/");
    }

    const deepFile = result.results.find((r) => r.path === "A/B/C.md");
    expect(deepFile).toBeDefined();
  });

  test("getSnippetsRest resolves file paths relative to contentRoot", async () => {
    await setupVaultWithContentRoot();

    // Use a unique vault ID to avoid cache collision with previous tests
    const snippets = await getSnippetsRest(
      "test-vault-snippets",
      contentRoot,
      "A/B/C.md",
      "xylophone"
    );

    expect(snippets.length).toBeGreaterThanOrEqual(1);
    expect(snippets[0].line).toContain("xylophone");
  });
});

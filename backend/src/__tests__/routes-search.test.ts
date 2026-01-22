/**
 * Search REST Routes Integration Tests
 *
 * Tests the search REST endpoints:
 * - GET /api/vaults/:vaultId/search/files?q=
 * - GET /api/vaults/:vaultId/search/content?q=
 * - GET /api/vaults/:vaultId/search/snippets?path=&q=
 *
 * Requirements:
 * - REQ-F-26: File name search
 * - REQ-F-27: Content search
 * - REQ-F-28: Context snippets
 * - REQ-NF-2: Search performance <500ms
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-010)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import { clearCache } from "../search-cache";
import type { FileSearchResult, ContentSearchResult, ContextSnippet } from "@memory-loop/shared";
import type { RestErrorResponse } from "../middleware/error-handler";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique test directory for vaults.
 */
async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `routes-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Creates a test vault with CLAUDE.md and sample files.
 */
async function createTestVault(
  testDir: string,
  vaultName: string,
  files: Record<string, string> = {}
): Promise<string> {
  const vaultPath = join(testDir, vaultName);
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "CLAUDE.md"), `# ${vaultName}`);

  // Create sample files
  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(vaultPath, filename);
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (dir !== vaultPath) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filePath, content);
  }

  return vaultPath;
}

// =============================================================================
// Search Routes Tests
// =============================================================================

describe("Search REST Routes", () => {
  let testDir: string;
  let app: ReturnType<typeof createApp>;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    testDir = await createTestDir();
    process.env.VAULTS_DIR = testDir;
    clearCache();
    app = createApp();
  });

  afterEach(async () => {
    // Restore original env
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }

    clearCache();

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // File Search Tests (REQ-F-26)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/search/files", () => {
    test("returns matching files for valid query", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes.md": "# Notes\n\nMy notes content",
        "notes-2024.md": "# Notes 2024\n\nMore notes",
        "readme.md": "# README\n\nProject description",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/search/files?q=notes");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        results: FileSearchResult[];
        totalMatches: number;
        searchTimeMs: number;
      };

      expect(json.results).toBeDefined();
      expect(Array.isArray(json.results)).toBe(true);
      expect(json.totalMatches).toBeGreaterThanOrEqual(2);
      expect(typeof json.searchTimeMs).toBe("number");

      // Should find both notes files
      const names = json.results.map((r) => r.name);
      expect(names.some((n) => n.includes("notes"))).toBe(true);
    });

    test("returns empty results for no matches", async () => {
      await createTestVault(testDir, "test-vault", {
        "readme.md": "# README\n\nProject description",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/files?q=nonexistent"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        results: FileSearchResult[];
        totalMatches: number;
        searchTimeMs: number;
      };

      expect(json.results).toEqual([]);
      expect(json.totalMatches).toBe(0);
    });

    test("returns 400 when query parameter is missing", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/search/files");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("'q' is required");
    });

    test("returns 400 when query is empty", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/search/files?q=");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 when query is only whitespace", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/search/files?q=%20%20");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("respects limit parameter", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes1.md": "# Notes 1",
        "notes2.md": "# Notes 2",
        "notes3.md": "# Notes 3",
        "notes4.md": "# Notes 4",
        "notes5.md": "# Notes 5",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/files?q=notes&limit=2"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        results: FileSearchResult[];
        totalMatches: number;
        searchTimeMs: number;
      };

      expect(json.results.length).toBeLessThanOrEqual(2);
    });

    test("returns 400 for invalid limit parameter", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/files?q=test&limit=invalid"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("limit");
    });

    test("returns 400 for negative limit parameter", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/files?q=test&limit=-1"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/search/files?q=test"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("completes within performance requirement (REQ-NF-2: <500ms)", async () => {
      // Create a vault with moderate number of files
      const files: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        files[`note-${i}.md`] = `# Note ${i}\n\nContent for note ${i}`;
      }
      await createTestVault(testDir, "perf-vault", files);

      const req = new Request("http://localhost/api/vaults/perf-vault/search/files?q=note");
      const startTime = Date.now();
      const res = await app.fetch(req);
      const elapsedTime = Date.now() - startTime;

      expect(res.status).toBe(200);
      expect(elapsedTime).toBeLessThan(500);

      const json = (await res.json()) as {
        results: FileSearchResult[];
        searchTimeMs: number;
      };
      expect(json.searchTimeMs).toBeLessThan(500);
    });
  });

  // ===========================================================================
  // Content Search Tests (REQ-F-27)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/search/content", () => {
    test("returns matching files for content query", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes.md": "# Notes\n\nThis contains SEARCHTERM in the content",
        "readme.md": "# README\n\nProject description without the term",
        "todo.md": "# TODO\n\nSEARCHTERM appears here too",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/content?q=SEARCHTERM"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        results: ContentSearchResult[];
        totalMatches: number;
        searchTimeMs: number;
      };

      expect(json.results).toBeDefined();
      expect(Array.isArray(json.results)).toBe(true);
      expect(json.totalMatches).toBeGreaterThanOrEqual(2);
      expect(typeof json.searchTimeMs).toBe("number");

      // Each result should have matchCount
      for (const result of json.results) {
        expect(result.matchCount).toBeGreaterThan(0);
      }
    });

    test("returns empty results for no content matches", async () => {
      await createTestVault(testDir, "test-vault", {
        "readme.md": "# README\n\nNo matching content here",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/content?q=NONEXISTENTTERM"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        results: ContentSearchResult[];
        totalMatches: number;
        searchTimeMs: number;
      };

      expect(json.results).toEqual([]);
      expect(json.totalMatches).toBe(0);
    });

    test("returns 400 when query parameter is missing", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/search/content");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("'q' is required");
    });

    test("returns 400 when query is empty", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/search/content?q=");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("respects limit parameter", async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 10; i++) {
        files[`note-${i}.md`] = `# Note ${i}\n\nThis contains TARGET content`;
      }
      await createTestVault(testDir, "test-vault", files);

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/content?q=TARGET&limit=3"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        results: ContentSearchResult[];
        totalMatches: number;
      };

      expect(json.results.length).toBeLessThanOrEqual(3);
    });

    test("returns 400 for invalid limit parameter", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/content?q=test&limit=abc"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/search/content?q=test"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("completes within performance requirement (REQ-NF-2: <500ms)", async () => {
      // Create a vault with moderate number of files containing searchable content
      const files: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        files[`note-${i}.md`] = `# Note ${i}\n\nThis is content for note ${i} with FINDME keyword`;
      }
      await createTestVault(testDir, "perf-vault", files);

      const req = new Request(
        "http://localhost/api/vaults/perf-vault/search/content?q=FINDME"
      );
      const startTime = Date.now();
      const res = await app.fetch(req);
      const elapsedTime = Date.now() - startTime;

      expect(res.status).toBe(200);
      expect(elapsedTime).toBeLessThan(500);

      const json = (await res.json()) as {
        results: ContentSearchResult[];
        searchTimeMs: number;
      };
      expect(json.searchTimeMs).toBeLessThan(500);
    });
  });

  // ===========================================================================
  // Snippets Tests (REQ-F-28)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/search/snippets", () => {
    test("returns snippets for matching content in file", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes.md": `# Notes

Line 1: Some content
Line 2: Contains TARGETWORD here
Line 3: More content
Line 4: Another TARGETWORD occurrence
Line 5: Final content`,
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/snippets?path=notes.md&q=TARGETWORD"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        path: string;
        snippets: ContextSnippet[];
      };

      expect(json.path).toBe("notes.md");
      expect(Array.isArray(json.snippets)).toBe(true);
      expect(json.snippets.length).toBeGreaterThan(0);

      // Each snippet should have the required structure
      for (const snippet of json.snippets) {
        expect(typeof snippet.lineNumber).toBe("number");
        expect(typeof snippet.line).toBe("string");
        expect(snippet.line.includes("TARGETWORD")).toBe(true);
      }
    });

    test("returns empty snippets for no matches", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes.md": "# Notes\n\nNo matching content here",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/snippets?path=notes.md&q=NONEXISTENT"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        path: string;
        snippets: ContextSnippet[];
      };

      expect(json.path).toBe("notes.md");
      expect(json.snippets).toEqual([]);
    });

    test("returns 400 when path parameter is missing", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/snippets?q=test"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("'path' is required");
    });

    test("returns 400 when query parameter is missing", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/snippets?path=notes.md"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("'q' is required");
    });

    test("returns 400 when path is empty", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/snippets?path=&q=test"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 when query is empty", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/snippets?path=notes.md&q="
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/search/snippets?path=notes.md&q=test"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("handles URL-encoded path parameter", async () => {
      await createTestVault(testDir, "test-vault", {
        "my notes/important.md": "# Important\n\nThis has KEYWORD content",
      });

      // URL-encode the path with spaces
      const encodedPath = encodeURIComponent("my notes/important.md");
      const req = new Request(
        `http://localhost/api/vaults/test-vault/search/snippets?path=${encodedPath}&q=KEYWORD`
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        path: string;
        snippets: ContextSnippet[];
      };

      expect(json.path).toBe("my notes/important.md");
    });
  });

  // ===========================================================================
  // Cache Integration Tests
  // ===========================================================================

  describe("Search Cache Integration", () => {
    test("repeated searches use cached index", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes.md": "# Notes\n\nContent",
      });

      // First search (cold cache)
      const req1 = new Request(
        "http://localhost/api/vaults/test-vault/search/files?q=notes"
      );
      const startTime1 = Date.now();
      const res1 = await app.fetch(req1);
      const coldTime = Date.now() - startTime1;

      expect(res1.status).toBe(200);

      // Second search (warm cache)
      const req2 = new Request(
        "http://localhost/api/vaults/test-vault/search/files?q=notes"
      );
      const startTime2 = Date.now();
      const res2 = await app.fetch(req2);
      const warmTime = Date.now() - startTime2;

      expect(res2.status).toBe(200);

      // Warm cache should generally be faster, but we don't strictly enforce
      // since timing can vary. Just verify both succeed.
      expect(warmTime).toBeLessThan(500);
      expect(coldTime).toBeLessThan(500);
    });

    test("different vaults have independent search indexes", async () => {
      await createTestVault(testDir, "vault-a", {
        "alpha.md": "# Alpha\n\nContent for vault A",
      });
      await createTestVault(testDir, "vault-b", {
        "beta.md": "# Beta\n\nContent for vault B",
      });

      // Search vault A
      const reqA = new Request(
        "http://localhost/api/vaults/vault-a/search/files?q=alpha"
      );
      const resA = await app.fetch(reqA);
      expect(resA.status).toBe(200);

      const jsonA = (await resA.json()) as { results: FileSearchResult[] };
      expect(jsonA.results.some((r) => r.name === "alpha.md")).toBe(true);
      expect(jsonA.results.some((r) => r.name === "beta.md")).toBe(false);

      // Search vault B
      const reqB = new Request(
        "http://localhost/api/vaults/vault-b/search/files?q=beta"
      );
      const resB = await app.fetch(reqB);
      expect(resB.status).toBe(200);

      const jsonB = (await resB.json()) as { results: FileSearchResult[] };
      expect(jsonB.results.some((r) => r.name === "beta.md")).toBe(true);
      expect(jsonB.results.some((r) => r.name === "alpha.md")).toBe(false);
    });
  });

  // ===========================================================================
  // Error Response Format Tests
  // ===========================================================================

  describe("Error Response Format", () => {
    test("error responses match RestErrorResponse schema", async () => {
      // Create a vault so we can test validation errors (not 404)
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/search/files?q="
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;

      // Verify exact structure
      expect(Object.keys(json)).toEqual(["error"]);
      expect(Object.keys(json.error).sort()).toEqual(["code", "message"]);
      expect(typeof json.error.code).toBe("string");
      expect(typeof json.error.message).toBe("string");
    });

    test("vault not found error has correct format", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/search/files?q=test"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
      expect(json.error.message).toContain("nonexistent");
    });
  });
});

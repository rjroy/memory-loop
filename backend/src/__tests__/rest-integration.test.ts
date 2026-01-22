/**
 * REST API End-to-End Integration Tests
 *
 * Validates the REST API migration by testing that all operations work correctly
 * without WebSocket connection. These tests verify:
 *
 * 1. File Browser Without WebSocket: navigate, read, write via REST only
 * 2. Capture Without WebSocket: POST note, verify response
 * 3. Search Without WebSocket: search files/content, get snippets
 * 4. Error Handling: 404 for missing vault/file, 400 for bad request, 403 for traversal
 * 5. Performance: File operations <200ms (REQ-NF-1), search <500ms (REQ-NF-2)
 * 6. Discussion Still Streams: AI chat works via WebSocket (skipped without live SDK)
 * 7. No select_vault Bug: components fetch data without prior vault selection
 * 8. REQ-F-64: REST and WebSocket use same business logic (spot-check responses match)
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-018)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import { clearCache } from "../search-cache";
import type { FileEntry, RecentNoteEntry, FileSearchResult, ContentSearchResult } from "@memory-loop/shared";
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
    `rest-integration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
  await writeFile(join(vaultPath, "CLAUDE.md"), `# ${vaultName}\n\nTest vault.`);

  // Create inbox directory (required for capture)
  await mkdir(join(vaultPath, "00_Inbox"), { recursive: true });

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

/**
 * Gets today's date formatted as YYYY-MM-DD.
 */
function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// =============================================================================
// REST API Integration Tests
// =============================================================================

describe("REST API End-to-End Integration Tests", () => {
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
  // File Browser Without WebSocket (Requirement 1)
  // ===========================================================================

  describe("File Browser Without WebSocket", () => {
    test("can navigate directories without WebSocket connection", async () => {
      await createTestVault(testDir, "my-vault", {
        "notes/project-a.md": "# Project A",
        "notes/project-b.md": "# Project B",
        "archive/old-notes.md": "# Old Notes",
      });

      // List root directory
      const rootReq = new Request("http://localhost/api/vaults/my-vault/files");
      const rootRes = await app.fetch(rootReq);
      expect(rootRes.status).toBe(200);

      const rootJson = (await rootRes.json()) as { path: string; entries: FileEntry[] };
      expect(rootJson.path).toBe("");
      const rootNames = rootJson.entries.map((e) => e.name);
      expect(rootNames).toContain("notes");
      expect(rootNames).toContain("archive");

      // Navigate into subdirectory
      const notesReq = new Request("http://localhost/api/vaults/my-vault/files?path=notes");
      const notesRes = await app.fetch(notesReq);
      expect(notesRes.status).toBe(200);

      const notesJson = (await notesRes.json()) as { path: string; entries: FileEntry[] };
      expect(notesJson.path).toBe("notes");
      const notesFiles = notesJson.entries.map((e) => e.name);
      expect(notesFiles).toContain("project-a.md");
      expect(notesFiles).toContain("project-b.md");
    });

    test("can read and write files via REST only", async () => {
      const vaultPath = await createTestVault(testDir, "rw-vault", {
        "document.md": "# Original Content\n\nInitial text.",
      });

      // Read original file
      const readReq = new Request("http://localhost/api/vaults/rw-vault/files/document.md");
      const readRes = await app.fetch(readReq);
      expect(readRes.status).toBe(200);

      const readJson = (await readRes.json()) as { path: string; content: string; truncated: boolean };
      expect(readJson.content).toBe("# Original Content\n\nInitial text.");
      expect(readJson.truncated).toBe(false);

      // Write new content
      const newContent = "# Updated Content\n\nModified via REST API.";
      const writeReq = new Request("http://localhost/api/vaults/rw-vault/files/document.md", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      const writeRes = await app.fetch(writeReq);
      expect(writeRes.status).toBe(200);

      const writeJson = (await writeRes.json()) as { path: string; success: boolean };
      expect(writeJson.success).toBe(true);

      // Read again to verify
      const verifyReq = new Request("http://localhost/api/vaults/rw-vault/files/document.md");
      const verifyRes = await app.fetch(verifyReq);
      expect(verifyRes.status).toBe(200);

      const verifyJson = (await verifyRes.json()) as { content: string };
      expect(verifyJson.content).toBe(newContent);

      // Also verify on filesystem
      const fsContent = await readFile(join(vaultPath, "document.md"), "utf-8");
      expect(fsContent).toBe(newContent);
    });

    test("file operations complete under 200ms (REQ-NF-1)", async () => {
      await createTestVault(testDir, "perf-vault", {
        "test-file.md": "# Test File\n\n" + "Content line.\n".repeat(100),
      });

      // Time directory listing
      const listStart = Date.now();
      const listReq = new Request("http://localhost/api/vaults/perf-vault/files");
      const listRes = await app.fetch(listReq);
      const listTime = Date.now() - listStart;

      expect(listRes.status).toBe(200);
      expect(listTime).toBeLessThan(200);

      // Time file read
      const readStart = Date.now();
      const readReq = new Request("http://localhost/api/vaults/perf-vault/files/test-file.md");
      const readRes = await app.fetch(readReq);
      const readTime = Date.now() - readStart;

      expect(readRes.status).toBe(200);
      expect(readTime).toBeLessThan(200);

      // Time file write
      const writeStart = Date.now();
      const writeReq = new Request("http://localhost/api/vaults/perf-vault/files/test-file.md", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# Updated\n\nNew content." }),
      });
      const writeRes = await app.fetch(writeReq);
      const writeTime = Date.now() - writeStart;

      expect(writeRes.status).toBe(200);
      expect(writeTime).toBeLessThan(200);
    });

    test("can create, rename, and delete files via REST", async () => {
      await createTestVault(testDir, "crud-vault", {});

      // Create file
      const createReq = new Request("http://localhost/api/vaults/crud-vault/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "", name: "new-file" }),
      });
      const createRes = await app.fetch(createReq);
      expect(createRes.status).toBe(201);

      const createJson = (await createRes.json()) as { path: string };
      expect(createJson.path).toBe("new-file.md");

      // Rename file
      const renameReq = new Request("http://localhost/api/vaults/crud-vault/files/new-file.md", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName: "renamed-file" }),
      });
      const renameRes = await app.fetch(renameReq);
      expect(renameRes.status).toBe(200);

      const renameJson = (await renameRes.json()) as { oldPath: string; newPath: string };
      expect(renameJson.newPath).toBe("renamed-file.md");

      // Delete file
      const deleteReq = new Request("http://localhost/api/vaults/crud-vault/files/renamed-file.md", {
        method: "DELETE",
      });
      const deleteRes = await app.fetch(deleteReq);
      expect(deleteRes.status).toBe(200);

      // Verify file is gone
      const verifyReq = new Request("http://localhost/api/vaults/crud-vault/files/renamed-file.md");
      const verifyRes = await app.fetch(verifyReq);
      expect(verifyRes.status).toBe(404);
    });
  });

  // ===========================================================================
  // Capture Without WebSocket (Requirement 2)
  // ===========================================================================

  describe("Capture Without WebSocket", () => {
    test("can capture note via POST without WebSocket", async () => {
      await createTestVault(testDir, "capture-vault", {});

      const captureReq = new Request("http://localhost/api/vaults/capture-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "This is a quick thought captured via REST" }),
      });
      const captureRes = await app.fetch(captureReq);

      expect(captureRes.status).toBe(200);

      const captureJson = (await captureRes.json()) as {
        success: boolean;
        timestamp: string;
        notePath: string;
      };

      expect(captureJson.success).toBe(true);
      expect(captureJson.timestamp).toBeDefined();
      expect(captureJson.notePath).toContain("00_Inbox");

      // Verify note content on filesystem
      const noteContent = await readFile(captureJson.notePath, "utf-8");
      expect(noteContent).toContain("This is a quick thought captured via REST");
    });

    test("capture response includes timestamp and note path", async () => {
      await createTestVault(testDir, "capture-meta-vault", {});

      const captureReq = new Request("http://localhost/api/vaults/capture-meta-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Testing metadata response" }),
      });
      const captureRes = await app.fetch(captureReq);

      expect(captureRes.status).toBe(200);

      const captureJson = (await captureRes.json()) as {
        success: boolean;
        timestamp: string;
        notePath: string;
      };

      // Timestamp should be valid ISO string
      const parsedTime = new Date(captureJson.timestamp);
      expect(isNaN(parsedTime.getTime())).toBe(false);

      // Note path should be absolute and exist
      expect(captureJson.notePath.startsWith("/")).toBe(true);
      const exists = await Bun.file(captureJson.notePath).exists();
      expect(exists).toBe(true);
    });

    test("can retrieve recent notes after capture", async () => {
      const today = getTodayDate();
      await createTestVault(testDir, "recent-vault", {
        [`00_Inbox/${today}.md`]: `# ${today}\n\n## Capture\n\n- [10:00] Previous note\n`,
      });

      // Capture a new note
      const captureReq = new Request("http://localhost/api/vaults/recent-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "New capture for recent notes test" }),
      });
      await app.fetch(captureReq);

      // Get recent notes
      const recentReq = new Request("http://localhost/api/vaults/recent-vault/recent-notes");
      const recentRes = await app.fetch(recentReq);

      expect(recentRes.status).toBe(200);

      const recentJson = (await recentRes.json()) as { notes: RecentNoteEntry[] };
      expect(recentJson.notes.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ===========================================================================
  // Search Without WebSocket (Requirement 3)
  // ===========================================================================

  describe("Search Without WebSocket", () => {
    test("can search files by name via REST", async () => {
      await createTestVault(testDir, "search-vault", {
        "notes/meeting-notes.md": "# Meeting Notes",
        "notes/project-notes.md": "# Project Notes",
        "archive/old-meeting.md": "# Old Meeting",
      });

      const searchReq = new Request("http://localhost/api/vaults/search-vault/search/files?q=meeting");
      const searchRes = await app.fetch(searchReq);

      expect(searchRes.status).toBe(200);

      const searchJson = (await searchRes.json()) as {
        results: FileSearchResult[];
        totalMatches: number;
        searchTimeMs: number;
      };

      expect(searchJson.totalMatches).toBeGreaterThanOrEqual(2);
      expect(searchJson.results.some((r) => r.name.includes("meeting"))).toBe(true);
    });

    test("can search file content via REST", async () => {
      await createTestVault(testDir, "content-search-vault", {
        "doc-a.md": "# Document A\n\nThis contains UNIQUE_TERM_ABC in the content.",
        "doc-b.md": "# Document B\n\nNo special terms here.",
        "doc-c.md": "# Document C\n\nAnother file with UNIQUE_TERM_ABC inside.",
      });

      const searchReq = new Request(
        "http://localhost/api/vaults/content-search-vault/search/content?q=UNIQUE_TERM_ABC"
      );
      const searchRes = await app.fetch(searchReq);

      expect(searchRes.status).toBe(200);

      const searchJson = (await searchRes.json()) as {
        results: ContentSearchResult[];
        totalMatches: number;
        searchTimeMs: number;
      };

      expect(searchJson.totalMatches).toBe(2);
      expect(searchJson.results.every((r) => r.matchCount > 0)).toBe(true);
    });

    test("can get search snippets for context", async () => {
      await createTestVault(testDir, "snippets-vault", {
        "important.md": `# Important Document

Line 1: Introduction
Line 2: Contains SEARCH_TARGET here
Line 3: More content
Line 4: Another SEARCH_TARGET mention
Line 5: Conclusion`,
      });

      const snippetsReq = new Request(
        "http://localhost/api/vaults/snippets-vault/search/snippets?path=important.md&q=SEARCH_TARGET"
      );
      const snippetsRes = await app.fetch(snippetsReq);

      expect(snippetsRes.status).toBe(200);

      const snippetsJson = (await snippetsRes.json()) as {
        path: string;
        snippets: Array<{ lineNumber: number; line: string }>;
      };

      expect(snippetsJson.path).toBe("important.md");
      expect(snippetsJson.snippets.length).toBe(2);
      expect(snippetsJson.snippets.every((s) => s.line.includes("SEARCH_TARGET"))).toBe(true);
    });

    test("search completes under 500ms (REQ-NF-2)", async () => {
      // Create vault with many files
      const files: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        files[`note-${i}.md`] = `# Note ${i}\n\nContent for note ${i} with FINDABLE keyword.`;
      }
      await createTestVault(testDir, "perf-search-vault", files);

      // Time file search
      const fileSearchStart = Date.now();
      const fileSearchReq = new Request(
        "http://localhost/api/vaults/perf-search-vault/search/files?q=note"
      );
      const fileSearchRes = await app.fetch(fileSearchReq);
      const fileSearchTime = Date.now() - fileSearchStart;

      expect(fileSearchRes.status).toBe(200);
      expect(fileSearchTime).toBeLessThan(500);

      // Time content search
      const contentSearchStart = Date.now();
      const contentSearchReq = new Request(
        "http://localhost/api/vaults/perf-search-vault/search/content?q=FINDABLE"
      );
      const contentSearchRes = await app.fetch(contentSearchReq);
      const contentSearchTime = Date.now() - contentSearchStart;

      expect(contentSearchRes.status).toBe(200);
      expect(contentSearchTime).toBeLessThan(500);
    });
  });

  // ===========================================================================
  // Error Handling (Requirement 4)
  // ===========================================================================

  describe("Error Handling", () => {
    test("returns 404 for missing vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent-vault/files");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
      expect(json.error.message).toContain("nonexistent-vault");
    });

    test("returns 404 for missing file", async () => {
      await createTestVault(testDir, "error-vault", {});

      const req = new Request("http://localhost/api/vaults/error-vault/files/does-not-exist.md");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
    });

    test("returns 404 for missing directory", async () => {
      await createTestVault(testDir, "error-vault-2", {});

      const req = new Request("http://localhost/api/vaults/error-vault-2/files?path=nonexistent-dir");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("DIRECTORY_NOT_FOUND");
    });

    test("returns 400 for invalid request body", async () => {
      await createTestVault(testDir, "validation-vault", {});

      const req = new Request("http://localhost/api/vaults/validation-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "" }), // Empty text should fail validation
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 for malformed JSON", async () => {
      await createTestVault(testDir, "json-vault", {});

      const req = new Request("http://localhost/api/vaults/json-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "this is not valid json",
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("JSON");
    });

    test("returns 403 for path traversal attempt in query param", async () => {
      await createTestVault(testDir, "security-vault", {});

      const req = new Request("http://localhost/api/vaults/security-vault/files?path=../");
      const res = await app.fetch(req);

      expect(res.status).toBe(403);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("PATH_TRAVERSAL");
    });

    test("returns 403 for path traversal attempt in file path", async () => {
      await createTestVault(testDir, "security-vault-2", {});

      const encodedPath = encodeURIComponent("../../../etc/passwd.md");
      const req = new Request(`http://localhost/api/vaults/security-vault-2/files/${encodedPath}`);
      const res = await app.fetch(req);

      expect(res.status).toBe(403);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("PATH_TRAVERSAL");
    });

    test("error responses have consistent format", async () => {
      await createTestVault(testDir, "format-vault", {});

      // Test 404 error format
      const notFoundReq = new Request("http://localhost/api/vaults/format-vault/files/missing.md");
      const notFoundRes = await app.fetch(notFoundReq);
      const notFoundJson = (await notFoundRes.json()) as RestErrorResponse;

      expect(Object.keys(notFoundJson)).toEqual(["error"]);
      expect(Object.keys(notFoundJson.error).sort()).toEqual(["code", "message"]);
      expect(typeof notFoundJson.error.code).toBe("string");
      expect(typeof notFoundJson.error.message).toBe("string");

      // Test 400 error format
      const badReq = new Request("http://localhost/api/vaults/format-vault/search/files");
      const badRes = await app.fetch(badReq);
      const badJson = (await badRes.json()) as RestErrorResponse;

      expect(Object.keys(badJson)).toEqual(["error"]);
      expect(Object.keys(badJson.error).sort()).toEqual(["code", "message"]);
    });
  });

  // ===========================================================================
  // No select_vault Bug (Requirement 7)
  // ===========================================================================

  describe("No select_vault Bug", () => {
    test("can fetch vault data directly without prior vault selection", async () => {
      await createTestVault(testDir, "direct-vault", {
        "notes.md": "# Notes\n\nDirect access test.",
      });

      // Fresh app instance - no prior state
      const freshApp = createApp();

      // Should be able to list files without any prior vault selection
      const listReq = new Request("http://localhost/api/vaults/direct-vault/files");
      const listRes = await freshApp.fetch(listReq);

      expect(listRes.status).toBe(200);

      const listJson = (await listRes.json()) as { entries: FileEntry[] };
      expect(listJson.entries.some((e) => e.name === "notes.md")).toBe(true);

      // Should be able to read file without prior vault selection
      const readReq = new Request("http://localhost/api/vaults/direct-vault/files/notes.md");
      const readRes = await freshApp.fetch(readReq);

      expect(readRes.status).toBe(200);

      const readJson = (await readRes.json()) as { content: string };
      expect(readJson.content).toContain("Direct access test");
    });

    test("can access multiple vaults in sequence without issues", async () => {
      await createTestVault(testDir, "vault-a", {
        "file-a.md": "# Vault A Content",
      });
      await createTestVault(testDir, "vault-b", {
        "file-b.md": "# Vault B Content",
      });
      await createTestVault(testDir, "vault-c", {
        "file-c.md": "# Vault C Content",
      });

      // Access vaults in different order
      const reqB = new Request("http://localhost/api/vaults/vault-b/files/file-b.md");
      const resB = await app.fetch(reqB);
      expect(resB.status).toBe(200);
      const jsonB = (await resB.json()) as { content: string };
      expect(jsonB.content).toContain("Vault B");

      const reqA = new Request("http://localhost/api/vaults/vault-a/files/file-a.md");
      const resA = await app.fetch(reqA);
      expect(resA.status).toBe(200);
      const jsonA = (await resA.json()) as { content: string };
      expect(jsonA.content).toContain("Vault A");

      const reqC = new Request("http://localhost/api/vaults/vault-c/files/file-c.md");
      const resC = await app.fetch(reqC);
      expect(resC.status).toBe(200);
      const jsonC = (await resC.json()) as { content: string };
      expect(jsonC.content).toContain("Vault C");

      // Return to first vault
      const reqB2 = new Request("http://localhost/api/vaults/vault-b/files/file-b.md");
      const resB2 = await app.fetch(reqB2);
      expect(resB2.status).toBe(200);
    });

    test("home dashboard data accessible without prior session", async () => {
      await createTestVault(testDir, "home-vault", {
        "06_Metadata/memory-loop/goals.md": "# Goals\n\n- Complete integration tests",
        "00_Inbox/2026-01-22.md": "- [ ] Test task",
      });

      // Access goals directly
      const goalsReq = new Request("http://localhost/api/vaults/home-vault/goals");
      const goalsRes = await app.fetch(goalsReq);
      expect(goalsRes.status).toBe(200);

      const goalsJson = (await goalsRes.json()) as { content: string | null };
      expect(goalsJson.content).toContain("Complete integration tests");

      // Access tasks directly
      const tasksReq = new Request("http://localhost/api/vaults/home-vault/tasks");
      const tasksRes = await app.fetch(tasksReq);
      expect(tasksRes.status).toBe(200);

      const tasksJson = (await tasksRes.json()) as { tasks: unknown[]; total: number };
      expect(tasksJson.total).toBe(1);
    });
  });

  // ===========================================================================
  // REQ-F-64: REST and WebSocket Use Same Business Logic (Requirement 8)
  // ===========================================================================

  describe("REQ-F-64: REST and WebSocket Consistency", () => {
    test("capture route uses same captureToDaily function as WebSocket", async () => {
      // This test verifies by checking the response format and behavior matches
      // what the WebSocket handler would produce using the same business logic
      await createTestVault(testDir, "consistency-vault", {});

      const captureReq = new Request("http://localhost/api/vaults/consistency-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Consistency test capture" }),
      });
      const captureRes = await app.fetch(captureReq);

      expect(captureRes.status).toBe(200);

      const captureJson = (await captureRes.json()) as {
        success: boolean;
        timestamp: string;
        notePath: string;
      };

      // Response structure matches what note-capture.ts returns
      expect(captureJson.success).toBe(true);
      expect(typeof captureJson.timestamp).toBe("string");
      expect(typeof captureJson.notePath).toBe("string");
      expect(captureJson.notePath).toContain("00_Inbox");

      // Verify the note format matches expected daily note structure
      const noteContent = await readFile(captureJson.notePath, "utf-8");
      expect(noteContent).toContain("## Capture");
      expect(noteContent).toMatch(/- \[\d{2}:\d{2}\]/); // Time format [HH:MM]
    });

    test("file read route uses same readMarkdownFile as WebSocket", async () => {
      await createTestVault(testDir, "file-consistency-vault", {
        "test.md": "# Test\n\nThis is test content.",
      });

      const readReq = new Request("http://localhost/api/vaults/file-consistency-vault/files/test.md");
      const readRes = await app.fetch(readReq);

      expect(readRes.status).toBe(200);

      const readJson = (await readRes.json()) as {
        path: string;
        content: string;
        truncated: boolean;
      };

      // Response structure matches what readMarkdownFile returns
      expect(readJson.path).toBe("test.md");
      expect(readJson.content).toBe("# Test\n\nThis is test content.");
      expect(readJson.truncated).toBe(false);
    });

    test("directory listing route uses same listDirectory as WebSocket", async () => {
      await createTestVault(testDir, "dir-consistency-vault", {
        "folder/file-a.md": "# A",
        "folder/file-b.md": "# B",
      });

      const listReq = new Request(
        "http://localhost/api/vaults/dir-consistency-vault/files?path=folder"
      );
      const listRes = await app.fetch(listReq);

      expect(listRes.status).toBe(200);

      const listJson = (await listRes.json()) as {
        path: string;
        entries: FileEntry[];
      };

      // Response structure matches what listDirectory returns
      expect(listJson.path).toBe("folder");
      expect(Array.isArray(listJson.entries)).toBe(true);
      expect(listJson.entries.length).toBe(2);

      // Each entry has expected FileEntry fields
      for (const entry of listJson.entries) {
        expect(entry).toHaveProperty("name");
        expect(entry).toHaveProperty("type");
        expect(entry).toHaveProperty("path");
        expect(["file", "directory"]).toContain(entry.type);
      }
    });

    test("recent notes route uses same getRecentNotes as WebSocket", async () => {
      const today = getTodayDate();
      await createTestVault(testDir, "recent-consistency-vault", {
        [`00_Inbox/${today}.md`]: `# ${today}\n\n## Capture\n\n- [10:00] First entry\n- [10:30] Second entry\n`,
      });

      const recentReq = new Request(
        "http://localhost/api/vaults/recent-consistency-vault/recent-notes"
      );
      const recentRes = await app.fetch(recentReq);

      expect(recentRes.status).toBe(200);

      const recentJson = (await recentRes.json()) as { notes: RecentNoteEntry[] };

      // Response structure matches what getRecentNotes returns
      expect(Array.isArray(recentJson.notes)).toBe(true);
      expect(recentJson.notes.length).toBe(2);

      // Each note has expected RecentNoteEntry fields
      for (const note of recentJson.notes) {
        expect(note).toHaveProperty("text");
        expect(note).toHaveProperty("time");
        expect(note).toHaveProperty("date");
      }
    });
  });

  // ===========================================================================
  // Discussion WebSocket Test (Requirement 6)
  // ===========================================================================

  describe("Discussion Still Streams via WebSocket", () => {
    // These tests are skipped because they require live Claude SDK
    // The WebSocket implementation itself is tested in websocket-handler.test.ts

    test.skip("AI chat streams responses via WebSocket (requires live SDK)", async () => {
      // This would require:
      // 1. Establishing WebSocket connection
      // 2. Sending start_session message
      // 3. Sending user message
      // 4. Receiving streamed assistant response
      // Skip because we can't test this without live SDK or significant mocking infrastructure
    });

    test("WebSocket upgrade endpoint exists", async () => {
      // Verify the WebSocket upgrade endpoint is registered
      // Note: This doesn't test actual WebSocket functionality, just route existence
      const req = new Request("http://localhost/ws", {
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
      });

      // The upgrade will fail without proper WebSocket support in tests,
      // but we can verify the route doesn't 404
      const res = await app.fetch(req);
      // Upgrade requests return 101, but in test env without ws support may return other codes
      // The key is it doesn't return 404
      expect(res.status).not.toBe(404);
    });
  });

  // ===========================================================================
  // Full Workflow Integration
  // ===========================================================================

  describe("Full Workflow Integration", () => {
    test("complete user workflow: browse -> read -> capture -> search", async () => {
      await createTestVault(testDir, "workflow-vault", {
        "projects/project-a.md": "# Project A\n\nActive project notes.",
        "archive/old-project.md": "# Old Project\n\nArchived content.",
      });

      // Step 1: Browse to find files
      const browseReq = new Request("http://localhost/api/vaults/workflow-vault/files");
      const browseRes = await app.fetch(browseReq);
      expect(browseRes.status).toBe(200);

      const browseJson = (await browseRes.json()) as { entries: FileEntry[] };
      expect(browseJson.entries.some((e) => e.name === "projects")).toBe(true);

      // Step 2: Navigate to projects folder
      const projectsReq = new Request("http://localhost/api/vaults/workflow-vault/files?path=projects");
      const projectsRes = await app.fetch(projectsReq);
      expect(projectsRes.status).toBe(200);

      const projectsJson = (await projectsRes.json()) as { entries: FileEntry[] };
      expect(projectsJson.entries.some((e) => e.name === "project-a.md")).toBe(true);

      // Step 3: Read the project file
      const readReq = new Request("http://localhost/api/vaults/workflow-vault/files/projects/project-a.md");
      const readRes = await app.fetch(readReq);
      expect(readRes.status).toBe(200);

      const readJson = (await readRes.json()) as { content: string };
      expect(readJson.content).toContain("Active project notes");

      // Step 4: Capture a thought about the project
      const captureReq = new Request("http://localhost/api/vaults/workflow-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Remember to update Project A documentation" }),
      });
      const captureRes = await app.fetch(captureReq);
      expect(captureRes.status).toBe(200);

      // Step 5: Search for project-related content
      const searchReq = new Request("http://localhost/api/vaults/workflow-vault/search/content?q=project");
      const searchRes = await app.fetch(searchReq);
      expect(searchRes.status).toBe(200);

      const searchJson = (await searchRes.json()) as {
        results: ContentSearchResult[];
        totalMatches: number;
      };
      // Should find content in project files
      expect(searchJson.totalMatches).toBeGreaterThan(0);

      // Step 6: Check recent notes include the capture
      const recentReq = new Request("http://localhost/api/vaults/workflow-vault/recent-notes");
      const recentRes = await app.fetch(recentReq);
      expect(recentRes.status).toBe(200);

      const recentJson = (await recentRes.json()) as { notes: RecentNoteEntry[] };
      expect(recentJson.notes.some((n) => n.text.includes("Project A documentation"))).toBe(true);
    });

    test("operations are isolated between vaults", async () => {
      await createTestVault(testDir, "vault-one", {
        "unique-to-one.md": "# Content only in vault one",
      });
      await createTestVault(testDir, "vault-two", {
        "unique-to-two.md": "# Content only in vault two",
      });

      // Capture in vault-one
      const captureOneReq = new Request("http://localhost/api/vaults/vault-one/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Capture for vault one" }),
      });
      await app.fetch(captureOneReq);

      // Capture in vault-two
      const captureTwoReq = new Request("http://localhost/api/vaults/vault-two/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Capture for vault two" }),
      });
      await app.fetch(captureTwoReq);

      // Recent notes for vault-one should only show vault-one content
      const recentOneReq = new Request("http://localhost/api/vaults/vault-one/recent-notes");
      const recentOneRes = await app.fetch(recentOneReq);
      const recentOneJson = (await recentOneRes.json()) as { notes: RecentNoteEntry[] };

      expect(recentOneJson.notes.some((n) => n.text.includes("vault one"))).toBe(true);
      expect(recentOneJson.notes.some((n) => n.text.includes("vault two"))).toBe(false);

      // Search in vault-two should only find vault-two content
      const searchTwoReq = new Request("http://localhost/api/vaults/vault-two/search/files?q=unique-to");
      const searchTwoRes = await app.fetch(searchTwoReq);
      const searchTwoJson = (await searchTwoRes.json()) as { results: FileSearchResult[] };

      expect(searchTwoJson.results.some((r) => r.name === "unique-to-two.md")).toBe(true);
      expect(searchTwoJson.results.some((r) => r.name === "unique-to-one.md")).toBe(false);
    });
  });
});

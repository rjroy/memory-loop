/**
 * File Operations Integration Test
 *
 * End-to-end test that validates file, capture, meeting, task, search,
 * and daily-prep APIs work through the HTTP layer.
 * Uses temp directories with a fixture vault for isolation.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import { initVaultCache, resetCache } from "../vault";

const startTime = Date.now();
const app = createApp(startTime);
let testVaultsDir: string;
const VAULT_ID = "test-vault";

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return app.request(path, init);
}

describe("File Operations Integration", () => {
  beforeAll(async () => {
    testVaultsDir = join(
      tmpdir(),
      `file-ops-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    const vaultPath = join(testVaultsDir, VAULT_ID);
    const contentDir = join(vaultPath, "content");

    // Create vault structure
    await mkdir(join(contentDir, "notes"), { recursive: true });
    await mkdir(join(contentDir, "daily"), { recursive: true });
    await mkdir(join(contentDir, "00_Inbox"), { recursive: true });
    await mkdir(join(vaultPath, ".memory-loop", "sessions"), { recursive: true });

    // CLAUDE.md at vault root (required for discovery)
    await writeFile(
      join(vaultPath, "CLAUDE.md"),
      "# Test Vault\n\nA vault for integration testing.\n",
      "utf-8",
    );

    // Config pointing contentRoot to content/
    await writeFile(
      join(vaultPath, ".memory-loop.json"),
      JSON.stringify({ contentRoot: "content" }, null, 2),
      "utf-8",
    );

    // Fixture files inside content/
    await writeFile(
      join(contentDir, "notes", "hello.md"),
      "# Hello World\n\nSome test content.\n",
      "utf-8",
    );
    await writeFile(
      join(contentDir, "notes", "tasks.md"),
      "# Tasks\n\n- [ ] Buy groceries\n- [x] Write tests\n- [ ] Review PR\n",
      "utf-8",
    );
    // Tasks file in 00_Inbox (default task scan directory)
    await writeFile(
      join(contentDir, "00_Inbox", "todo.md"),
      "# Inbox Tasks\n\n- [ ] Inbox task one\n- [x] Inbox task done\n",
      "utf-8",
    );
    await writeFile(
      join(contentDir, "daily", "2026-03-15.md"),
      "# Daily Note\n\nExisting content.\n",
      "utf-8",
    );

    process.env.VAULTS_DIR = testVaultsDir;
    await initVaultCache();
  });

  afterAll(async () => {
    resetCache();
    delete process.env.VAULTS_DIR;
    try {
      await rm(testVaultsDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // File Operations
  // ===========================================================================

  describe("file CRUD", () => {
    test("GET /vaults/:id/files lists directory contents", async () => {
      const res = await request("GET", `/vaults/${VAULT_ID}/files`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ name: string }> };
      expect(body.entries).toBeDefined();
      expect(Array.isArray(body.entries)).toBe(true);

      const names = body.entries.map((e) => e.name);
      expect(names).toContain("notes");
      expect(names).toContain("daily");
    });

    test("GET /vaults/:id/files with path query lists subdirectory", async () => {
      const res = await request("GET", `/vaults/${VAULT_ID}/files?path=notes`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ name: string }> };
      const names = body.entries.map((e) => e.name);
      expect(names).toContain("hello.md");
      expect(names).toContain("tasks.md");
    });

    test("POST /vaults/:id/files creates a file", async () => {
      const res = await request("POST", `/vaults/${VAULT_ID}/files`, {
        path: "notes",
        name: "new-file",
      });
      expect(res.status).toBe(201);
    });

    test("GET /vaults/:id/files/* reads the created file", async () => {
      const res = await request("GET", `/vaults/${VAULT_ID}/files/notes/new-file.md`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { content: string };
      expect(body.content).toBeDefined();
    });

    test("PUT /vaults/:id/files/* updates file content", async () => {
      const res = await request("PUT", `/vaults/${VAULT_ID}/files/notes/new-file.md`, {
        content: "# Updated\n\nNew content here.\n",
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // Read back to verify
      const readRes = await request("GET", `/vaults/${VAULT_ID}/files/notes/new-file.md`);
      const readBody = (await readRes.json()) as { content: string };
      expect(readBody.content).toContain("# Updated");
    });

    test("PATCH /vaults/:id/files/* renames a file", async () => {
      const res = await request("PATCH", `/vaults/${VAULT_ID}/files/notes/new-file.md`, {
        newName: "renamed",
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { oldPath: string; newPath: string };
      expect(body.newPath).toContain("renamed");

      // Old path should 404
      const oldRes = await request("GET", `/vaults/${VAULT_ID}/files/notes/new-file.md`);
      expect(oldRes.status).toBe(404);

      // New path should work
      const newRes = await request("GET", `/vaults/${VAULT_ID}/files/notes/renamed.md`);
      expect(newRes.status).toBe(200);
    });

    test("DELETE /vaults/:id/files/* removes a file", async () => {
      const res = await request("DELETE", `/vaults/${VAULT_ID}/files/notes/renamed.md`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify it's gone
      const readRes = await request("GET", `/vaults/${VAULT_ID}/files/notes/renamed.md`);
      expect(readRes.status).toBe(404);
    });

    test("GET /vaults/:id/files/* reads an existing fixture file", async () => {
      const res = await request("GET", `/vaults/${VAULT_ID}/files/notes/hello.md`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { content: string };
      expect(body.content).toContain("Hello World");
      expect(body.content).toContain("Some test content");
    });

    test("GET /vaults/:id/files/* returns 404 for nonexistent file", async () => {
      const res = await request("GET", `/vaults/${VAULT_ID}/files/does-not-exist.md`);
      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // Capture Operations
  // ===========================================================================

  describe("capture", () => {
    test("POST /vaults/:id/capture appends to daily note", async () => {
      const res = await request("POST", `/vaults/${VAULT_ID}/capture`, {
        text: "Test capture entry",
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; target: string };
      expect(body.success).toBe(true);
      expect(body.target).toBe("daily");
    });

    test("POST /vaults/:id/capture rejects empty text", async () => {
      const res = await request("POST", `/vaults/${VAULT_ID}/capture`, {
        text: "",
      });
      expect(res.status).toBe(400);
    });

    test("POST /vaults/:id/capture rejects missing text field", async () => {
      const res = await request("POST", `/vaults/${VAULT_ID}/capture`, {
        content: "wrong field name",
      });
      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // Meeting Lifecycle
  // ===========================================================================

  describe("meetings", () => {
    test("GET /vaults/:id/meetings/current returns inactive when no meeting", async () => {
      const res = await request("GET", `/vaults/${VAULT_ID}/meetings/current`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { meeting: { isActive: boolean } };
      expect(body.meeting.isActive).toBe(false);
    });

    test("POST /vaults/:id/meetings starts a meeting", async () => {
      const res = await request("POST", `/vaults/${VAULT_ID}/meetings`, {
        title: "Test Meeting",
      });
      expect(res.status).toBe(201);

      const body = (await res.json()) as { meeting: { title: string } };
      expect(body.meeting).toBeDefined();
      expect(body.meeting.title).toBe("Test Meeting");
    });

    test("GET /vaults/:id/meetings/current returns active meeting", async () => {
      const res = await request("GET", `/vaults/${VAULT_ID}/meetings/current`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { meeting: { title: string } };
      expect(body.meeting).not.toBeNull();
      expect(body.meeting.title).toBe("Test Meeting");
    });

    test("POST /vaults/:id/meetings rejects second meeting while one is active", async () => {
      const res = await request("POST", `/vaults/${VAULT_ID}/meetings`, {
        title: "Another Meeting",
      });
      expect(res.status).toBe(409);

      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("MEETING_ACTIVE");
    });

    test("POST /vaults/:id/capture routes to meeting when active", async () => {
      const res = await request("POST", `/vaults/${VAULT_ID}/capture`, {
        text: "Meeting note entry",
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; target: string };
      expect(body.success).toBe(true);
      expect(body.target).toBe("meeting");
    });

    test("DELETE /vaults/:id/meetings/current stops meeting and returns content", async () => {
      const res = await request("DELETE", `/vaults/${VAULT_ID}/meetings/current`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        content: string;
        entryCount: number;
        filePath: string;
      };
      expect(body.content).toBeDefined();
      expect(body.filePath).toBeDefined();
      expect(typeof body.entryCount).toBe("number");
    });

    test("DELETE /vaults/:id/meetings/current returns 404 when no meeting", async () => {
      const res = await request("DELETE", `/vaults/${VAULT_ID}/meetings/current`);
      expect(res.status).toBe(404);

      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("NO_MEETING");
    });

    test("POST /vaults/:id/capture routes to daily after meeting stops", async () => {
      const res = await request("POST", `/vaults/${VAULT_ID}/capture`, {
        text: "Post-meeting capture",
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { target: string };
      expect(body.target).toBe("daily");
    });
  });

  // ===========================================================================
  // Task Operations
  // ===========================================================================

  describe("tasks", () => {
    test("GET /vaults/:id/tasks returns tasks from configured directories", async () => {
      const res = await request("GET", `/vaults/${VAULT_ID}/tasks`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toBeDefined();
      // Tasks are scanned from 00_Inbox (default inbox path)
      // The exact structure depends on the task manager, but it should return 200
    });
  });

  // ===========================================================================
  // Search Operations
  // ===========================================================================

  describe("search", () => {
    test("GET /vaults/:id/search/files returns file search results", async () => {
      const res = await request(
        "GET",
        `/vaults/${VAULT_ID}/search/files?q=hello`,
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        results: Array<{ path: string }>;
        totalMatches: number;
      };
      expect(body.results).toBeDefined();
      expect(body.totalMatches).toBeGreaterThanOrEqual(1);

      const paths = body.results.map((r) => r.path);
      expect(paths.some((p) => p.includes("hello"))).toBe(true);
    });

    test("GET /vaults/:id/search/files returns empty for no match", async () => {
      const res = await request(
        "GET",
        `/vaults/${VAULT_ID}/search/files?q=zzzznonexistent`,
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as { totalMatches: number };
      expect(body.totalMatches).toBe(0);
    });

    test("GET /vaults/:id/search/files returns empty for blank query", async () => {
      const res = await request(
        "GET",
        `/vaults/${VAULT_ID}/search/files?q=`,
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as { results: unknown[]; totalMatches: number };
      expect(body.results).toHaveLength(0);
    });

    test("GET /vaults/:id/search/content returns content search results", async () => {
      const res = await request(
        "GET",
        `/vaults/${VAULT_ID}/search/content?q=test+content`,
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        results: Array<{ path: string }>;
        totalMatches: number;
      };
      expect(body.results).toBeDefined();
      expect(body.totalMatches).toBeGreaterThanOrEqual(1);
    });

    test("GET /vaults/:id/search/content returns empty for blank query", async () => {
      const res = await request(
        "GET",
        `/vaults/${VAULT_ID}/search/content?q=`,
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as { totalMatches: number };
      expect(body.totalMatches).toBe(0);
    });
  });

  // ===========================================================================
  // Daily Prep
  // ===========================================================================

  describe("daily prep", () => {
    test("GET /vaults/:id/daily-prep/today returns 200 with status", async () => {
      const res = await request("GET", `/vaults/${VAULT_ID}/daily-prep/today`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toBeDefined();
      expect(typeof body).toBe("object");
    });
  });

  // ===========================================================================
  // Error Cases
  // ===========================================================================

  describe("error handling", () => {
    test("file operations on nonexistent vault return 404", async () => {
      const res = await request("GET", "/vaults/nonexistent/files");
      expect(res.status).toBe(404);

      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("VAULT_NOT_FOUND");
    });

    test("capture on nonexistent vault returns 404", async () => {
      const res = await request("POST", "/vaults/nonexistent/capture", {
        text: "test",
      });
      expect(res.status).toBe(404);
    });

    test("tasks on nonexistent vault returns 404", async () => {
      const res = await request("GET", "/vaults/nonexistent/tasks");
      expect(res.status).toBe(404);
    });

    test("search on nonexistent vault returns 404", async () => {
      const res = await request("GET", "/vaults/nonexistent/search/files?q=test");
      expect(res.status).toBe(404);
    });
  });
});

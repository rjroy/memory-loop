/**
 * Capture REST Routes Integration Tests
 *
 * Tests the capture REST endpoints:
 * - POST /api/vaults/:vaultId/capture
 * - GET /api/vaults/:vaultId/recent-notes
 * - GET /api/vaults/:vaultId/recent-activity
 *
 * Requirements:
 * - REQ-F-16: POST /api/vaults/:vaultId/capture for note capture
 * - REQ-F-17: GET /api/vaults/:vaultId/recent-notes for recent notes list
 * - REQ-F-18: GET /api/vaults/:vaultId/recent-activity for combined activity
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-005)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import type { RecentNoteEntry, RecentDiscussionEntry } from "@memory-loop/shared";
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
    `routes-capture-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Creates a test vault with CLAUDE.md and required inbox directory.
 * Optionally creates files in the inbox.
 */
async function createTestVault(
  testDir: string,
  vaultName: string,
  inboxFiles: Record<string, string> = {}
): Promise<string> {
  const vaultPath = join(testDir, vaultName);
  const inboxPath = join(vaultPath, "00_Inbox");

  // Create vault directory with CLAUDE.md
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "CLAUDE.md"), `# ${vaultName}\n\nTest vault for capture tests.`);

  // Create inbox directory
  await mkdir(inboxPath, { recursive: true });

  // Create any specified inbox files
  for (const [filename, content] of Object.entries(inboxFiles)) {
    await writeFile(join(inboxPath, filename), content);
  }

  return vaultPath;
}

/**
 * Creates a test session file for testing recent activity.
 */
async function createTestSession(
  vaultPath: string,
  sessionId: string,
  messages: Array<{ role: string; content: string; timestamp: string }>
): Promise<void> {
  const sessionsDir = join(vaultPath, ".memory-loop", "sessions");
  await mkdir(sessionsDir, { recursive: true });

  const metadata = {
    id: sessionId,
    vaultId: vaultPath.split("/").pop(),
    vaultPath: vaultPath,
    createdAt: messages[0]?.timestamp || new Date().toISOString(),
    lastActiveAt: messages[messages.length - 1]?.timestamp || new Date().toISOString(),
    messages: messages.map((m) => ({
      ...m,
      toolInvocations: [],
    })),
  };

  await writeFile(
    join(sessionsDir, `${sessionId}.json`),
    JSON.stringify(metadata, null, 2)
  );
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
// Capture Routes Tests
// =============================================================================

describe("Capture REST Routes", () => {
  let testDir: string;
  let app: ReturnType<typeof createApp>;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    testDir = await createTestDir();
    process.env.VAULTS_DIR = testDir;
    app = createApp();
  });

  afterEach(async () => {
    // Restore original env
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // POST /capture Tests (REQ-F-16)
  // ===========================================================================

  describe("POST /api/vaults/:vaultId/capture", () => {
    test("captures text to daily note and returns success", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "This is a test capture" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        success: boolean;
        timestamp: string;
        notePath: string;
      };

      expect(json.success).toBe(true);
      expect(json.timestamp).toBeDefined();
      expect(typeof json.timestamp).toBe("string");
      expect(json.notePath).toContain("00_Inbox");
      expect(json.notePath).toContain(".md");

      // Verify the file was actually created with the content
      const noteContent = await readFile(json.notePath, "utf-8");
      expect(noteContent).toContain("This is a test capture");
      expect(noteContent).toContain("## Capture");
    });

    test("appends to existing daily note", async () => {
      const today = getTodayDate();
      const existingContent = `# ${today}\n\n## Capture\n\n- [10:00] First capture\n`;
      await createTestVault(testDir, "test-vault", {
        [`${today}.md`]: existingContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Second capture" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        success: boolean;
        notePath: string;
      };

      expect(json.success).toBe(true);

      // Verify both captures are in the file
      const noteContent = await readFile(json.notePath, "utf-8");
      expect(noteContent).toContain("First capture");
      expect(noteContent).toContain("Second capture");
    });

    test("returns 400 when text is missing", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      // Zod validation message for missing required field
      expect(json.error.message.length).toBeGreaterThan(0);
    });

    test("returns 400 when text is empty string", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 when body is invalid JSON", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("Invalid JSON");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Test capture" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("preserves special characters in captured text", async () => {
      await createTestVault(testDir, "test-vault");

      const specialText = "Test with **markdown** and [[wiki links]] and `code`";
      const req = new Request("http://localhost/api/vaults/test-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: specialText }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        success: boolean;
        notePath: string;
      };

      const noteContent = await readFile(json.notePath, "utf-8");
      expect(noteContent).toContain(specialText);
    });

    test("creates inbox directory if it does not exist", async () => {
      // Create vault without inbox directory
      const vaultPath = join(testDir, "no-inbox-vault");
      await mkdir(vaultPath, { recursive: true });
      await writeFile(join(vaultPath, "CLAUDE.md"), "# No Inbox Vault");

      const req = new Request("http://localhost/api/vaults/no-inbox-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Test in new inbox" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        success: boolean;
        notePath: string;
      };

      expect(json.success).toBe(true);
      // Verify file was created in newly created inbox
      const noteContent = await readFile(json.notePath, "utf-8");
      expect(noteContent).toContain("Test in new inbox");
    });
  });

  // ===========================================================================
  // GET /recent-notes Tests (REQ-F-17)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/recent-notes", () => {
    test("returns recent notes from inbox", async () => {
      const today = getTodayDate();
      const dailyNoteContent = `# ${today}

## Capture

- [10:00] First capture entry
- [10:30] Second capture entry
- [11:00] Third capture entry
`;
      await createTestVault(testDir, "test-vault", {
        [`${today}.md`]: dailyNoteContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/recent-notes");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { notes: RecentNoteEntry[] };

      expect(json.notes).toBeDefined();
      expect(Array.isArray(json.notes)).toBe(true);
      expect(json.notes.length).toBe(3);

      // Notes should be in reverse order (most recent first)
      expect(json.notes[0].text).toBe("Third capture entry");
      expect(json.notes[0].time).toBe("11:00");
      expect(json.notes[0].date).toBe(today);
    });

    test("returns empty array when no notes exist", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/recent-notes");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { notes: RecentNoteEntry[] };
      expect(json.notes).toEqual([]);
    });

    test("returns empty array when inbox has no daily notes", async () => {
      await createTestVault(testDir, "test-vault", {
        "random-file.md": "# Not a daily note",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/recent-notes");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { notes: RecentNoteEntry[] };
      expect(json.notes).toEqual([]);
    });

    test("respects limit parameter", async () => {
      const today = getTodayDate();
      const dailyNoteContent = `# ${today}

## Capture

- [10:00] Entry 1
- [10:30] Entry 2
- [11:00] Entry 3
- [11:30] Entry 4
- [12:00] Entry 5
`;
      await createTestVault(testDir, "test-vault", {
        [`${today}.md`]: dailyNoteContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/recent-notes?limit=2");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { notes: RecentNoteEntry[] };
      expect(json.notes.length).toBe(2);
      // Should get the 2 most recent entries
      expect(json.notes[0].text).toBe("Entry 5");
      expect(json.notes[1].text).toBe("Entry 4");
    });

    test("returns 400 for invalid limit parameter", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/recent-notes?limit=invalid");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("limit");
    });

    test("returns 400 for limit below 1", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/recent-notes?limit=0");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 for limit above 100", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/recent-notes?limit=101");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/recent-notes");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("aggregates notes from multiple daily note files", async () => {
      const today = getTodayDate();
      // Create yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      await createTestVault(testDir, "test-vault", {
        [`${today}.md`]: `# ${today}\n\n## Capture\n\n- [10:00] Today entry\n`,
        [`${yesterdayStr}.md`]: `# ${yesterdayStr}\n\n## Capture\n\n- [15:00] Yesterday entry\n`,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/recent-notes?limit=5");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { notes: RecentNoteEntry[] };
      expect(json.notes.length).toBe(2);
      // Today's entry should be first (more recent date)
      expect(json.notes[0].date).toBe(today);
      expect(json.notes[1].date).toBe(yesterdayStr);
    });
  });

  // ===========================================================================
  // GET /recent-activity Tests (REQ-F-18)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/recent-activity", () => {
    test("returns combined captures and discussions", async () => {
      const today = getTodayDate();
      const vaultPath = await createTestVault(testDir, "test-vault", {
        [`${today}.md`]: `# ${today}\n\n## Capture\n\n- [10:00] Test capture\n`,
      });

      // Create a test session
      await createTestSession(vaultPath, "session-123", [
        { role: "user", content: "Hello, how are you?", timestamp: new Date().toISOString() },
        { role: "assistant", content: "I'm doing well!", timestamp: new Date().toISOString() },
      ]);

      const req = new Request("http://localhost/api/vaults/test-vault/recent-activity");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        captures: RecentNoteEntry[];
        discussions: RecentDiscussionEntry[];
      };

      expect(json.captures).toBeDefined();
      expect(json.discussions).toBeDefined();
      expect(Array.isArray(json.captures)).toBe(true);
      expect(Array.isArray(json.discussions)).toBe(true);

      // Verify captures
      expect(json.captures.length).toBe(1);
      expect(json.captures[0].text).toBe("Test capture");

      // Verify discussions
      expect(json.discussions.length).toBe(1);
      expect(json.discussions[0].sessionId).toBe("session-123");
      expect(json.discussions[0].preview).toContain("Hello");
      expect(json.discussions[0].messageCount).toBe(2);
    });

    test("returns empty arrays when no activity exists", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/recent-activity");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        captures: RecentNoteEntry[];
        discussions: RecentDiscussionEntry[];
      };

      expect(json.captures).toEqual([]);
      expect(json.discussions).toEqual([]);
    });

    test("returns captures when only captures exist", async () => {
      const today = getTodayDate();
      await createTestVault(testDir, "test-vault", {
        [`${today}.md`]: `# ${today}\n\n## Capture\n\n- [10:00] Only capture\n`,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/recent-activity");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        captures: RecentNoteEntry[];
        discussions: RecentDiscussionEntry[];
      };

      expect(json.captures.length).toBe(1);
      expect(json.discussions).toEqual([]);
    });

    test("returns discussions when only discussions exist", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");

      await createTestSession(vaultPath, "session-abc", [
        { role: "user", content: "Question", timestamp: new Date().toISOString() },
      ]);

      const req = new Request("http://localhost/api/vaults/test-vault/recent-activity");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        captures: RecentNoteEntry[];
        discussions: RecentDiscussionEntry[];
      };

      expect(json.captures).toEqual([]);
      expect(json.discussions.length).toBe(1);
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/recent-activity");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("skips sessions with no messages", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");

      // Create a session with messages
      await createTestSession(vaultPath, "session-with-messages", [
        { role: "user", content: "Hello", timestamp: new Date().toISOString() },
      ]);

      // Create an empty session (no messages)
      const sessionsDir = join(vaultPath, ".memory-loop", "sessions");
      await writeFile(
        join(sessionsDir, "empty-session.json"),
        JSON.stringify({
          id: "empty-session",
          vaultId: "test-vault",
          vaultPath: vaultPath,
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          messages: [],
        })
      );

      const req = new Request("http://localhost/api/vaults/test-vault/recent-activity");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        captures: RecentNoteEntry[];
        discussions: RecentDiscussionEntry[];
      };

      // Should only include the session with messages
      expect(json.discussions.length).toBe(1);
      expect(json.discussions[0].sessionId).toBe("session-with-messages");
    });

    test("sorts discussions by most recent first", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");

      const olderTime = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const newerTime = new Date().toISOString();

      await createTestSession(vaultPath, "older-session", [
        { role: "user", content: "Older", timestamp: olderTime },
      ]);

      await createTestSession(vaultPath, "newer-session", [
        { role: "user", content: "Newer", timestamp: newerTime },
      ]);

      const req = new Request("http://localhost/api/vaults/test-vault/recent-activity");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        captures: RecentNoteEntry[];
        discussions: RecentDiscussionEntry[];
      };

      expect(json.discussions.length).toBe(2);
      // Newer session should be first
      expect(json.discussions[0].sessionId).toBe("newer-session");
      expect(json.discussions[1].sessionId).toBe("older-session");
    });
  });

  // ===========================================================================
  // Error Response Format Tests
  // ===========================================================================

  describe("Error Response Format", () => {
    test("error responses match RestErrorResponse schema", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
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
      const req = new Request("http://localhost/api/vaults/nonexistent/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "test" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
      expect(json.error.message).toContain("nonexistent");
    });
  });
});

/**
 * Meeting REST Routes Integration Tests
 *
 * Tests the meeting REST endpoints:
 * - POST /api/vaults/:vaultId/meetings - Start a meeting
 * - DELETE /api/vaults/:vaultId/meetings/current - Stop current meeting
 * - GET /api/vaults/:vaultId/meetings/current - Get meeting state
 *
 * Requirements:
 * - REQ-F-23: Start meeting via REST
 * - REQ-F-24: Stop meeting via REST
 * - REQ-F-25: Get meeting state via REST
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-008)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import { clearAllMeetings } from "../meeting-store";
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
    `routes-meetings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Creates a test vault with CLAUDE.md and required directory structure.
 */
async function createTestVault(
  testDir: string,
  vaultName: string
): Promise<string> {
  const vaultPath = join(testDir, vaultName);
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "CLAUDE.md"), `# ${vaultName}`);

  // Create inbox directory for meeting notes
  const inboxPath = join(vaultPath, "00_Inbox");
  await mkdir(inboxPath, { recursive: true });

  return vaultPath;
}

// =============================================================================
// Meeting Routes Tests
// =============================================================================

describe("Meeting REST Routes", () => {
  let testDir: string;
  let app: ReturnType<typeof createApp>;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    testDir = await createTestDir();
    process.env.VAULTS_DIR = testDir;
    clearAllMeetings();
    app = createApp();
  });

  afterEach(async () => {
    // Restore original env
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }

    // Clear meeting state
    clearAllMeetings();

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // Start Meeting Tests (REQ-F-23)
  // ===========================================================================

  describe("POST /api/vaults/:vaultId/meetings", () => {
    test("starts a meeting successfully", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Team Standup" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        title: string;
        filePath: string;
        startedAt: string;
      };

      expect(json.title).toBe("Team Standup");
      expect(json.filePath).toContain("meetings");
      expect(json.filePath).toContain("team-standup.md");
      expect(json.startedAt).toBeDefined();
      // Verify it's a valid ISO date
      expect(() => new Date(json.startedAt)).not.toThrow();
    });

    test("creates meeting file on disk", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Planning Session" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { filePath: string };

      // Check file exists on disk
      const meetingsDir = join(vaultPath, "00_Inbox", "meetings");
      const files = await Bun.file(
        join(meetingsDir, json.filePath.split("/").pop()!)
      ).exists();
      expect(files).toBe(true);
    });

    test("meeting file contains correct frontmatter", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Sprint Review" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { filePath: string };

      // Read the file and check content
      const meetingsDir = join(vaultPath, "00_Inbox", "meetings");
      const filename = json.filePath.split("/").pop()!;
      const content = await readFile(join(meetingsDir, filename), "utf-8");

      expect(content).toContain("---");
      expect(content).toContain('title: "Sprint Review"');
      expect(content).toContain("attendees: []");
      expect(content).toContain("## Capture");
    });

    test("returns 400 when title is missing", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      // Zod validation message when title is not provided
      expect(json.error.message.toLowerCase()).toMatch(/required|expected string/);
    });

    test("returns 400 when title is empty", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 when request body is invalid JSON", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("Invalid JSON");
    });

    test("returns 400 when a meeting is already in progress", async () => {
      await createTestVault(testDir, "test-vault");

      // Start first meeting
      const req1 = new Request("http://localhost/api/vaults/test-vault/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "First Meeting" }),
      });
      const res1 = await app.fetch(req1);
      expect(res1.status).toBe(200);

      // Try to start second meeting
      const req2 = new Request("http://localhost/api/vaults/test-vault/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Second Meeting" }),
      });
      const res2 = await app.fetch(req2);

      expect(res2.status).toBe(400);

      const json = (await res2.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("already in progress");
      expect(json.error.message).toContain("First Meeting");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/meetings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Test Meeting" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });
  });

  // ===========================================================================
  // Stop Meeting Tests (REQ-F-24)
  // ===========================================================================

  describe("DELETE /api/vaults/:vaultId/meetings/current", () => {
    test("stops a meeting successfully", async () => {
      await createTestVault(testDir, "test-vault");

      // Start a meeting first
      const startReq = new Request(
        "http://localhost/api/vaults/test-vault/meetings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Test Meeting" }),
        }
      );
      const startRes = await app.fetch(startReq);
      expect(startRes.status).toBe(200);

      // Stop the meeting
      const stopReq = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "DELETE" }
      );
      const stopRes = await app.fetch(stopReq);

      expect(stopRes.status).toBe(200);

      const json = (await stopRes.json()) as {
        filePath: string;
        content: string;
        entryCount: number;
      };

      expect(json.filePath).toContain("meetings");
      expect(json.filePath).toContain("test-meeting.md");
      expect(json.content).toContain("Test Meeting");
      expect(json.content).toContain("## Capture");
      expect(json.entryCount).toBe(0);
    });

    test("returns file content for Claude Code integration", async () => {
      await createTestVault(testDir, "test-vault");

      // Start a meeting
      const startReq = new Request(
        "http://localhost/api/vaults/test-vault/meetings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Content Check" }),
        }
      );
      const startRes = await app.fetch(startReq);
      expect(startRes.status).toBe(200);

      // Stop the meeting
      const stopReq = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "DELETE" }
      );
      const stopRes = await app.fetch(stopReq);

      expect(stopRes.status).toBe(200);

      const json = (await stopRes.json()) as { content: string };

      // Content should include frontmatter and sections
      expect(json.content).toContain("---");
      expect(json.content).toContain('title: "Content Check"');
      expect(json.content).toContain("date:");
      expect(json.content).toContain("# Content Check");
    });

    test("returns 404 when no meeting is in progress", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("No meeting");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/meetings/current",
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("allows starting new meeting after stopping", async () => {
      await createTestVault(testDir, "test-vault");

      // Start first meeting
      const start1 = new Request(
        "http://localhost/api/vaults/test-vault/meetings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "First Meeting" }),
        }
      );
      await app.fetch(start1);

      // Stop first meeting
      const stop = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "DELETE" }
      );
      await app.fetch(stop);

      // Start second meeting
      const start2 = new Request(
        "http://localhost/api/vaults/test-vault/meetings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Second Meeting" }),
        }
      );
      const res = await app.fetch(start2);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { title: string };
      expect(json.title).toBe("Second Meeting");
    });
  });

  // ===========================================================================
  // Get Meeting State Tests (REQ-F-25)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/meetings/current", () => {
    test("returns inactive state when no meeting", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "GET" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        isActive: boolean;
        title?: string;
        filePath?: string;
        startedAt?: string;
      };

      expect(json.isActive).toBe(false);
      expect(json.title).toBeUndefined();
      expect(json.filePath).toBeUndefined();
      expect(json.startedAt).toBeUndefined();
    });

    test("returns active state with meeting details", async () => {
      await createTestVault(testDir, "test-vault");

      // Start a meeting
      const startReq = new Request(
        "http://localhost/api/vaults/test-vault/meetings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Active Meeting" }),
        }
      );
      await app.fetch(startReq);

      // Get state
      const req = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "GET" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        isActive: boolean;
        title?: string;
        filePath?: string;
        startedAt?: string;
      };

      expect(json.isActive).toBe(true);
      expect(json.title).toBe("Active Meeting");
      expect(json.filePath).toContain("meetings");
      expect(json.filePath).toContain("active-meeting.md");
      expect(json.startedAt).toBeDefined();
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/meetings/current",
        { method: "GET" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });
  });

  // ===========================================================================
  // Meeting Lifecycle Tests
  // ===========================================================================

  describe("Meeting Lifecycle", () => {
    test("full lifecycle: start -> get state -> stop -> get state", async () => {
      await createTestVault(testDir, "test-vault");

      // 1. Initial state: no meeting
      const state1Req = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "GET" }
      );
      const state1Res = await app.fetch(state1Req);
      expect(state1Res.status).toBe(200);
      const state1 = (await state1Res.json()) as { isActive: boolean };
      expect(state1.isActive).toBe(false);

      // 2. Start meeting
      const startReq = new Request(
        "http://localhost/api/vaults/test-vault/meetings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Lifecycle Test" }),
        }
      );
      const startRes = await app.fetch(startReq);
      expect(startRes.status).toBe(200);
      const started = (await startRes.json()) as { title: string; startedAt: string };
      expect(started.title).toBe("Lifecycle Test");

      // 3. Get state: meeting active
      const state2Req = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "GET" }
      );
      const state2Res = await app.fetch(state2Req);
      expect(state2Res.status).toBe(200);
      const state2 = (await state2Res.json()) as {
        isActive: boolean;
        title: string;
        startedAt: string;
      };
      expect(state2.isActive).toBe(true);
      expect(state2.title).toBe("Lifecycle Test");
      expect(state2.startedAt).toBe(started.startedAt);

      // 4. Stop meeting
      const stopReq = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "DELETE" }
      );
      const stopRes = await app.fetch(stopReq);
      expect(stopRes.status).toBe(200);
      const stopped = (await stopRes.json()) as { content: string; entryCount: number };
      expect(stopped.content).toContain("Lifecycle Test");
      expect(stopped.entryCount).toBe(0);

      // 5. Get state: no meeting
      const state3Req = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "GET" }
      );
      const state3Res = await app.fetch(state3Req);
      expect(state3Res.status).toBe(200);
      const state3 = (await state3Res.json()) as { isActive: boolean };
      expect(state3.isActive).toBe(false);
    });

    test("meetings are isolated between vaults", async () => {
      await createTestVault(testDir, "vault-a");
      await createTestVault(testDir, "vault-b");

      // Start meeting in vault A
      const startA = new Request("http://localhost/api/vaults/vault-a/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Vault A Meeting" }),
      });
      const resA = await app.fetch(startA);
      expect(resA.status).toBe(200);

      // Check vault B has no meeting
      const stateB = new Request(
        "http://localhost/api/vaults/vault-b/meetings/current",
        { method: "GET" }
      );
      const resBState = await app.fetch(stateB);
      expect(resBState.status).toBe(200);
      const stateBJson = (await resBState.json()) as { isActive: boolean };
      expect(stateBJson.isActive).toBe(false);

      // Start meeting in vault B
      const startB = new Request("http://localhost/api/vaults/vault-b/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Vault B Meeting" }),
      });
      const resBStart = await app.fetch(startB);
      expect(resBStart.status).toBe(200);

      // Verify both vaults have their own meetings
      const stateA = new Request(
        "http://localhost/api/vaults/vault-a/meetings/current",
        { method: "GET" }
      );
      const resAState = await app.fetch(stateA);
      const stateAJson = (await resAState.json()) as { title: string };
      expect(stateAJson.title).toBe("Vault A Meeting");

      const stateB2 = new Request(
        "http://localhost/api/vaults/vault-b/meetings/current",
        { method: "GET" }
      );
      const resB2State = await app.fetch(stateB2);
      const stateB2Json = (await resB2State.json()) as { title: string };
      expect(stateB2Json.title).toBe("Vault B Meeting");
    });
  });

  // ===========================================================================
  // Error Response Format Tests
  // ===========================================================================

  describe("Error Response Format", () => {
    test("error responses match RestErrorResponse schema", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/meetings/current",
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;

      // Verify exact structure
      expect(Object.keys(json)).toEqual(["error"]);
      expect(Object.keys(json.error).sort()).toEqual(["code", "message"]);
      expect(typeof json.error.code).toBe("string");
      expect(typeof json.error.message).toBe("string");
    });

    test("vault not found error has correct format", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/meetings/current",
        { method: "GET" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
      expect(json.error.message).toContain("nonexistent");
    });
  });
});

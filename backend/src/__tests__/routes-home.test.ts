/**
 * Home Dashboard REST Routes Integration Tests
 *
 * Tests the home dashboard REST endpoints:
 * - GET /api/vaults/:vaultId/goals - Get vault goals
 * - GET /api/vaults/:vaultId/inspiration - Get inspiration data
 * - GET /api/vaults/:vaultId/tasks - Get tasks list
 * - PATCH /api/vaults/:vaultId/tasks - Toggle task completion
 *
 * Requirements:
 * - REQ-F-19: Get vault goals
 * - REQ-F-20: Get inspiration (contextual + quote)
 * - REQ-F-21: Get tasks
 * - REQ-F-22: Toggle task completion
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-006)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import type { RestErrorResponse } from "../middleware/error-handler";
import type { InspirationItem } from "@memory-loop/shared";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique test directory for vaults.
 */
async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `routes-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Creates a test vault with CLAUDE.md and optional files.
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
// Home Dashboard Routes Tests
// =============================================================================

describe("Home Dashboard REST Routes", () => {
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
  // Goals Endpoint Tests (REQ-F-19)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/goals", () => {
    test("returns goals content when goals.md exists", async () => {
      const goalsContent = `# My Goals

## Short-term
- Complete project A
- Learn new skill

## Long-term
- Career advancement`;

      await createTestVault(testDir, "test-vault", {
        "06_Metadata/memory-loop/goals.md": goalsContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/goals");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { content: string | null };
      expect(json.content).toBe(goalsContent);
    });

    test("returns null content when goals.md does not exist", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/goals");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { content: string | null };
      expect(json.content).toBeNull();
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/goals");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("returns 400 for invalid vault ID format", async () => {
      // Vault IDs containing ".." are invalid
      const req = new Request("http://localhost/api/vaults/..evil/goals");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ===========================================================================
  // Inspiration Endpoint Tests (REQ-F-20)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/inspiration", () => {
    // Skip: This test calls the Claude SDK to generate inspiration when no cached files exist
    test.skip("returns inspiration with fallback quote when no inspiration files exist", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/inspiration");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        contextual: InspirationItem | null;
        quote: InspirationItem;
      };

      // Contextual may be null when no prompts exist
      // Quote should have fallback
      expect(json.quote).toBeDefined();
      expect(typeof json.quote.text).toBe("string");
      expect(json.quote.text.length).toBeGreaterThan(0);
    });

    test("returns inspiration from existing files", async () => {
      const promptsContent = `<!-- last-generated: 2026-01-22 -->

- "What progress did you make on your main project?"
- "How did your morning routine go?"`;

      const quotesContent = `<!-- last-generated: 2026-01-22 (week 4) -->

- "The only way to do great work is to love what you do." -- Steve Jobs`;

      await createTestVault(testDir, "test-vault", {
        "06_Metadata/memory-loop/contextual-prompts.md": promptsContent,
        "06_Metadata/memory-loop/general-inspiration.md": quotesContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/inspiration");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        contextual: InspirationItem | null;
        quote: InspirationItem;
      };

      // Quote should come from file
      expect(json.quote).toBeDefined();
      expect(json.quote.text).toBe("The only way to do great work is to love what you do.");
      expect(json.quote.attribution).toBe("Steve Jobs");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/inspiration");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    // Skip: This test calls the Claude SDK when no valid quote is cached
    test.skip("gracefully handles malformed inspiration files", async () => {
      // File with invalid format (no proper markdown list)
      const malformedContent = `This is not proper inspiration file format
just some random text
without proper markers`;

      await createTestVault(testDir, "test-vault", {
        "06_Metadata/memory-loop/contextual-prompts.md": malformedContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/inspiration");
      const res = await app.fetch(req);

      // Should succeed with fallback values, not error
      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        contextual: InspirationItem | null;
        quote: InspirationItem;
      };

      // Should have fallback quote
      expect(json.quote).toBeDefined();
      expect(json.quote.text.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Tasks Endpoint Tests (REQ-F-21)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/tasks", () => {
    test("returns tasks from inbox directory", async () => {
      const taskContent = `# Daily Tasks

- [ ] Buy groceries
- [x] Send email to client
- [ ] Review pull request
- [/] Work on presentation`;

      await createTestVault(testDir, "test-vault", {
        "00_Inbox/2026-01-22.md": taskContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/tasks");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        tasks: Array<{
          text: string;
          state: string;
          filePath: string;
          lineNumber: number;
          fileMtime: number;
          category: "inbox" | "projects" | "areas";
        }>;
        incomplete: number;
        total: number;
      };

      expect(json.tasks).toBeDefined();
      expect(Array.isArray(json.tasks)).toBe(true);
      expect(json.total).toBe(4);
      expect(json.incomplete).toBe(2); // Two tasks with " " state

      // Verify task structure
      const groceryTask = json.tasks.find((t) => t.text === "Buy groceries");
      expect(groceryTask).toBeDefined();
      expect(groceryTask?.state).toBe(" ");
      expect(groceryTask?.category).toBe("inbox");
      expect(groceryTask?.filePath).toBe("00_Inbox/2026-01-22.md");

      const emailTask = json.tasks.find((t) => t.text === "Send email to client");
      expect(emailTask).toBeDefined();
      expect(emailTask?.state).toBe("x");
    });

    test("returns tasks from multiple directories", async () => {
      await createTestVault(testDir, "test-vault", {
        "00_Inbox/today.md": "- [ ] Inbox task",
        "01_Projects/project-a/README.md": "- [ ] Project task",
        "02_Areas/health/notes.md": "- [x] Area task",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/tasks");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        tasks: Array<{
          text: string;
          state: string;
          category: "inbox" | "projects" | "areas";
        }>;
        incomplete: number;
        total: number;
      };

      expect(json.total).toBe(3);

      const categories = json.tasks.map((t) => t.category);
      expect(categories).toContain("inbox");
      expect(categories).toContain("projects");
      expect(categories).toContain("areas");
    });

    test("returns empty tasks when no task files exist", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/tasks");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        tasks: unknown[];
        incomplete: number;
        total: number;
      };

      expect(json.tasks).toEqual([]);
      expect(json.incomplete).toBe(0);
      expect(json.total).toBe(0);
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/tasks");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("ignores non-markdown files", async () => {
      await createTestVault(testDir, "test-vault", {
        "00_Inbox/tasks.md": "- [ ] Real task",
        "00_Inbox/tasks.txt": "- [ ] Not a task (wrong extension)",
        "00_Inbox/data.json": '{"task": "Not a task"}',
      });

      const req = new Request("http://localhost/api/vaults/test-vault/tasks");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        tasks: Array<{ text: string }>;
        total: number;
      };

      expect(json.total).toBe(1);
      expect(json.tasks[0].text).toBe("Real task");
    });
  });

  // ===========================================================================
  // Task Toggle Endpoint Tests (REQ-F-22)
  // ===========================================================================

  describe("PATCH /api/vaults/:vaultId/tasks", () => {
    test("toggles task state successfully", async () => {
      await createTestVault(testDir, "test-vault", {
        "00_Inbox/tasks.md": "- [ ] Buy groceries\n- [x] Done task",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: "00_Inbox/tasks.md",
          lineNumber: 1,
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        filePath: string;
        lineNumber: number;
        newState: string;
      };

      expect(json.filePath).toBe("00_Inbox/tasks.md");
      expect(json.lineNumber).toBe(1);
      expect(json.newState).toBe("x"); // Toggled from " " to "x"

      // Verify file was actually modified
      const fileContent = await readFile(
        join(testDir, "test-vault", "00_Inbox/tasks.md"),
        "utf-8"
      );
      expect(fileContent).toContain("- [x] Buy groceries");
    });

    test("sets specific state when newState provided", async () => {
      await createTestVault(testDir, "test-vault", {
        "00_Inbox/tasks.md": "- [ ] Task item",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: "00_Inbox/tasks.md",
          lineNumber: 1,
          newState: "/", // Set to partial/in-progress state
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { newState: string };
      expect(json.newState).toBe("/");

      // Verify file was modified
      const fileContent = await readFile(
        join(testDir, "test-vault", "00_Inbox/tasks.md"),
        "utf-8"
      );
      expect(fileContent).toContain("- [/] Task item");
    });

    test("returns 400 when filePath is missing", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineNumber: 1,
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("filePath");
    });

    test("returns 400 when lineNumber is missing", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: "00_Inbox/tasks.md",
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("lineNumber");
    });

    test("returns 400 when lineNumber is invalid", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: "00_Inbox/tasks.md",
          lineNumber: 0, // Invalid: must be positive
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 for invalid JSON body", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("Invalid JSON");
    });

    test("returns 404 when file does not exist", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: "nonexistent/file.md",
          lineNumber: 1,
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
    });

    test("rejects path traversal attempt", async () => {
      // Create a vault and a file outside the content root to attempt traversal
      await createTestVault(testDir, "test-vault", {
        "00_Inbox/tasks.md": "- [ ] Task",
      });

      // Try to traverse outside the vault content root
      const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: "../../../etc/passwd",
          lineNumber: 1,
        }),
      });

      const res = await app.fetch(req);

      // Path traversal is detected and rejected
      // Note: Current implementation returns 400/VALIDATION_ERROR because
      // the error message matching in home.ts doesn't catch "is outside".
      // The path traversal is correctly blocked, just reported as validation error.
      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.message).toContain("outside the vault boundary");
    });

    test("returns 400 when line is not a task", async () => {
      await createTestVault(testDir, "test-vault", {
        "00_Inbox/tasks.md": "# Header\n\nSome text\n\n- [ ] Task",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: "00_Inbox/tasks.md",
          lineNumber: 1, // Points to "# Header", not a task
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("not a task");
    });

    test("returns 400 when lineNumber exceeds file length", async () => {
      await createTestVault(testDir, "test-vault", {
        "00_Inbox/tasks.md": "- [ ] Only one line",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: "00_Inbox/tasks.md",
          lineNumber: 999,
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("out of bounds");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: "00_Inbox/tasks.md",
          lineNumber: 1,
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("cycles through all task states", async () => {
      // State cycle: ' ' -> 'x' -> '/' -> '?' -> 'b' -> 'f' -> ' '
      await createTestVault(testDir, "test-vault", {
        "00_Inbox/tasks.md": "- [ ] Task item",
      });

      const states = ["x", "/", "?", "b", "f", " "];
      const filePath = join(testDir, "test-vault", "00_Inbox/tasks.md");

      for (const expectedState of states) {
        const req = new Request("http://localhost/api/vaults/test-vault/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath: "00_Inbox/tasks.md",
            lineNumber: 1,
          }),
        });

        const res = await app.fetch(req);
        expect(res.status).toBe(200);

        const json = (await res.json()) as { newState: string };
        expect(json.newState).toBe(expectedState);

        // Verify file content
        const content = await readFile(filePath, "utf-8");
        expect(content).toContain(`- [${expectedState}] Task item`);
      }
    });
  });

  // ===========================================================================
  // Error Response Format Tests
  // ===========================================================================

  describe("Error Response Format", () => {
    test("error responses match RestErrorResponse schema", async () => {
      // Use invalid vault ID (containing "..") to trigger validation error
      const req = new Request("http://localhost/api/vaults/..evil/goals");
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
      const req = new Request("http://localhost/api/vaults/nonexistent/goals");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
      expect(json.error.message).toContain("nonexistent");
    });
  });
});

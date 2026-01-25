/**
 * Config REST Routes Integration Tests
 *
 * Tests the config REST endpoints:
 * - GET /api/vaults/:vaultId/pinned-assets
 * - PUT /api/vaults/:vaultId/pinned-assets
 * - PATCH /api/vaults/:vaultId/config
 * - POST /api/vaults/:vaultId/setup
 * - DELETE /api/vaults/:vaultId/health-issues/:issueId
 *
 * Requirements:
 * - REQ-F-29: Get pinned assets
 * - REQ-F-30: Set pinned assets
 * - REQ-F-31: Update vault config
 * - REQ-F-32: Setup vault
 * - REQ-F-34: Dismiss health issue
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-011)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
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
    `routes-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Creates a test vault with CLAUDE.md and optional config.
 */
async function createTestVault(
  testDir: string,
  vaultName: string,
  options: {
    claudeMd?: string;
    config?: Record<string, unknown>;
    files?: Record<string, string>;
  } = {}
): Promise<string> {
  const vaultPath = join(testDir, vaultName);
  await mkdir(vaultPath, { recursive: true });

  // Create CLAUDE.md (required for vault detection)
  const claudeMdContent = options.claudeMd ?? `# ${vaultName}\n\nTest vault.`;
  await writeFile(join(vaultPath, "CLAUDE.md"), claudeMdContent);

  // Create config file if provided
  if (options.config) {
    await writeFile(
      join(vaultPath, ".memory-loop.json"),
      JSON.stringify(options.config, null, 2) + "\n"
    );
  }

  // Create additional files if provided
  if (options.files) {
    for (const [filename, content] of Object.entries(options.files)) {
      const filePath = join(vaultPath, filename);
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      if (dir !== vaultPath) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(filePath, content);
    }
  }

  return vaultPath;
}

// =============================================================================
// Config Routes Tests
// =============================================================================

describe("Config REST Routes", () => {
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
  // GET /pinned-assets Tests (REQ-F-29)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/pinned-assets", () => {
    test("returns empty array when no pinned assets configured", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/pinned-assets");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { paths: string[] };
      expect(json.paths).toEqual([]);
    });

    test("returns configured pinned assets", async () => {
      await createTestVault(testDir, "test-vault", {
        config: {
          pinnedAssets: ["notes.md", "projects/active"],
        },
        files: {
          "notes.md": "# Notes",
          "projects/active/task.md": "# Task",
        },
      });

      const req = new Request("http://localhost/api/vaults/test-vault/pinned-assets");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { paths: string[] };
      expect(json.paths).toEqual(["notes.md", "projects/active"]);
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/pinned-assets");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });
  });

  // ===========================================================================
  // PUT /pinned-assets Tests (REQ-F-30)
  // ===========================================================================

  describe("PUT /api/vaults/:vaultId/pinned-assets", () => {
    test("sets pinned assets successfully", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault", {
        files: {
          "notes.md": "# Notes",
          "projects/task.md": "# Task",
        },
      });

      const req = new Request("http://localhost/api/vaults/test-vault/pinned-assets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: ["notes.md", "projects"] }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { paths: string[] };
      expect(json.paths).toEqual(["notes.md", "projects"]);

      // Verify persisted to config file
      const configContent = await readFile(
        join(vaultPath, ".memory-loop.json"),
        "utf-8"
      );
      const config = JSON.parse(configContent) as { pinnedAssets?: string[] };
      expect(config.pinnedAssets).toEqual(["notes.md", "projects"]);
    });

    test("replaces existing pinned assets", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault", {
        config: {
          pinnedAssets: ["old-path.md"],
        },
      });

      const req = new Request("http://localhost/api/vaults/test-vault/pinned-assets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: ["new-path.md"] }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { paths: string[] };
      expect(json.paths).toEqual(["new-path.md"]);

      // Verify old paths are replaced
      const configContent = await readFile(
        join(vaultPath, ".memory-loop.json"),
        "utf-8"
      );
      const config = JSON.parse(configContent) as { pinnedAssets?: string[] };
      expect(config.pinnedAssets).toEqual(["new-path.md"]);
    });

    test("preserves other config fields when setting pinned assets", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault", {
        config: {
          title: "My Vault",
          contentRoot: "content",
          pinnedAssets: ["old.md"],
        },
      });

      const req = new Request("http://localhost/api/vaults/test-vault/pinned-assets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: ["new.md"] }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      // Verify other fields preserved
      const configContent = await readFile(
        join(vaultPath, ".memory-loop.json"),
        "utf-8"
      );
      const config = JSON.parse(configContent) as Record<string, unknown>;
      expect(config.title).toBe("My Vault");
      expect(config.contentRoot).toBe("content");
      expect(config.pinnedAssets).toEqual(["new.md"]);
    });

    test("allows setting empty paths array", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault", {
        config: {
          pinnedAssets: ["existing.md"],
        },
      });

      const req = new Request("http://localhost/api/vaults/test-vault/pinned-assets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [] }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { paths: string[] };
      expect(json.paths).toEqual([]);

      // Verify persisted
      const configContent = await readFile(
        join(vaultPath, ".memory-loop.json"),
        "utf-8"
      );
      const config = JSON.parse(configContent) as { pinnedAssets?: string[] };
      expect(config.pinnedAssets).toEqual([]);
    });

    test("returns 400 when paths is missing", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/pinned-assets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("paths");
    });

    test("returns 400 when paths is not an array", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/pinned-assets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: "not-an-array" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 when body is invalid JSON", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/pinned-assets", {
        method: "PUT",
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
      const req = new Request("http://localhost/api/vaults/nonexistent/pinned-assets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: ["test.md"] }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });
  });

  // ===========================================================================
  // PATCH /config Tests (REQ-F-31)
  // ===========================================================================

  describe("PATCH /api/vaults/:vaultId/config", () => {
    test("updates vault title successfully", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Title" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { success: boolean };
      expect(json.success).toBe(true);

      // Verify persisted
      const configContent = await readFile(
        join(vaultPath, ".memory-loop.json"),
        "utf-8"
      );
      const config = JSON.parse(configContent) as { title?: string };
      expect(config.title).toBe("New Title");
    });

    test("updates multiple fields at once", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "My Vault",
          subtitle: "Work Notes",
          discussionModel: "sonnet",
          recentCaptures: 10,
        }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      // Verify persisted
      const configContent = await readFile(
        join(vaultPath, ".memory-loop.json"),
        "utf-8"
      );
      const config = JSON.parse(configContent) as Record<string, unknown>;
      expect(config.title).toBe("My Vault");
      expect(config.subtitle).toBe("Work Notes");
      expect(config.discussionModel).toBe("sonnet");
      expect(config.recentCaptures).toBe(10);
    });

    test("preserves non-editable fields when updating config", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault", {
        config: {
          contentRoot: "content",
          inboxPath: "inbox",
          pinnedAssets: ["notes.md"],
        },
      });

      const req = new Request("http://localhost/api/vaults/test-vault/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated Title" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      // Verify non-editable fields preserved
      const configContent = await readFile(
        join(vaultPath, ".memory-loop.json"),
        "utf-8"
      );
      const config = JSON.parse(configContent) as Record<string, unknown>;
      expect(config.title).toBe("Updated Title");
      expect(config.contentRoot).toBe("content");
      expect(config.inboxPath).toBe("inbox");
      expect(config.pinnedAssets).toEqual(["notes.md"]);
    });

    test("returns 400 for invalid discussionModel value", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discussionModel: "invalid-model" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 for invalid recentCaptures value", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recentCaptures: 0 }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 when body is invalid JSON", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{not valid json}",
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("Invalid JSON");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Test" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("updates badges successfully", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          badges: [
            { text: "Work", color: "blue" },
            { text: "Active", color: "green" },
          ],
        }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      // Verify persisted
      const configContent = await readFile(
        join(vaultPath, ".memory-loop.json"),
        "utf-8"
      );
      const config = JSON.parse(configContent) as {
        badges?: Array<{ text: string; color: string }>;
      };
      expect(config.badges).toEqual([
        { text: "Work", color: "blue" },
        { text: "Active", color: "green" },
      ]);
    });

    test("updates cardsEnabled to false successfully", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardsEnabled: false }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      // Verify persisted
      const configContent = await readFile(
        join(vaultPath, ".memory-loop.json"),
        "utf-8"
      );
      const config = JSON.parse(configContent) as { cardsEnabled?: boolean };
      expect(config.cardsEnabled).toBe(false);
    });

    test("cardsEnabled false is returned in vault list", async () => {
      await createTestVault(testDir, "test-vault", {
        config: { cardsEnabled: false },
      });

      const req = new Request("http://localhost/api/vaults");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { vaults: Array<{ id: string; cardsEnabled: boolean }> };
      const vault = json.vaults.find((v) => v.id === "test-vault");
      expect(vault).toBeDefined();
      expect(vault?.cardsEnabled).toBe(false);
    });
  });

  // ===========================================================================
  // POST /setup Tests (REQ-F-32)
  // ===========================================================================

  describe("POST /api/vaults/:vaultId/setup", () => {
    test(
      "runs vault setup successfully",
      async () => {
        await createTestVault(testDir, "test-vault", {
          claudeMd: "# Test Vault\n\nA test vault for setup.",
        });

        const req = new Request("http://localhost/api/vaults/test-vault/setup", {
          method: "POST",
        });
        const res = await app.fetch(req);

        expect(res.status).toBe(200);

        const json = (await res.json()) as {
          success: boolean;
          summary: string[];
          errors?: string[];
        };
        // Setup may report errors for optional steps (like command templates)
        // but the endpoint should return 200 with a result
        expect(typeof json.success).toBe("boolean");
        expect(Array.isArray(json.summary)).toBe(true);
      },
      // Setup calls the SDK to update CLAUDE.md which can take 10-15+ seconds
      { timeout: 30000 }
    );

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/setup", {
        method: "POST",
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });
  });

  // ===========================================================================
  // DELETE /health-issues/:issueId Tests (REQ-F-34)
  // ===========================================================================

  describe("DELETE /api/vaults/:vaultId/health-issues/:issueId", () => {
    test("acknowledges health issue dismiss request", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/health-issues/issue-123",
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        success: boolean;
        issueId: string;
        note?: string;
      };
      expect(json.success).toBe(true);
      expect(json.issueId).toBe("issue-123");
      // Note indicates WebSocket is preferred for actual effect
      expect(json.note).toBeDefined();
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/health-issues/issue-123",
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });
  });

  // ===========================================================================
  // Error Response Format Tests
  // ===========================================================================

  describe("Error Response Format", () => {
    test("error responses match RestErrorResponse schema", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/pinned-assets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // Missing paths
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
      const req = new Request("http://localhost/api/vaults/nonexistent/pinned-assets");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
      expect(json.error.message).toContain("nonexistent");
    });
  });
});

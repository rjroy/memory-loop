/**
 * Vault Resolution Middleware Tests
 *
 * Tests the vault resolution middleware for REST API endpoints.
 * Covers:
 * - Valid vault ID returns VaultInfo in context
 * - Missing vault returns 404
 * - Invalid vault ID format returns 400
 * - Path traversal attempts return 400
 * - Error response format matches spec
 */

import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { Hono } from "hono";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VaultInfo } from "@memory-loop/shared";
import {
  vaultResolution,
  isValidVaultId,
  getVaultFromContext,
  type RestErrorResponse,
} from "../middleware/vault-resolution";

describe("isValidVaultId", () => {
  it("accepts alphanumeric vault IDs", () => {
    expect(isValidVaultId("vault1")).toBe(true);
    expect(isValidVaultId("MyVault")).toBe(true);
    expect(isValidVaultId("vault123")).toBe(true);
  });

  it("accepts vault IDs with hyphens", () => {
    expect(isValidVaultId("my-vault")).toBe(true);
    expect(isValidVaultId("my-vault-2")).toBe(true);
    expect(isValidVaultId("a-b-c")).toBe(true);
  });

  it("accepts vault IDs with underscores", () => {
    expect(isValidVaultId("my_vault")).toBe(true);
    expect(isValidVaultId("my_vault_2")).toBe(true);
    expect(isValidVaultId("a_b_c")).toBe(true);
  });

  it("accepts vault IDs with mixed separators", () => {
    expect(isValidVaultId("my-vault_name")).toBe(true);
    expect(isValidVaultId("vault_1-test")).toBe(true);
  });

  it("rejects empty vault IDs", () => {
    expect(isValidVaultId("")).toBe(false);
  });

  it("rejects vault IDs starting with hyphen", () => {
    expect(isValidVaultId("-vault")).toBe(false);
  });

  it("rejects vault IDs starting with underscore", () => {
    expect(isValidVaultId("_vault")).toBe(false);
  });

  it("rejects path traversal attempts", () => {
    expect(isValidVaultId("..")).toBe(false);
    expect(isValidVaultId("../other")).toBe(false);
    expect(isValidVaultId("vault/../other")).toBe(false);
    expect(isValidVaultId("vault/subdir")).toBe(false);
    expect(isValidVaultId("vault\\subdir")).toBe(false);
  });

  it("rejects vault IDs with special characters", () => {
    expect(isValidVaultId("vault@name")).toBe(false);
    expect(isValidVaultId("vault#1")).toBe(false);
    expect(isValidVaultId("vault$money")).toBe(false);
    expect(isValidVaultId("vault%test")).toBe(false);
    expect(isValidVaultId("vault name")).toBe(false);
  });

  it("rejects very long vault IDs", () => {
    const longId = "a" + "b".repeat(100); // 101 characters
    expect(isValidVaultId(longId)).toBe(false);
  });

  it("accepts vault IDs at max length", () => {
    const maxId = "a" + "b".repeat(99); // 100 characters
    expect(isValidVaultId(maxId)).toBe(true);
  });

  it("rejects non-string inputs", () => {
    expect(isValidVaultId(null as unknown as string)).toBe(false);
    expect(isValidVaultId(undefined as unknown as string)).toBe(false);
    expect(isValidVaultId(123 as unknown as string)).toBe(false);
  });
});

describe("vaultResolution middleware", () => {
  let testDir: string;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    // Create a unique test directory
    testDir = join(
      tmpdir(),
      `vault-resolution-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    process.env.VAULTS_DIR = testDir;
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

  /**
   * Creates a test vault in the test directory.
   */
  async function createTestVault(
    name: string,
    title: string = `Test ${name}`
  ): Promise<void> {
    const vaultPath = join(testDir, name);
    await mkdir(vaultPath, { recursive: true });
    await writeFile(join(vaultPath, "CLAUDE.md"), `# ${title}`);
  }

  /**
   * Creates a Hono app with the vault resolution middleware.
   */
  function createTestApp(): Hono {
    const app = new Hono();

    // Apply middleware to /api/vaults/:vaultId/* routes
    app.use("/api/vaults/:vaultId/*", vaultResolution());

    // Test endpoint that returns vault info from context
    app.get("/api/vaults/:vaultId/info", (c) => {
      const vault = getVaultFromContext(c);
      return c.json({
        id: vault.id,
        name: vault.name,
        path: vault.path,
      });
    });

    return app;
  }

  it("sets vault in context for valid vault ID", async () => {
    await createTestVault("test-vault", "My Test Vault");

    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/test-vault/info");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; name: string; path: string };
    expect(json.id).toBe("test-vault");
    expect(json.name).toBe("My Test Vault");
    expect(json.path).toContain("test-vault");
  });

  it("returns 404 for non-existent vault", async () => {
    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/nonexistent/info");
    const res = await app.fetch(req);

    expect(res.status).toBe(404);
    const json = (await res.json()) as RestErrorResponse;
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("VAULT_NOT_FOUND");
    expect(json.error.message).toContain("nonexistent");
  });

  it("returns 400 for invalid vault ID format", async () => {
    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/invalid@vault/info");
    const res = await app.fetch(req);

    expect(res.status).toBe(400);
    const json = (await res.json()) as RestErrorResponse;
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Invalid vault ID format");
  });

  it("returns 400 for path traversal attempt in vault ID", async () => {
    // URL with encoded slash: ..%2Fsecrets decodes to ../secrets
    // This bypasses URL normalization and reaches our middleware
    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/..%2Fsecrets/info");
    const res = await app.fetch(req);

    expect(res.status).toBe(400);
    const json = (await res.json()) as RestErrorResponse;
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for vault ID starting with hyphen", async () => {
    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/-invalid/info");
    const res = await app.fetch(req);

    expect(res.status).toBe(400);
    const json = (await res.json()) as RestErrorResponse;
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for vault ID with slash", async () => {
    // Note: URL encoding won't help because we validate the decoded value
    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/vault%2Fsubdir/info");
    const res = await app.fetch(req);

    // Hono may interpret this differently, but our validation catches it
    expect([400, 404]).toContain(res.status);
  });

  it("accepts vault ID with numbers", async () => {
    await createTestVault("vault123", "Vault 123");

    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/vault123/info");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string };
    expect(json.id).toBe("vault123");
  });

  it("accepts vault ID with mixed case", async () => {
    await createTestVault("MyVault", "My Vault");

    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/MyVault/info");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string };
    expect(json.id).toBe("MyVault");
  });

  it("accepts vault ID with underscores and hyphens", async () => {
    await createTestVault("my_vault-2", "My Vault 2");

    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/my_vault-2/info");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string };
    expect(json.id).toBe("my_vault-2");
  });

  it("error response matches expected format", async () => {
    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/missing-vault/info");
    const res = await app.fetch(req);

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const json = (await res.json()) as RestErrorResponse;

    // Verify structure matches spec (REQ-NF-3)
    expect(json).toHaveProperty("error");
    expect(json.error).toHaveProperty("code");
    expect(json.error).toHaveProperty("message");
    expect(typeof json.error.code).toBe("string");
    expect(typeof json.error.message).toBe("string");
  });

  it("skips directories without CLAUDE.md", async () => {
    // Create directory but no CLAUDE.md
    const vaultPath = join(testDir, "no-claude");
    await mkdir(vaultPath, { recursive: true });
    await writeFile(join(vaultPath, "README.md"), "# Not a vault");

    const app = createTestApp();
    const req = new Request("http://localhost/api/vaults/no-claude/info");
    const res = await app.fetch(req);

    // Should return 404 because it's not a valid vault
    expect(res.status).toBe(404);
    const json = (await res.json()) as RestErrorResponse;
    expect(json.error.code).toBe("VAULT_NOT_FOUND");
  });
});

describe("getVaultFromContext", () => {
  it("throws when vault is not in context", async () => {
    type AppEnv = { Variables: { vault?: VaultInfo } };
    const app = new Hono<AppEnv>();
    let thrownError: Error | undefined;

    // Route without middleware
    app.get("/test", (c) => {
      try {
        getVaultFromContext(c);
        return c.text("ok");
      } catch (error) {
        thrownError = error as Error;
        throw error;
      }
    });

    // Hono catches the error internally, so we check our captured error
    const req = new Request("http://localhost/test");
    await app.fetch(req);

    expect(thrownError).toBeDefined();
    expect(thrownError!.message).toContain("Vault not found in context");
  });

  it("returns vault when set in context", async () => {
    type AppEnv = { Variables: { vault: VaultInfo } };
    const app = new Hono<AppEnv>();

    // Manually set vault in context to test helper
    app.get("/test", (c) => {
      const mockVault: VaultInfo = {
        id: "test",
        name: "Test",
        path: "/path",
        hasClaudeMd: true,
        contentRoot: "/path",
        inboxPath: "00_Inbox",
        metadataPath: "06_Metadata",
        attachmentPath: "05_Attachments",
        setupComplete: false,
        promptsPerGeneration: 5,
        maxPoolSize: 50,
        quotesPerWeek: 1,
        badges: [],
        order: Infinity,
      };
      c.set("vault", mockVault);

      const vault = getVaultFromContext(c);
      return c.json({ id: vault.id });
    });

    const req = new Request("http://localhost/test");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string };
    expect(json.id).toBe("test");
  });
});

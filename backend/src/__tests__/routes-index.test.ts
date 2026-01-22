/**
 * Route Index Integration Tests
 *
 * Tests the route index that registers vault-scoped REST routes.
 * Verifies:
 * - Vault middleware is applied to all routes (valid vault 200, invalid 404)
 * - Error handler catches thrown errors and returns correct status codes
 * - CORS headers are present on vault-scoped routes
 * - Existing routes (health, vaults list) still work
 *
 * Requirements:
 * - REQ-F-3: REST endpoints accept vault ID as path parameter
 * - REQ-F-55: Return 404 when vault not found
 * - TD-1: Route structure uses `/api/vaults/:vaultId/[resource]` pattern
 * - TD-3: Vault resolution middleware applied to all routes
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import { vaultRoutes } from "../routes";
import { vaultResolution, getVaultFromContext } from "../middleware/vault-resolution";
import { restErrorHandler, type RestErrorResponse } from "../middleware/error-handler";
import { FileBrowserError, PathTraversalError, FileNotFoundError } from "../file-browser";

describe("Route Index Integration", () => {
  let testDir: string;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    // Create a unique test directory for vaults
    testDir = join(
      tmpdir(),
      `routes-index-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
  async function createTestVault(name: string, title: string = `Test ${name}`): Promise<void> {
    const vaultPath = join(testDir, name);
    await mkdir(vaultPath, { recursive: true });
    await writeFile(join(vaultPath, "CLAUDE.md"), `# ${title}`);
  }

  describe("Vault middleware application", () => {
    it("routes under /api/vaults/:vaultId apply vault resolution middleware", async () => {
      await createTestVault("test-vault", "Test Vault");

      // Create a test app that adds a test route to vaultRoutes
      const app = new Hono();
      app.onError(restErrorHandler);

      // Create a fresh vault routes instance for testing
      const testVaultRoutes = new Hono();
      testVaultRoutes.use("/*", vaultResolution());
      testVaultRoutes.get("/test", (c) => {
        const vault = getVaultFromContext(c);
        return c.json({ vaultId: vault.id, vaultName: vault.name });
      });

      app.route("/api/vaults/:vaultId", testVaultRoutes);

      const req = new Request("http://localhost/api/vaults/test-vault/test");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { vaultId: string; vaultName: string };
      expect(json.vaultId).toBe("test-vault");
      expect(json.vaultName).toBe("Test Vault");
    });

    it("returns 404 for non-existent vault", async () => {
      // Create a test app with vault routes
      const app = new Hono();
      app.onError(restErrorHandler);

      const testVaultRoutes = new Hono();
      testVaultRoutes.use("/*", vaultResolution());
      testVaultRoutes.get("/test", (c) => {
        const vault = getVaultFromContext(c);
        return c.json({ vaultId: vault.id });
      });

      app.route("/api/vaults/:vaultId", testVaultRoutes);

      const req = new Request("http://localhost/api/vaults/nonexistent/test");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
      expect(json.error.message).toContain("nonexistent");
    });

    it("returns 400 for invalid vault ID format", async () => {
      const app = new Hono();
      app.onError(restErrorHandler);

      const testVaultRoutes = new Hono();
      testVaultRoutes.use("/*", vaultResolution());
      testVaultRoutes.get("/test", (c) => c.json({ ok: true }));

      app.route("/api/vaults/:vaultId", testVaultRoutes);

      // Invalid vault ID with special characters
      const req = new Request("http://localhost/api/vaults/invalid@vault/test");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Error handler integration", () => {
    it("catches FileBrowserError and returns correct status", async () => {
      await createTestVault("test-vault");

      const app = new Hono();
      app.onError(restErrorHandler);

      const testVaultRoutes = new Hono();
      testVaultRoutes.use("/*", vaultResolution());
      testVaultRoutes.get("/files/*", () => {
        throw new FileNotFoundError("File not found: notes.md");
      });

      app.route("/api/vaults/:vaultId", testVaultRoutes);

      const req = new Request("http://localhost/api/vaults/test-vault/files/notes.md");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
      expect(json.error.message).toBe("File not found: notes.md");
    });

    it("catches PathTraversalError and returns 403", async () => {
      await createTestVault("test-vault");

      const app = new Hono();
      app.onError(restErrorHandler);

      const testVaultRoutes = new Hono();
      testVaultRoutes.use("/*", vaultResolution());
      // Simulate a handler that detects path traversal and throws
      testVaultRoutes.get("/files/*", () => {
        throw new PathTraversalError("Path escapes vault boundary");
      });

      app.route("/api/vaults/:vaultId", testVaultRoutes);

      // Use a normal path - the handler will throw PathTraversalError
      // In real usage, the file-browser module would detect traversal attempts
      const req = new Request("http://localhost/api/vaults/test-vault/files/some-file.md");
      const res = await app.fetch(req);

      expect(res.status).toBe(403);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("PATH_TRAVERSAL");
    });

    it("catches unknown errors and returns 500 with safe message", async () => {
      await createTestVault("test-vault");

      const app = new Hono();
      app.onError(restErrorHandler);

      const testVaultRoutes = new Hono();
      testVaultRoutes.use("/*", vaultResolution());
      testVaultRoutes.get("/crash", () => {
        throw new Error("Internal database connection failed");
      });

      app.route("/api/vaults/:vaultId", testVaultRoutes);

      const req = new Request("http://localhost/api/vaults/test-vault/crash");
      const res = await app.fetch(req);

      expect(res.status).toBe(500);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INTERNAL_ERROR");
      // Should not expose internal error details
      expect(json.error.message).not.toContain("database");
      expect(json.error.message).toBe("An unexpected error occurred. Please try again later.");
    });
  });

  describe("CORS integration", () => {
    it("includes CORS headers on vault-scoped routes", async () => {
      await createTestVault("test-vault");

      // Use the actual createApp to get real CORS config
      const app = createApp();

      // We need to add a test route since vaultRoutes is empty
      // For this test, we'll use OPTIONS preflight to verify CORS
      const req = new Request("http://localhost/api/vaults/test-vault/files", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      });
      const res = await app.fetch(req);

      // CORS preflight should respond with access control headers
      // Note: The actual response may vary, but CORS headers should be present
      const corsHeader = res.headers.get("Access-Control-Allow-Origin");
      // CORS should allow localhost:5173 or include it
      expect(corsHeader).toBeTruthy();
    });

    it("CORS allows configured origins", async () => {
      await createTestVault("test-vault");

      const app = createApp();

      // Make a request with Origin header from allowed origin
      const req = new Request("http://localhost/api/vaults/test-vault/test", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      });
      const res = await app.fetch(req);

      // Check CORS headers
      const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
      expect(allowOrigin).toBe("http://localhost:5173");
    });
  });

  describe("Existing routes unaffected", () => {
    it("health endpoint still works", async () => {
      const app = createApp();

      const req = new Request("http://localhost/api/health");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("Memory Loop Backend");
    });

    it("vaults list endpoint still works", async () => {
      await createTestVault("vault-one", "Vault One");
      await createTestVault("vault-two", "Vault Two");

      const app = createApp();

      const req = new Request("http://localhost/api/vaults");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { vaults: Array<{ id: string; name: string }> };
      expect(json.vaults).toBeDefined();
      expect(json.vaults.length).toBe(2);

      const ids = json.vaults.map((v) => v.id).sort();
      expect(ids).toEqual(["vault-one", "vault-two"]);
    });

    it("sessions endpoint still works", async () => {
      const app = createApp();

      const req = new Request("http://localhost/api/sessions/some-vault");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { sessionId: string | null };
      // No session exists, so should return null
      expect(json.sessionId).toBeNull();
    });
  });

  describe("vaultRoutes structure", () => {
    it("exports vaultRoutes as a Hono instance", () => {
      expect(vaultRoutes).toBeDefined();
      expect(vaultRoutes).toBeInstanceOf(Hono);
    });

    it("vaultRoutes has vault resolution middleware applied", async () => {
      await createTestVault("middleware-test");

      // Create app and add a test route to vaultRoutes
      const app = new Hono();
      app.onError(restErrorHandler);

      // The exported vaultRoutes already has middleware
      // Add a test route to verify middleware runs
      vaultRoutes.get("/verify-middleware", (c) => {
        const vault = getVaultFromContext(c);
        return c.json({ middlewareRan: true, vaultId: vault.id });
      });

      app.route("/api/vaults/:vaultId", vaultRoutes);

      const req = new Request("http://localhost/api/vaults/middleware-test/verify-middleware");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { middlewareRan: boolean; vaultId: string };
      expect(json.middlewareRan).toBe(true);
      expect(json.vaultId).toBe("middleware-test");
    });
  });

  describe("Error response format consistency", () => {
    it("vault middleware errors match RestErrorResponse format", async () => {
      const app = new Hono();
      app.onError(restErrorHandler);

      const testVaultRoutes = new Hono();
      testVaultRoutes.use("/*", vaultResolution());
      testVaultRoutes.get("/test", (c) => c.json({ ok: true }));

      app.route("/api/vaults/:vaultId", testVaultRoutes);

      const req = new Request("http://localhost/api/vaults/nonexistent/test");
      const res = await app.fetch(req);

      const json = (await res.json()) as RestErrorResponse;

      // Verify exact structure
      expect(Object.keys(json)).toEqual(["error"]);
      expect(Object.keys(json.error).sort()).toEqual(["code", "message"]);
      expect(typeof json.error.code).toBe("string");
      expect(typeof json.error.message).toBe("string");
    });

    it("error handler responses match RestErrorResponse format", async () => {
      await createTestVault("test-vault");

      const app = new Hono();
      app.onError(restErrorHandler);

      const testVaultRoutes = new Hono();
      testVaultRoutes.use("/*", vaultResolution());
      testVaultRoutes.get("/error", () => {
        throw new FileBrowserError("Test error", "INTERNAL_ERROR");
      });

      app.route("/api/vaults/:vaultId", testVaultRoutes);

      const req = new Request("http://localhost/api/vaults/test-vault/error");
      const res = await app.fetch(req);

      const json = (await res.json()) as RestErrorResponse;

      // Verify exact structure
      expect(Object.keys(json)).toEqual(["error"]);
      expect(Object.keys(json.error).sort()).toEqual(["code", "message"]);
      expect(typeof json.error.code).toBe("string");
      expect(typeof json.error.message).toBe("string");
    });
  });
});

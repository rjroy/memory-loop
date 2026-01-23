/**
 * Memory and Sessions REST Routes Integration Tests
 *
 * Tests the memory and session REST endpoints:
 * - GET /api/config/memory - Get memory file content (global, preferred)
 * - PUT /api/config/memory - Save memory file content (global, preferred)
 * - GET /api/vaults/:vaultId/memory - Get memory file content (legacy)
 * - PUT /api/vaults/:vaultId/memory - Save memory file content (legacy)
 * - DELETE /api/vaults/:vaultId/sessions/:sessionId - Delete a session
 *
 * Requirements:
 * - REQ-F-35: Get memory.md content
 * - REQ-F-36: Save memory.md content
 * - REQ-F-40: Delete session
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-012)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import type {
  MemoryContentResponse,
  MemorySavedResponse,
} from "../routes/memory";
import type { DeleteSessionResponse } from "../routes/sessions";
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
    `routes-memory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Creates a test vault with CLAUDE.md.
 */
async function createTestVault(testDir: string, vaultName: string): Promise<string> {
  const vaultPath = join(testDir, vaultName);
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "CLAUDE.md"), `# ${vaultName}`);
  return vaultPath;
}

/**
 * Creates a test memory file at the specified path.
 */
async function createMemoryFile(memoryPath: string, content: string): Promise<void> {
  const dir = memoryPath.substring(0, memoryPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(memoryPath, content);
}

/**
 * Creates a test session file in a vault.
 */
async function createTestSession(
  vaultPath: string,
  sessionId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const sessionsDir = join(vaultPath, ".memory-loop", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, `${sessionId}.json`),
    JSON.stringify(metadata, null, 2)
  );
}

// =============================================================================
// Memory Routes Tests
// =============================================================================

describe("Memory REST Routes", () => {
  let testDir: string;
  let memoryFilePath: string;
  let app: ReturnType<typeof createApp>;
  const originalVaultsDir = process.env.VAULTS_DIR;
  const originalMemoryPath = process.env.MEMORY_FILE_PATH_OVERRIDE;

  beforeEach(async () => {
    testDir = await createTestDir();
    process.env.VAULTS_DIR = testDir;

    // Set up memory file path in temp directory
    memoryFilePath = join(testDir, ".claude", "rules", "memory.md");
    process.env.MEMORY_FILE_PATH_OVERRIDE = memoryFilePath;

    app = createApp();
  });

  afterEach(async () => {
    // Restore original env
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }

    if (originalMemoryPath === undefined) {
      delete process.env.MEMORY_FILE_PATH_OVERRIDE;
    } else {
      process.env.MEMORY_FILE_PATH_OVERRIDE = originalMemoryPath;
    }

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // GET /memory Tests (REQ-F-35)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/memory", () => {
    test("returns memory content when file exists", async () => {
      await createTestVault(testDir, "test-vault");
      const content = "# Memory\n\n- Fact one\n- Fact two\n";
      await createMemoryFile(memoryFilePath, content);

      const req = new Request("http://localhost/api/vaults/test-vault/memory");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemoryContentResponse;

      expect(json.content).toBe(content);
      expect(json.exists).toBe(true);
      expect(json.sizeBytes).toBe(Buffer.byteLength(content, "utf-8"));
    });

    test("returns empty content when file does not exist", async () => {
      await createTestVault(testDir, "test-vault");
      // Do not create memory file

      const req = new Request("http://localhost/api/vaults/test-vault/memory");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemoryContentResponse;

      expect(json.content).toBe("");
      expect(json.exists).toBe(false);
      expect(json.sizeBytes).toBe(0);
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/memory");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });
  });

  // ===========================================================================
  // PUT /memory Tests (REQ-F-36)
  // ===========================================================================

  describe("PUT /api/vaults/:vaultId/memory", () => {
    test("saves memory content successfully", async () => {
      await createTestVault(testDir, "test-vault");
      const newContent = "# Memory\n\n- New fact\n";

      const req = new Request("http://localhost/api/vaults/test-vault/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemorySavedResponse;

      expect(json.success).toBe(true);
      expect(json.sizeBytes).toBeGreaterThan(0);

      // Verify file was written
      const savedContent = await readFile(memoryFilePath, "utf-8");
      expect(savedContent).toBe(newContent);
    });

    test("overwrites existing memory content", async () => {
      await createTestVault(testDir, "test-vault");
      await createMemoryFile(memoryFilePath, "# Old Content\n");

      const newContent = "# New Content\n\n- Updated fact\n";
      const req = new Request("http://localhost/api/vaults/test-vault/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemorySavedResponse;
      expect(json.success).toBe(true);

      // Verify file was overwritten
      const savedContent = await readFile(memoryFilePath, "utf-8");
      expect(savedContent).toBe(newContent);
    });

    test("returns 400 when content is missing", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("content");
    });

    test("returns 400 when content is not a string", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: 123 }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# Memory\n" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("handles empty content string", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemorySavedResponse;
      expect(json.success).toBe(true);

      // Verify empty file was written
      const savedContent = await readFile(memoryFilePath, "utf-8");
      expect(savedContent).toBe("");
    });
  });
});

// =============================================================================
// Global Memory Routes Tests (preferred endpoint)
// =============================================================================

describe("Global Memory REST Routes", () => {
  let testDir: string;
  let memoryFilePath: string;
  let app: ReturnType<typeof createApp>;
  const originalVaultsDir = process.env.VAULTS_DIR;
  const originalMemoryPath = process.env.MEMORY_FILE_PATH_OVERRIDE;

  beforeEach(async () => {
    testDir = await createTestDir();
    process.env.VAULTS_DIR = testDir;

    // Set up memory file path in temp directory
    memoryFilePath = join(testDir, ".claude", "rules", "memory.md");
    process.env.MEMORY_FILE_PATH_OVERRIDE = memoryFilePath;

    app = createApp();
  });

  afterEach(async () => {
    // Restore original env
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }

    if (originalMemoryPath === undefined) {
      delete process.env.MEMORY_FILE_PATH_OVERRIDE;
    } else {
      process.env.MEMORY_FILE_PATH_OVERRIDE = originalMemoryPath;
    }

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // GET /api/config/memory Tests (REQ-F-35)
  // ===========================================================================

  describe("GET /api/config/memory", () => {
    test("returns memory content when file exists", async () => {
      const content = "# Memory\n\n- Global fact one\n- Global fact two\n";
      await createMemoryFile(memoryFilePath, content);

      const req = new Request("http://localhost/api/config/memory");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemoryContentResponse;

      expect(json.content).toBe(content);
      expect(json.exists).toBe(true);
      expect(json.sizeBytes).toBe(Buffer.byteLength(content, "utf-8"));
    });

    test("returns empty content when file does not exist", async () => {
      // Do not create memory file

      const req = new Request("http://localhost/api/config/memory");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemoryContentResponse;

      expect(json.content).toBe("");
      expect(json.exists).toBe(false);
      expect(json.sizeBytes).toBe(0);
    });

    test("does not require vault context", async () => {
      // No vault created - global endpoint should still work
      const content = "# Memory without vault\n";
      await createMemoryFile(memoryFilePath, content);

      const req = new Request("http://localhost/api/config/memory");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemoryContentResponse;
      expect(json.content).toBe(content);
      expect(json.exists).toBe(true);
    });
  });

  // ===========================================================================
  // PUT /api/config/memory Tests (REQ-F-36)
  // ===========================================================================

  describe("PUT /api/config/memory", () => {
    test("saves memory content successfully", async () => {
      const newContent = "# Memory\n\n- New global fact\n";

      const req = new Request("http://localhost/api/config/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemorySavedResponse;

      expect(json.success).toBe(true);
      expect(json.sizeBytes).toBeGreaterThan(0);

      // Verify file was written
      const savedContent = await readFile(memoryFilePath, "utf-8");
      expect(savedContent).toBe(newContent);
    });

    test("overwrites existing memory content", async () => {
      await createMemoryFile(memoryFilePath, "# Old Global Content\n");

      const newContent = "# New Global Content\n\n- Updated global fact\n";
      const req = new Request("http://localhost/api/config/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemorySavedResponse;
      expect(json.success).toBe(true);

      // Verify file was overwritten
      const savedContent = await readFile(memoryFilePath, "utf-8");
      expect(savedContent).toBe(newContent);
    });

    test("returns 400 when content is missing", async () => {
      const req = new Request("http://localhost/api/config/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("content");
    });

    test("returns 400 when content is not a string", async () => {
      const req = new Request("http://localhost/api/config/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: 123 }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("handles empty content string", async () => {
      const req = new Request("http://localhost/api/config/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemorySavedResponse;
      expect(json.success).toBe(true);

      // Verify empty file was written
      const savedContent = await readFile(memoryFilePath, "utf-8");
      expect(savedContent).toBe("");
    });

    test("does not require vault context", async () => {
      // No vault created - global endpoint should still work
      const newContent = "# Memory without vault context\n";

      const req = new Request("http://localhost/api/config/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as MemorySavedResponse;
      expect(json.success).toBe(true);

      // Verify file was written
      const savedContent = await readFile(memoryFilePath, "utf-8");
      expect(savedContent).toBe(newContent);
    });
  });
});

// =============================================================================
// Sessions Routes Tests
// =============================================================================

describe("Sessions REST Routes", () => {
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
  // DELETE /sessions/:sessionId Tests (REQ-F-40)
  // ===========================================================================

  describe("DELETE /api/vaults/:vaultId/sessions/:sessionId", () => {
    test("deletes existing session successfully", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");
      const sessionId = "test-session-123";
      await createTestSession(vaultPath, sessionId, {
        id: sessionId,
        vaultId: "test-vault",
        vaultPath: vaultPath,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messages: [],
      });

      const req = new Request(
        `http://localhost/api/vaults/test-vault/sessions/${sessionId}`,
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as DeleteSessionResponse;

      expect(json.success).toBe(true);
      expect(json.deleted).toBe(true);
    });

    test("returns success with deleted=false for non-existent session", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/sessions/nonexistent-session",
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as DeleteSessionResponse;

      expect(json.success).toBe(true);
      expect(json.deleted).toBe(false);
    });

    test("returns 400 for invalid session ID with path traversal dots", async () => {
      await createTestVault(testDir, "test-vault");

      // Use URL-encoded path traversal that won't be normalized by URL parser
      // The session ID "test..session" contains ".." which should fail validation
      const req = new Request(
        "http://localhost/api/vaults/test-vault/sessions/test..session",
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 for empty session ID", async () => {
      await createTestVault(testDir, "test-vault");

      // Note: Empty session ID in URL path typically results in 404 or different route match
      // However, we should test URL encoding behavior for empty strings
      const req = new Request(
        "http://localhost/api/vaults/test-vault/sessions/%00",
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      // The session ID validation should catch null bytes as invalid
      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 for session ID with special characters", async () => {
      await createTestVault(testDir, "test-vault");

      // Session IDs should only contain alphanumeric, hyphens, underscores, periods
      // Use URL-encoded special characters that pass through URL parsing
      const invalidSessionId = encodeURIComponent("test@session#1");
      const req = new Request(
        `http://localhost/api/vaults/test-vault/sessions/${invalidSessionId}`,
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/sessions/some-session",
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("accepts valid UUID-style session ID", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");
      const sessionId = "550e8400-e29b-41d4-a716-446655440000";
      await createTestSession(vaultPath, sessionId, {
        id: sessionId,
        vaultId: "test-vault",
        vaultPath: vaultPath,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messages: [],
      });

      const req = new Request(
        `http://localhost/api/vaults/test-vault/sessions/${sessionId}`,
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as DeleteSessionResponse;
      expect(json.success).toBe(true);
      expect(json.deleted).toBe(true);
    });

    test("accepts session ID with underscores and periods", async () => {
      const vaultPath = await createTestVault(testDir, "test-vault");
      const sessionId = "session_2024.01.22_abc123";
      await createTestSession(vaultPath, sessionId, {
        id: sessionId,
        vaultId: "test-vault",
        vaultPath: vaultPath,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messages: [],
      });

      const req = new Request(
        `http://localhost/api/vaults/test-vault/sessions/${sessionId}`,
        { method: "DELETE" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as DeleteSessionResponse;
      expect(json.success).toBe(true);
      expect(json.deleted).toBe(true);
    });
  });
});

// =============================================================================
// Error Response Format Tests
// =============================================================================

describe("Error Response Format", () => {
  let testDir: string;
  let app: ReturnType<typeof createApp>;
  const originalVaultsDir = process.env.VAULTS_DIR;
  const originalMemoryPath = process.env.MEMORY_FILE_PATH_OVERRIDE;

  beforeEach(async () => {
    testDir = await createTestDir();
    process.env.VAULTS_DIR = testDir;
    process.env.MEMORY_FILE_PATH_OVERRIDE = join(testDir, ".claude", "rules", "memory.md");
    app = createApp();
  });

  afterEach(async () => {
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }

    if (originalMemoryPath === undefined) {
      delete process.env.MEMORY_FILE_PATH_OVERRIDE;
    } else {
      process.env.MEMORY_FILE_PATH_OVERRIDE = originalMemoryPath;
    }

    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("memory route error responses match RestErrorResponse schema", async () => {
    await createTestVault(testDir, "test-vault");

    const req = new Request("http://localhost/api/vaults/test-vault/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: 123 }), // Invalid type
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

  test("session route error responses match RestErrorResponse schema", async () => {
    await createTestVault(testDir, "test-vault");

    // Use a session ID with ".." which fails validation
    const req = new Request(
      "http://localhost/api/vaults/test-vault/sessions/test..invalid",
      { method: "DELETE" }
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
    const req = new Request("http://localhost/api/vaults/nonexistent/memory");
    const res = await app.fetch(req);

    expect(res.status).toBe(404);

    const json = (await res.json()) as RestErrorResponse;
    expect(json.error.code).toBe("VAULT_NOT_FOUND");
    expect(json.error.message).toContain("nonexistent");
  });
});

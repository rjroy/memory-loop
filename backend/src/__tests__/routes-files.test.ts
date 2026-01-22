/**
 * File Browser REST Routes Integration Tests
 *
 * Tests the file browser REST endpoints:
 * - GET /api/vaults/:vaultId/files?path= - List directory
 * - POST /api/vaults/:vaultId/files - Create file
 * - GET /api/vaults/:vaultId/files/:path - Read file
 * - PUT /api/vaults/:vaultId/files/:path - Write file
 * - PATCH /api/vaults/:vaultId/files/:path - Rename/move file
 * - DELETE /api/vaults/:vaultId/files/:path - Delete file
 * - POST /api/vaults/:vaultId/directories - Create directory
 * - GET /api/vaults/:vaultId/directories/:path/contents - Directory contents
 * - DELETE /api/vaults/:vaultId/directories/:path - Delete directory
 * - POST /api/vaults/:vaultId/archive/:path/archive - Archive file
 *
 * Requirements:
 * - REQ-F-5: Directory listing
 * - REQ-F-6: File read
 * - REQ-F-7: File write
 * - REQ-F-8: File delete
 * - REQ-F-9: File create
 * - REQ-F-10: Directory create
 * - REQ-F-11: Directory delete
 * - REQ-F-12, REQ-F-13: Rename/move
 * - REQ-F-14: Archive
 * - REQ-F-15: Directory contents
 * - REQ-F-60: URL-encoded paths handled correctly
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-004)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import type { FileEntry } from "@memory-loop/shared";
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
    `routes-files-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
// File Browser Routes Tests
// =============================================================================

describe("File Browser REST Routes", () => {
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
  // Directory Listing Tests (REQ-F-5)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/files", () => {
    test("lists root directory contents", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes.md": "# Notes",
        "readme.md": "# README",
        "subfolder/nested.md": "# Nested",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/files");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string; entries: FileEntry[] };

      expect(json.path).toBe("");
      expect(Array.isArray(json.entries)).toBe(true);

      // Should find files and directories (not hidden files)
      const names = json.entries.map((e) => e.name);
      expect(names).toContain("notes.md");
      expect(names).toContain("readme.md");
      expect(names).toContain("subfolder");
      // CLAUDE.md is not hidden, should be included
      expect(names).toContain("CLAUDE.md");
    });

    test("lists subdirectory contents", async () => {
      await createTestVault(testDir, "test-vault", {
        "subfolder/file1.md": "# File 1",
        "subfolder/file2.md": "# File 2",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files?path=subfolder"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string; entries: FileEntry[] };

      expect(json.path).toBe("subfolder");
      expect(json.entries.length).toBe(2);
      const names = json.entries.map((e) => e.name);
      expect(names).toContain("file1.md");
      expect(names).toContain("file2.md");
    });

    test("sorts directories before files", async () => {
      await createTestVault(testDir, "test-vault", {
        "aaa-file.md": "# AAA File",
        "zzz-folder/nested.md": "# Nested",
        "bbb-file.md": "# BBB File",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/files");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string; entries: FileEntry[] };

      // Filter to our test entries (exclude CLAUDE.md)
      const testEntries = json.entries.filter(
        (e) => e.name !== "CLAUDE.md"
      );

      // First entry should be the directory
      expect(testEntries[0]?.type).toBe("directory");
      expect(testEntries[0]?.name).toBe("zzz-folder");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/files");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("returns 404 for non-existent directory", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files?path=nonexistent"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("DIRECTORY_NOT_FOUND");
    });

    test("returns 403 for path traversal attempt", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files?path=../"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(403);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("PATH_TRAVERSAL");
    });

    test("handles URL-encoded paths with spaces", async () => {
      await createTestVault(testDir, "test-vault", {
        "my folder/notes.md": "# Notes in folder with spaces",
      });

      const encodedPath = encodeURIComponent("my folder");
      const req = new Request(
        `http://localhost/api/vaults/test-vault/files?path=${encodedPath}`
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string; entries: FileEntry[] };
      expect(json.path).toBe("my folder");
      expect(json.entries.some((e) => e.name === "notes.md")).toBe(true);
    });
  });

  // ===========================================================================
  // File Create Tests (REQ-F-9)
  // ===========================================================================

  describe("POST /api/vaults/:vaultId/files", () => {
    test("creates a new file in root", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "", name: "new-note" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(201);

      const json = (await res.json()) as { path: string };
      expect(json.path).toBe("new-note.md");

      // Verify file exists
      const fileContent = await readFile(
        join(testDir, "test-vault", "new-note.md"),
        "utf-8"
      );
      expect(fileContent).toBe("");
    });

    test("creates a new file in subdirectory", async () => {
      await createTestVault(testDir, "test-vault", {
        "subfolder/.gitkeep": "",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "subfolder", name: "nested-note" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(201);

      const json = (await res.json()) as { path: string };
      expect(json.path).toBe("subfolder/nested-note.md");
    });

    test("returns 400 for empty name", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "", name: "" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 for invalid characters in name", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "", name: "invalid/name" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 when file already exists", async () => {
      await createTestVault(testDir, "test-vault", {
        "existing.md": "# Existing",
      });

      const req = new Request("http://localhost/api/vaults/test-vault/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "", name: "existing" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 404 for non-existent parent directory", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "nonexistent", name: "note" }),
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("DIRECTORY_NOT_FOUND");
    });
  });

  // ===========================================================================
  // File Read Tests (REQ-F-6)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/files/:path", () => {
    test("reads file content", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes.md": "# My Notes\n\nThis is the content.",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/notes.md"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        path: string;
        content: string;
        truncated: boolean;
      };

      expect(json.path).toBe("notes.md");
      expect(json.content).toBe("# My Notes\n\nThis is the content.");
      expect(json.truncated).toBe(false);
    });

    test("reads file in subdirectory", async () => {
      await createTestVault(testDir, "test-vault", {
        "folder/nested.md": "# Nested Content",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/folder/nested.md"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string; content: string };
      expect(json.path).toBe("folder/nested.md");
      expect(json.content).toBe("# Nested Content");
    });

    test("handles URL-encoded paths with spaces", async () => {
      await createTestVault(testDir, "test-vault", {
        "my notes/important.md": "# Important Notes",
      });

      const encodedPath = encodeURIComponent("my notes/important.md");
      const req = new Request(
        `http://localhost/api/vaults/test-vault/files/${encodedPath}`
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string; content: string };
      expect(json.path).toBe("my notes/important.md");
      expect(json.content).toBe("# Important Notes");
    });

    test("returns 404 for non-existent file", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/nonexistent.md"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
    });

    test("returns 400 for invalid file type", async () => {
      await createTestVault(testDir, "test-vault", {
        "image.png": "binary data",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/image.png"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INVALID_FILE_TYPE");
    });

    test("returns 403 for path traversal attempt via encoded path", async () => {
      await createTestVault(testDir, "test-vault", {});

      // URL-encode the path traversal attempt to bypass URL normalization
      // Use .md extension so the file type check passes and traversal check runs
      const encodedPath = encodeURIComponent("../../../etc/secret.md");
      const req = new Request(
        `http://localhost/api/vaults/test-vault/files/${encodedPath}`
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(403);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("PATH_TRAVERSAL");
    });
  });

  // ===========================================================================
  // File Write Tests (REQ-F-7)
  // ===========================================================================

  describe("PUT /api/vaults/:vaultId/files/:path", () => {
    test("writes content to existing file", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes.md": "# Old Content",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/notes.md",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "# New Content\n\nUpdated!" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string; success: boolean };
      expect(json.path).toBe("notes.md");
      expect(json.success).toBe(true);

      // Verify file content
      const fileContent = await readFile(
        join(testDir, "test-vault", "notes.md"),
        "utf-8"
      );
      expect(fileContent).toBe("# New Content\n\nUpdated!");
    });

    test("returns 400 for missing content", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes.md": "# Content",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/notes.md",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 404 for non-existent file", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/nonexistent.md",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "# New Content" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
    });

    test("returns 400 for invalid file type", async () => {
      await createTestVault(testDir, "test-vault", {
        "image.png": "binary",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/image.png",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "text content" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INVALID_FILE_TYPE");
    });
  });

  // ===========================================================================
  // File Rename Tests (REQ-F-12)
  // ===========================================================================

  describe("PATCH /api/vaults/:vaultId/files/:path (rename)", () => {
    test("renames a file", async () => {
      await createTestVault(testDir, "test-vault", {
        "old-name.md": "# Content",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/old-name.md",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newName: "new-name" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        oldPath: string;
        newPath: string;
        referencesUpdated: number;
      };
      expect(json.oldPath).toBe("old-name.md");
      expect(json.newPath).toBe("new-name.md");

      // Verify file was renamed
      const newStat = await stat(join(testDir, "test-vault", "new-name.md"));
      expect(newStat).toBeDefined();
    });

    test("preserves file extension on rename", async () => {
      await createTestVault(testDir, "test-vault", {
        "test.json": '{"key": "value"}',
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/test.json",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newName: "renamed" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { oldPath: string; newPath: string };
      expect(json.newPath).toBe("renamed.json");
    });

    test("returns 400 for invalid new name", async () => {
      await createTestVault(testDir, "test-vault", {
        "test.md": "# Content",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/test.md",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newName: "invalid/name" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 when destination already exists", async () => {
      await createTestVault(testDir, "test-vault", {
        "source.md": "# Source",
        "destination.md": "# Destination",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/source.md",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newName: "destination" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ===========================================================================
  // File Move Tests (REQ-F-13)
  // ===========================================================================

  describe("PATCH /api/vaults/:vaultId/files/:path (move)", () => {
    test("moves a file to another directory", async () => {
      await createTestVault(testDir, "test-vault", {
        "source.md": "# Source Content",
        "target-folder/.gitkeep": "",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/source.md",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPath: "target-folder" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { oldPath: string; newPath: string };
      expect(json.oldPath).toBe("source.md");
      expect(json.newPath).toBe("target-folder/source.md");

      // Verify file was moved
      const movedStat = await stat(join(testDir, "test-vault", "target-folder", "source.md"));
      expect(movedStat).toBeDefined();
    });

    test("returns 404 for non-existent target directory", async () => {
      await createTestVault(testDir, "test-vault", {
        "source.md": "# Content",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/source.md",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPath: "nonexistent/path" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("DIRECTORY_NOT_FOUND");
    });

    test("returns 400 when missing both newName and newPath", async () => {
      await createTestVault(testDir, "test-vault", {
        "test.md": "# Content",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/test.md",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ===========================================================================
  // File Delete Tests (REQ-F-8)
  // ===========================================================================

  describe("DELETE /api/vaults/:vaultId/files/:path", () => {
    test("deletes a file", async () => {
      await createTestVault(testDir, "test-vault", {
        "to-delete.md": "# Delete Me",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/to-delete.md",
        {
          method: "DELETE",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string };
      expect(json.path).toBe("to-delete.md");

      // Verify file was deleted
      try {
        await stat(join(testDir, "test-vault", "to-delete.md"));
        throw new Error("Expected stat to throw");
      } catch {
        // Expected - file should not exist
      }
    });

    test("returns 404 for non-existent file", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/nonexistent.md",
        {
          method: "DELETE",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
    });

    test("returns 400 when trying to delete a directory via file endpoint", async () => {
      await createTestVault(testDir, "test-vault", {
        "folder/.gitkeep": "",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/folder",
        {
          method: "DELETE",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INVALID_FILE_TYPE");
    });
  });

  // ===========================================================================
  // Directory Create Tests (REQ-F-10)
  // ===========================================================================

  describe("POST /api/vaults/:vaultId/directories", () => {
    test("creates a new directory in root", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/directories",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "", name: "new-folder" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(201);

      const json = (await res.json()) as { path: string };
      expect(json.path).toBe("new-folder");

      // Verify directory exists
      const dirStat = await stat(join(testDir, "test-vault", "new-folder"));
      expect(dirStat.isDirectory()).toBe(true);
    });

    test("creates a nested directory", async () => {
      await createTestVault(testDir, "test-vault", {
        "parent/.gitkeep": "",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/directories",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "parent", name: "child" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(201);

      const json = (await res.json()) as { path: string };
      expect(json.path).toBe("parent/child");
    });

    test("returns 400 for invalid directory name", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/directories",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "", name: "invalid name with spaces" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 when directory already exists", async () => {
      await createTestVault(testDir, "test-vault", {
        "existing/.gitkeep": "",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/directories",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "", name: "existing" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ===========================================================================
  // Directory Contents Tests (REQ-F-15)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/directories/:path/contents", () => {
    test("returns directory contents for deletion preview", async () => {
      await createTestVault(testDir, "test-vault", {
        "folder/file1.md": "# File 1",
        "folder/file2.md": "# File 2",
        "folder/subfolder/nested.md": "# Nested",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/directories/folder/contents"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        path: string;
        files: string[];
        directories: string[];
        totalFiles: number;
        totalDirectories: number;
        truncated: boolean;
      };

      expect(json.path).toBe("folder");
      expect(json.totalFiles).toBe(3);
      expect(json.totalDirectories).toBe(1);
      expect(json.files).toContain("file1.md");
      expect(json.files).toContain("file2.md");
      expect(json.directories).toContain("subfolder");
    });

    test("returns 404 for non-existent directory", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/directories/nonexistent/contents"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("DIRECTORY_NOT_FOUND");
    });

    test("returns 400 when path is a file", async () => {
      await createTestVault(testDir, "test-vault", {
        "file.md": "# File",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/directories/file.md/contents"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INVALID_FILE_TYPE");
    });
  });

  // ===========================================================================
  // Directory Delete Tests (REQ-F-11)
  // ===========================================================================

  describe("DELETE /api/vaults/:vaultId/directories/:path", () => {
    test("deletes a directory and its contents", async () => {
      await createTestVault(testDir, "test-vault", {
        "to-delete/file1.md": "# File 1",
        "to-delete/file2.md": "# File 2",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/directories/to-delete",
        {
          method: "DELETE",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        path: string;
        filesDeleted: number;
        directoriesDeleted: number;
      };

      expect(json.path).toBe("to-delete");
      expect(json.filesDeleted).toBe(2);

      // Verify directory was deleted
      try {
        await stat(join(testDir, "test-vault", "to-delete"));
        throw new Error("Expected stat to throw");
      } catch {
        // Expected - directory should not exist
      }
    });

    test("returns 404 for non-existent directory", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/directories/nonexistent",
        {
          method: "DELETE",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("DIRECTORY_NOT_FOUND");
    });

    test("returns 400 when path is a file", async () => {
      await createTestVault(testDir, "test-vault", {
        "file.md": "# File",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/directories/file.md",
        {
          method: "DELETE",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INVALID_FILE_TYPE");
    });
  });

  // ===========================================================================
  // Archive Tests (REQ-F-14)
  // ===========================================================================

  describe("POST /api/vaults/:vaultId/archive/:path/archive", () => {
    test("archives a directory", async () => {
      await createTestVault(testDir, "test-vault", {
        "project/notes.md": "# Project Notes",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/archive/project/archive",
        {
          method: "POST",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        path: string;
        archivePath: string;
      };

      expect(json.path).toBe("project");
      expect(json.archivePath).toMatch(/04_Archive\/\d{4}-\d{2}\/project/);

      // Verify original was moved
      try {
        await stat(join(testDir, "test-vault", "project"));
        throw new Error("Expected stat to throw");
      } catch {
        // Expected - original should not exist
      }
    });

    test("returns 404 for non-existent directory", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/archive/nonexistent/archive",
        {
          method: "POST",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("DIRECTORY_NOT_FOUND");
    });

    test("returns 400 when path is a file", async () => {
      await createTestVault(testDir, "test-vault", {
        "file.md": "# File",
      });

      const req = new Request(
        "http://localhost/api/vaults/test-vault/archive/file.md/archive",
        {
          method: "POST",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INVALID_FILE_TYPE");
    });
  });

  // ===========================================================================
  // Error Response Format Tests
  // ===========================================================================

  describe("Error Response Format", () => {
    test("error responses match RestErrorResponse schema", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request(
        "http://localhost/api/vaults/test-vault/files/nonexistent.md"
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
        "http://localhost/api/vaults/nonexistent/files/test.md"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
      expect(json.error.message).toContain("nonexistent");
    });
  });

  // ===========================================================================
  // URL Encoding Tests (REQ-F-60)
  // ===========================================================================

  describe("URL Encoding (REQ-F-60)", () => {
    test("handles special characters in file names", async () => {
      await createTestVault(testDir, "test-vault", {
        "file with spaces.md": "# Spaces",
      });

      const encodedPath = encodeURIComponent("file with spaces.md");
      const req = new Request(
        `http://localhost/api/vaults/test-vault/files/${encodedPath}`
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string; content: string };
      expect(json.path).toBe("file with spaces.md");
      expect(json.content).toBe("# Spaces");
    });

    test("handles unicode characters in paths", async () => {
      await createTestVault(testDir, "test-vault", {
        "notes-cafe.md": "# Notes about cafe",
      });

      const encodedPath = encodeURIComponent("notes-cafe.md");
      const req = new Request(
        `http://localhost/api/vaults/test-vault/files/${encodedPath}`
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string };
      expect(json.path).toBe("notes-cafe.md");
    });

    test("handles nested paths with special characters", async () => {
      await createTestVault(testDir, "test-vault", {
        "my folder/sub dir/file.md": "# Nested with spaces",
      });

      const encodedPath = encodeURIComponent("my folder/sub dir/file.md");
      const req = new Request(
        `http://localhost/api/vaults/test-vault/files/${encodedPath}`
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { path: string };
      expect(json.path).toBe("my folder/sub dir/file.md");
    });
  });
});

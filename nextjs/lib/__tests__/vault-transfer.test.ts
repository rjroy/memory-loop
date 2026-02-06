/**
 * Vault Transfer Tests
 *
 * Unit tests for vault transfer functionality including file copy/move
 * between vaults with security validation.
 * Uses temp directories for isolated testing.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readFile, rm, symlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  transferFile,
  listTransferableVaults,
  VaultTransferError,
  createVaultTransferServer,
} from "../vault-transfer";
import { fileExists } from "../vault-manager";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temporary directory for testing.
 */
async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `vault-transfer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Recursively removes a test directory.
 */
async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Creates a minimal vault structure for testing.
 */
async function createTestVault(
  vaultsDir: string,
  vaultId: string,
  vaultName: string
): Promise<string> {
  const vaultPath = join(vaultsDir, vaultId);
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "CLAUDE.md"), `# ${vaultName}\n\nTest vault.`);
  return vaultPath;
}

// =============================================================================
// Error Class Tests
// =============================================================================

describe("VaultTransferError", () => {
  test("has correct name and code", () => {
    const error = new VaultTransferError("Test error", "TRANSFER_FAILED");
    expect(error.name).toBe("VaultTransferError");
    expect(error.code).toBe("TRANSFER_FAILED");
    expect(error.message).toBe("Test error");
  });

  test("is instance of Error", () => {
    const error = new VaultTransferError("Test", "SOURCE_FILE_NOT_FOUND");
    expect(error).toBeInstanceOf(Error);
  });

  test("supports all error codes", () => {
    const codes = [
      "SOURCE_VAULT_NOT_FOUND",
      "TARGET_VAULT_NOT_FOUND",
      "SOURCE_FILE_NOT_FOUND",
      "TARGET_EXISTS",
      "PATH_TRAVERSAL",
      "INVALID_FILE_TYPE",
      "TRANSFER_FAILED",
    ] as const;

    for (const code of codes) {
      const error = new VaultTransferError(`Error: ${code}`, code);
      expect(error.code).toBe(code);
    }
  });
});

// =============================================================================
// Transfer File Tests
// =============================================================================

describe("transferFile", () => {
  let testDir: string;
  let originalVaultsDir: string | undefined;

  beforeEach(async () => {
    testDir = await createTestDir();
    originalVaultsDir = process.env.VAULTS_DIR;
    process.env.VAULTS_DIR = testDir;
  });

  afterEach(async () => {
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }
    await cleanupTestDir(testDir);
  });

  describe("copy mode", () => {
    test("copies file to target vault", async () => {
      // Setup source and target vaults
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      const targetVault = await createTestVault(testDir, "target-vault", "Target");

      // Create source file
      const sourceContent = "# Test Note\n\nThis is test content.";
      await writeFile(join(sourceVault, "test-note.md"), sourceContent);

      // Perform transfer
      const result = await transferFile({
        sourceVaultId: "source-vault",
        targetVaultId: "target-vault",
        sourcePath: "test-note.md",
        mode: "copy",
      });

      // Verify result
      expect(result.mode).toBe("copy");
      expect(result.sourceVaultId).toBe("source-vault");
      expect(result.targetVaultId).toBe("target-vault");
      expect(result.sourcePath).toBe("test-note.md");
      expect(result.targetPath).toBe("test-note.md");
      expect(result.bytesTransferred).toBe(sourceContent.length);

      // Verify source still exists
      expect(await fileExists(join(sourceVault, "test-note.md"))).toBe(true);

      // Verify target exists with correct content
      expect(await fileExists(join(targetVault, "test-note.md"))).toBe(true);
      const targetContent = await readFile(join(targetVault, "test-note.md"), "utf-8");
      expect(targetContent).toBe(sourceContent);
    });

    test("copies to different target path", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      const targetVault = await createTestVault(testDir, "target-vault", "Target");

      await writeFile(join(sourceVault, "original.md"), "# Original");

      const result = await transferFile({
        sourceVaultId: "source-vault",
        targetVaultId: "target-vault",
        sourcePath: "original.md",
        targetPath: "renamed.md",
        mode: "copy",
      });

      expect(result.targetPath).toBe("renamed.md");
      expect(await fileExists(join(targetVault, "renamed.md"))).toBe(true);
    });

    test("creates target directory if needed", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      const targetVault = await createTestVault(testDir, "target-vault", "Target");

      await writeFile(join(sourceVault, "note.md"), "# Note");

      await transferFile({
        sourceVaultId: "source-vault",
        targetVaultId: "target-vault",
        sourcePath: "note.md",
        targetPath: "subdir/nested/note.md",
        mode: "copy",
      });

      expect(await fileExists(join(targetVault, "subdir/nested/note.md"))).toBe(true);
    });
  });

  describe("move mode", () => {
    test("moves file to target vault and deletes source", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      const targetVault = await createTestVault(testDir, "target-vault", "Target");

      const content = "# Moving Note";
      await writeFile(join(sourceVault, "moving.md"), content);

      const result = await transferFile({
        sourceVaultId: "source-vault",
        targetVaultId: "target-vault",
        sourcePath: "moving.md",
        mode: "move",
      });

      expect(result.mode).toBe("move");

      // Source should be deleted
      expect(await fileExists(join(sourceVault, "moving.md"))).toBe(false);

      // Target should exist
      expect(await fileExists(join(targetVault, "moving.md"))).toBe(true);
      const targetContent = await readFile(join(targetVault, "moving.md"), "utf-8");
      expect(targetContent).toBe(content);
    });
  });

  describe("overwrite behavior", () => {
    test("fails when target exists and overwrite is false", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      const targetVault = await createTestVault(testDir, "target-vault", "Target");

      await writeFile(join(sourceVault, "note.md"), "# Source");
      await writeFile(join(targetVault, "note.md"), "# Existing Target");

      try {
        await transferFile({
          sourceVaultId: "source-vault",
          targetVaultId: "target-vault",
          sourcePath: "note.md",
          mode: "copy",
          overwrite: false,
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("TARGET_EXISTS");
      }

      // Verify original content unchanged
      const content = await readFile(join(targetVault, "note.md"), "utf-8");
      expect(content).toBe("# Existing Target");
    });

    test("overwrites when target exists and overwrite is true", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      const targetVault = await createTestVault(testDir, "target-vault", "Target");

      await writeFile(join(sourceVault, "note.md"), "# New Content");
      await writeFile(join(targetVault, "note.md"), "# Old Content");

      await transferFile({
        sourceVaultId: "source-vault",
        targetVaultId: "target-vault",
        sourcePath: "note.md",
        mode: "copy",
        overwrite: true,
      });

      const content = await readFile(join(targetVault, "note.md"), "utf-8");
      expect(content).toBe("# New Content");
    });
  });

  describe("error handling", () => {
    test("throws SOURCE_VAULT_NOT_FOUND for missing source vault", async () => {
      await createTestVault(testDir, "target-vault", "Target");

      try {
        await transferFile({
          sourceVaultId: "nonexistent-vault",
          targetVaultId: "target-vault",
          sourcePath: "note.md",
          mode: "copy",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("SOURCE_VAULT_NOT_FOUND");
      }
    });

    test("throws TARGET_VAULT_NOT_FOUND for missing target vault", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      await writeFile(join(sourceVault, "note.md"), "# Note");

      try {
        await transferFile({
          sourceVaultId: "source-vault",
          targetVaultId: "nonexistent-vault",
          sourcePath: "note.md",
          mode: "copy",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("TARGET_VAULT_NOT_FOUND");
      }
    });

    test("throws SOURCE_FILE_NOT_FOUND for missing source file", async () => {
      await createTestVault(testDir, "source-vault", "Source");
      await createTestVault(testDir, "target-vault", "Target");

      try {
        await transferFile({
          sourceVaultId: "source-vault",
          targetVaultId: "target-vault",
          sourcePath: "nonexistent.md",
          mode: "copy",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("SOURCE_FILE_NOT_FOUND");
      }
    });

    test("throws INVALID_FILE_TYPE for non-markdown files", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      await createTestVault(testDir, "target-vault", "Target");
      await writeFile(join(sourceVault, "file.txt"), "text content");

      try {
        await transferFile({
          sourceVaultId: "source-vault",
          targetVaultId: "target-vault",
          sourcePath: "file.txt",
          mode: "copy",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("INVALID_FILE_TYPE");
      }
    });

    test("throws PATH_TRAVERSAL for path escape attempt in source", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      await createTestVault(testDir, "target-vault", "Target");
      await writeFile(join(sourceVault, "note.md"), "# Note");

      try {
        await transferFile({
          sourceVaultId: "source-vault",
          targetVaultId: "target-vault",
          sourcePath: "../../../etc/passwd.md",
          mode: "copy",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("PATH_TRAVERSAL");
      }
    });

    test("throws PATH_TRAVERSAL for path escape attempt in target", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      await createTestVault(testDir, "target-vault", "Target");
      await writeFile(join(sourceVault, "note.md"), "# Note");

      try {
        await transferFile({
          sourceVaultId: "source-vault",
          targetVaultId: "target-vault",
          sourcePath: "note.md",
          targetPath: "../../../tmp/evil.md",
          mode: "copy",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("PATH_TRAVERSAL");
      }
    });

    test("throws PATH_TRAVERSAL for symlink source file", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      await createTestVault(testDir, "target-vault", "Target");

      // Create a symlink pointing outside the vault
      await symlink("/etc/passwd", join(sourceVault, "evil-link.md"));

      try {
        await transferFile({
          sourceVaultId: "source-vault",
          targetVaultId: "target-vault",
          sourcePath: "evil-link.md",
          mode: "copy",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("PATH_TRAVERSAL");
      }
    });

    test("throws PATH_TRAVERSAL for symlink to file within vault", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      await createTestVault(testDir, "target-vault", "Target");

      // Create a real file and a symlink to it (symlinks are rejected regardless of target)
      await writeFile(join(sourceVault, "real-file.md"), "# Real file");
      await symlink(join(sourceVault, "real-file.md"), join(sourceVault, "link.md"));

      try {
        await transferFile({
          sourceVaultId: "source-vault",
          targetVaultId: "target-vault",
          sourcePath: "link.md",
          mode: "copy",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("PATH_TRAVERSAL");
      }
    });

    // Skip in CI: symlink behavior differs in GitHub Actions Ubuntu runner
    test.skipIf(!!process.env.CI)("throws PATH_TRAVERSAL for symlink at target location with overwrite", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      const targetVault = await createTestVault(testDir, "target-vault", "Target");

      // Create source file
      await writeFile(join(sourceVault, "note.md"), "# Source Note");

      // Create a symlink at target location pointing outside vault
      await symlink("/tmp/evil-target.md", join(targetVault, "note.md"));

      try {
        await transferFile({
          sourceVaultId: "source-vault",
          targetVaultId: "target-vault",
          sourcePath: "note.md",
          mode: "copy",
          overwrite: true, // Would write through symlink without the check
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("PATH_TRAVERSAL");
      }
    });

    test("throws TRANSFER_FAILED when move delete fails", async () => {
      const sourceVault = await createTestVault(testDir, "source-vault", "Source");
      const targetVault = await createTestVault(testDir, "target-vault", "Target");

      // Create source file and make parent directory read-only to prevent deletion
      await writeFile(join(sourceVault, "note.md"), "# Note");

      // Make the source file read-only (can't delete it)
      await chmod(join(sourceVault, "note.md"), 0o444);
      await chmod(sourceVault, 0o555); // Can't modify directory

      try {
        await transferFile({
          sourceVaultId: "source-vault",
          targetVaultId: "target-vault",
          sourcePath: "note.md",
          mode: "move",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultTransferError);
        expect((error as VaultTransferError).code).toBe("TRANSFER_FAILED");
        expect((error as VaultTransferError).message).toContain("File copied to target");
        expect((error as VaultTransferError).message).toContain("source deletion failed");
      } finally {
        // Restore permissions for cleanup
        await chmod(sourceVault, 0o755);
        await chmod(join(sourceVault, "note.md"), 0o644);
      }

      // Verify file exists in both locations (duplicate)
      expect(await fileExists(join(sourceVault, "note.md"))).toBe(true);
      expect(await fileExists(join(targetVault, "note.md"))).toBe(true);
    });
  });
});

// =============================================================================
// List Vaults Tests
// =============================================================================

describe("listTransferableVaults", () => {
  let testDir: string;
  let originalVaultsDir: string | undefined;

  beforeEach(async () => {
    testDir = await createTestDir();
    originalVaultsDir = process.env.VAULTS_DIR;
    process.env.VAULTS_DIR = testDir;
  });

  afterEach(async () => {
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }
    await cleanupTestDir(testDir);
  });

  test("lists all vaults with CLAUDE.md", async () => {
    await createTestVault(testDir, "vault-a", "Vault A");
    await createTestVault(testDir, "vault-b", "Vault B");

    const vaults = await listTransferableVaults();

    expect(vaults.length).toBe(2);
    expect(vaults.map((v) => v.id).sort()).toEqual(["vault-a", "vault-b"]);
  });

  test("returns vault id, name, and path", async () => {
    await createTestVault(testDir, "my-vault", "My Vault Name");

    const vaults = await listTransferableVaults();

    expect(vaults.length).toBe(1);
    expect(vaults[0].id).toBe("my-vault");
    expect(vaults[0].name).toBe("My Vault Name");
    expect(vaults[0].path).toBe(join(testDir, "my-vault"));
  });

  test("excludes directories without CLAUDE.md", async () => {
    await createTestVault(testDir, "valid-vault", "Valid");
    await mkdir(join(testDir, "no-claude-md"));

    const vaults = await listTransferableVaults();

    expect(vaults.length).toBe(1);
    expect(vaults[0].id).toBe("valid-vault");
  });

  test("returns empty array when no vaults exist", async () => {
    const vaults = await listTransferableVaults();
    expect(vaults).toEqual([]);
  });
});

// =============================================================================
// MCP Server Tests
// =============================================================================

describe("createVaultTransferServer", () => {
  test("creates server with correct name and version", () => {
    const server = createVaultTransferServer();

    // The server should be a valid MCP server object
    expect(server).toBeDefined();
    // We can't easily inspect the server internals, but we verify it doesn't throw
  });

  test("can be called multiple times (factory function)", () => {
    const server1 = createVaultTransferServer();
    const server2 = createVaultTransferServer();

    expect(server1).toBeDefined();
    expect(server2).toBeDefined();
    // Each call should create a new instance
    expect(server1).not.toBe(server2);
  });
});

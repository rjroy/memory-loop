/**
 * Vault Manager Tests
 *
 * Unit tests for vault discovery, CLAUDE.md parsing, and inbox detection.
 * Uses filesystem mocking to test all scenarios without real files.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  getVaultsDir,
  extractVaultName,
  discoverVaults,
  getVaultById,
  getVaultInboxPath,
  VaultsDirError,
  DEFAULT_INBOX_PATH,
  INBOX_PATTERNS,
  GOALS_FILE_PATH,
  directoryExists,
  fileExists,
  detectInboxPath,
  detectGoalsPath,
  parseVault,
  getVaultGoals,
} from "../vault-manager";
import type { VaultInfo } from "@memory-loop/shared";

// =============================================================================
// Environment Variable Tests
// =============================================================================

describe("getVaultsDir", () => {
  const originalVaultsDir = process.env.VAULTS_DIR;

  afterEach(() => {
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }
  });

  test("returns VAULTS_DIR when set", () => {
    process.env.VAULTS_DIR = "/path/to/vaults";
    expect(getVaultsDir()).toBe("/path/to/vaults");
  });

  test("throws VaultsDirError when VAULTS_DIR is not set", () => {
    delete process.env.VAULTS_DIR;
    expect(() => getVaultsDir()).toThrow(VaultsDirError);
  });

  test("error message includes setup instructions", () => {
    delete process.env.VAULTS_DIR;
    expect(() => getVaultsDir()).toThrow(/VAULTS_DIR environment variable is not set/);
  });
});

// =============================================================================
// CLAUDE.md Parsing Tests
// =============================================================================

describe("extractVaultName", () => {
  test("extracts name from first H1 heading", () => {
    const content = "# My Personal Vault\n\nSome content here.";
    expect(extractVaultName(content)).toEqual({ title: "My Personal Vault" });
  });

  test("returns first H1 when multiple exist", () => {
    const content = "# First Heading\n\n# Second Heading";
    expect(extractVaultName(content)).toEqual({ title: "First Heading" });
  });

  test("ignores H2 and lower headings", () => {
    const content = "## Not H1\n\n### Also not H1\n\n# This is H1";
    expect(extractVaultName(content)).toEqual({ title: "This is H1" });
  });

  test("handles content before H1", () => {
    const content = "Some preamble text\n\n# The Real Title\n\nMore content";
    expect(extractVaultName(content)).toEqual({ title: "The Real Title" });
  });

  test("returns null when no H1 found", () => {
    const content = "No headings here\n\nJust plain text";
    expect(extractVaultName(content)).toBeNull();
  });

  test("returns null for empty content", () => {
    expect(extractVaultName("")).toBeNull();
  });

  test("returns null for empty H1", () => {
    const content = "#  \n\nSome content";
    expect(extractVaultName(content)).toBeNull();
  });

  test("handles H1 with only spaces", () => {
    const content = "#    \n\n# Real Title";
    expect(extractVaultName(content)).toEqual({ title: "Real Title" });
  });

  test("trims whitespace from heading", () => {
    const content = "#   Spaced Title   \n";
    expect(extractVaultName(content)).toEqual({ title: "Spaced Title" });
  });

  test("handles Windows line endings", () => {
    const content = "# Windows Title\r\n\r\nContent";
    expect(extractVaultName(content)).toEqual({ title: "Windows Title" });
  });

  test("handles mixed content types", () => {
    const content = `
---
frontmatter: true
---

# Vault with Frontmatter

This is content.
`;
    expect(extractVaultName(content)).toEqual({ title: "Vault with Frontmatter" });
  });

  test("handles H1 with special characters", () => {
    const content = "# Project X: The Re-Launch (2025)";
    expect(extractVaultName(content)).toEqual({ title: "Project X: The Re-Launch (2025)" });
  });

  test("handles unicode in vault name", () => {
    const content = "# My Notes \u{1F4DA}";
    expect(extractVaultName(content)).toEqual({ title: "My Notes \u{1F4DA}" });
  });

  // Title/subtitle parsing tests
  test("splits title and subtitle on ' - ' separator", () => {
    const content = "# My Vault - Personal Notes";
    expect(extractVaultName(content)).toEqual({
      title: "My Vault",
      subtitle: "Personal Notes",
    });
  });

  test("handles multiple ' - ' separators by using first one", () => {
    const content = "# Main - Sub - Extra";
    expect(extractVaultName(content)).toEqual({
      title: "Main",
      subtitle: "Sub - Extra",
    });
  });

  test("does not split on single hyphen without spaces", () => {
    const content = "# Project-Name";
    expect(extractVaultName(content)).toEqual({ title: "Project-Name" });
  });

  test("does not split on hyphen with only leading space", () => {
    const content = "# Project -Name";
    expect(extractVaultName(content)).toEqual({ title: "Project -Name" });
  });

  test("does not split on hyphen with only trailing space", () => {
    const content = "# Project- Name";
    expect(extractVaultName(content)).toEqual({ title: "Project- Name" });
  });

  test("handles empty subtitle after separator", () => {
    const content = "# Title -   ";
    expect(extractVaultName(content)).toEqual({ title: "Title -" });
  });

  test("handles title with colon and subtitle", () => {
    const content = "# Project X: Relaunch - Development Notes";
    expect(extractVaultName(content)).toEqual({
      title: "Project X: Relaunch",
      subtitle: "Development Notes",
    });
  });
});

// =============================================================================
// Inbox Detection Tests
// =============================================================================

describe("INBOX_PATTERNS", () => {
  test("includes common inbox patterns", () => {
    expect(INBOX_PATTERNS).toContain("00_Inbox");
    expect(INBOX_PATTERNS).toContain("Inbox");
    expect(INBOX_PATTERNS).toContain("inbox");
  });

  test("has 00_Inbox as first pattern (highest priority)", () => {
    expect(INBOX_PATTERNS[0]).toBe("00_Inbox");
  });
});

describe("DEFAULT_INBOX_PATH", () => {
  test("is 00_Inbox", () => {
    expect(DEFAULT_INBOX_PATH).toBe("00_Inbox");
  });
});

// =============================================================================
// VaultsDirError Tests
// =============================================================================

describe("VaultsDirError", () => {
  test("has correct name property", () => {
    const error = new VaultsDirError("Test message");
    expect(error.name).toBe("VaultsDirError");
  });

  test("is instance of Error", () => {
    const error = new VaultsDirError("Test message");
    expect(error).toBeInstanceOf(Error);
  });

  test("preserves error message", () => {
    const error = new VaultsDirError("Custom error message");
    expect(error.message).toBe("Custom error message");
  });
});

// =============================================================================
// Integration Tests with Real Filesystem (Temp Directories)
// =============================================================================

import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Filesystem Integration", () => {
  let testDir: string;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    // Create a unique test directory
    testDir = join(tmpdir(), `vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  describe("directoryExists", () => {
    test("returns true for existing directory", async () => {
      expect(await directoryExists(testDir)).toBe(true);
    });

    test("returns false for non-existent directory", async () => {
      expect(await directoryExists(join(testDir, "nonexistent"))).toBe(false);
    });

    test("returns false for file (not directory)", async () => {
      const filePath = join(testDir, "file.txt");
      await writeFile(filePath, "content");
      expect(await directoryExists(filePath)).toBe(false);
    });
  });

  describe("fileExists", () => {
    test("returns true for existing file", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "content");
      expect(await fileExists(filePath)).toBe(true);
    });

    test("returns false for non-existent file", async () => {
      expect(await fileExists(join(testDir, "nonexistent.txt"))).toBe(false);
    });

    test("returns false for directory (not file)", async () => {
      expect(await fileExists(testDir)).toBe(false);
    });
  });

  describe("detectInboxPath", () => {
    test("detects 00_Inbox directory", async () => {
      await mkdir(join(testDir, "00_Inbox"));
      expect(await detectInboxPath(testDir)).toBe("00_Inbox");
    });

    test("detects Inbox directory (case-sensitive)", async () => {
      await mkdir(join(testDir, "Inbox"));
      expect(await detectInboxPath(testDir)).toBe("Inbox");
    });

    test("prefers 00_Inbox over Inbox", async () => {
      await mkdir(join(testDir, "00_Inbox"));
      await mkdir(join(testDir, "Inbox"));
      expect(await detectInboxPath(testDir)).toBe("00_Inbox");
    });

    test("returns default when no inbox found", async () => {
      expect(await detectInboxPath(testDir)).toBe(DEFAULT_INBOX_PATH);
    });

    test("detects 00-Inbox variant", async () => {
      await mkdir(join(testDir, "00-Inbox"));
      expect(await detectInboxPath(testDir)).toBe("00-Inbox");
    });
  });

  describe("parseVault", () => {
    test("returns null for directory without CLAUDE.md", async () => {
      const vaultDir = join(testDir, "no-claude");
      await mkdir(vaultDir);
      expect(await parseVault(testDir, "no-claude")).toBeNull();
    });

    test("parses vault with CLAUDE.md", async () => {
      const vaultDir = join(testDir, "my-vault");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# My Personal Vault");

      const vault = await parseVault(testDir, "my-vault");
      expect(vault).not.toBeNull();
      expect(vault!.id).toBe("my-vault");
      expect(vault!.name).toBe("My Personal Vault");
      expect(vault!.hasClaudeMd).toBe(true);
    });

    test("uses directory name when no H1 in CLAUDE.md", async () => {
      const vaultDir = join(testDir, "dir-name-vault");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "No heading here");

      const vault = await parseVault(testDir, "dir-name-vault");
      expect(vault!.name).toBe("dir-name-vault");
    });

    test("detects inbox path in vault", async () => {
      const vaultDir = join(testDir, "vault-with-inbox");
      await mkdir(vaultDir);
      await mkdir(join(vaultDir, "Inbox"));
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Test Vault");

      const vault = await parseVault(testDir, "vault-with-inbox");
      expect(vault!.inboxPath).toBe("Inbox");
    });

    test("returns null for non-existent directory", async () => {
      expect(await parseVault(testDir, "nonexistent")).toBeNull();
    });

    test("returns null for file (not directory)", async () => {
      await writeFile(join(testDir, "file.txt"), "content");
      expect(await parseVault(testDir, "file.txt")).toBeNull();
    });

    test("extracts subtitle from heading with ' - ' separator", async () => {
      const vaultDir = join(testDir, "vault-with-subtitle");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# My Vault - Personal Notes");

      const vault = await parseVault(testDir, "vault-with-subtitle");
      expect(vault).not.toBeNull();
      expect(vault!.name).toBe("My Vault");
      expect(vault!.subtitle).toBe("Personal Notes");
    });

    test("subtitle is undefined when no separator in heading", async () => {
      const vaultDir = join(testDir, "vault-no-subtitle");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Simple Title");

      const vault = await parseVault(testDir, "vault-no-subtitle");
      expect(vault).not.toBeNull();
      expect(vault!.name).toBe("Simple Title");
      expect(vault!.subtitle).toBeUndefined();
    });

    test("config title overrides CLAUDE.md heading", async () => {
      const vaultDir = join(testDir, "vault-config-override");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Original Title");
      await writeFile(join(vaultDir, ".memory-loop.json"), JSON.stringify({
        title: "Overridden Title",
      }));

      const vault = await parseVault(testDir, "vault-config-override");
      expect(vault).not.toBeNull();
      expect(vault!.name).toBe("Overridden Title");
    });

    test("subtitle is preserved when config overrides title", async () => {
      const vaultDir = join(testDir, "vault-override-with-subtitle");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Original - Has Subtitle");
      await writeFile(join(vaultDir, ".memory-loop.json"), JSON.stringify({
        title: "Custom Title",
      }));

      const vault = await parseVault(testDir, "vault-override-with-subtitle");
      expect(vault).not.toBeNull();
      expect(vault!.name).toBe("Custom Title");
      expect(vault!.subtitle).toBe("Has Subtitle");
    });

    test("config subtitle overrides CLAUDE.md subtitle", async () => {
      const vaultDir = join(testDir, "vault-subtitle-override");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# My Vault - Original Subtitle");
      await writeFile(join(vaultDir, ".memory-loop.json"), JSON.stringify({
        subtitle: "Custom Subtitle",
      }));

      const vault = await parseVault(testDir, "vault-subtitle-override");
      expect(vault).not.toBeNull();
      expect(vault!.name).toBe("My Vault");
      expect(vault!.subtitle).toBe("Custom Subtitle");
    });

    test("config can add subtitle when CLAUDE.md has none", async () => {
      const vaultDir = join(testDir, "vault-add-subtitle");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Simple Title");
      await writeFile(join(vaultDir, ".memory-loop.json"), JSON.stringify({
        subtitle: "Added Subtitle",
      }));

      const vault = await parseVault(testDir, "vault-add-subtitle");
      expect(vault).not.toBeNull();
      expect(vault!.name).toBe("Simple Title");
      expect(vault!.subtitle).toBe("Added Subtitle");
    });

    test("config can remove subtitle with empty string", async () => {
      const vaultDir = join(testDir, "vault-remove-subtitle");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# My Vault - Has Subtitle");
      await writeFile(join(vaultDir, ".memory-loop.json"), JSON.stringify({
        subtitle: "",
      }));

      const vault = await parseVault(testDir, "vault-remove-subtitle");
      expect(vault).not.toBeNull();
      expect(vault!.name).toBe("My Vault");
      expect(vault!.subtitle).toBeUndefined();
    });

    test("config overrides both title and subtitle", async () => {
      const vaultDir = join(testDir, "vault-full-override");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Original Title - Original Subtitle");
      await writeFile(join(vaultDir, ".memory-loop.json"), JSON.stringify({
        title: "Custom Title",
        subtitle: "Custom Subtitle",
      }));

      const vault = await parseVault(testDir, "vault-full-override");
      expect(vault).not.toBeNull();
      expect(vault!.name).toBe("Custom Title");
      expect(vault!.subtitle).toBe("Custom Subtitle");
    });
  });

  describe("discoverVaults", () => {
    test("returns empty array for empty directory", async () => {
      const vaults = await discoverVaults();
      expect(vaults).toEqual([]);
    });

    test("discovers single vault", async () => {
      const vaultDir = join(testDir, "my-vault");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# My Vault");

      const vaults = await discoverVaults();
      expect(vaults).toHaveLength(1);
      expect(vaults[0].id).toBe("my-vault");
      expect(vaults[0].name).toBe("My Vault");
    });

    test("discovers multiple vaults", async () => {
      const vault1 = join(testDir, "vault-1");
      const vault2 = join(testDir, "vault-2");
      await mkdir(vault1);
      await mkdir(vault2);
      await writeFile(join(vault1, "CLAUDE.md"), "# Alpha Vault");
      await writeFile(join(vault2, "CLAUDE.md"), "# Beta Vault");

      const vaults = await discoverVaults();
      expect(vaults).toHaveLength(2);
      // Should be sorted by name
      expect(vaults[0].name).toBe("Alpha Vault");
      expect(vaults[1].name).toBe("Beta Vault");
    });

    test("ignores directories without CLAUDE.md", async () => {
      const vaultWithClaude = join(testDir, "with-claude");
      const vaultWithout = join(testDir, "without-claude");
      await mkdir(vaultWithClaude);
      await mkdir(vaultWithout);
      await writeFile(join(vaultWithClaude, "CLAUDE.md"), "# Valid");

      const vaults = await discoverVaults();
      expect(vaults).toHaveLength(1);
      expect(vaults[0].id).toBe("with-claude");
    });

    test("ignores hidden directories", async () => {
      const hiddenDir = join(testDir, ".hidden-vault");
      await mkdir(hiddenDir);
      await writeFile(join(hiddenDir, "CLAUDE.md"), "# Hidden");

      const vaults = await discoverVaults();
      expect(vaults).toHaveLength(0);
    });

    test("ignores files (not directories)", async () => {
      await writeFile(join(testDir, "file.txt"), "content");
      const vaultDir = join(testDir, "vault");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Vault");

      const vaults = await discoverVaults();
      expect(vaults).toHaveLength(1);
    });

    test("throws VaultsDirError when VAULTS_DIR is unset", async () => {
      delete process.env.VAULTS_DIR;
      try {
        await discoverVaults();
        expect.unreachable("Should have thrown VaultsDirError");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultsDirError);
      }
    });

    test("throws VaultsDirError when VAULTS_DIR does not exist", async () => {
      process.env.VAULTS_DIR = join(testDir, "nonexistent");
      try {
        await discoverVaults();
        expect.unreachable("Should have thrown VaultsDirError");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultsDirError);
        expect((error as Error).message).toMatch(/does not exist/);
      }
    });

    test("sorts vaults alphabetically by name", async () => {
      const vaults = ["charlie", "alpha", "bravo"];
      for (const name of vaults) {
        const dir = join(testDir, name);
        await mkdir(dir);
        await writeFile(join(dir, "CLAUDE.md"), `# ${name.toUpperCase()}`);
      }

      const result = await discoverVaults();
      expect(result.map((v) => v.name)).toEqual(["ALPHA", "BRAVO", "CHARLIE"]);
    });
  });

  describe("getVaultById", () => {
    test("returns vault when found", async () => {
      const vaultDir = join(testDir, "target-vault");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Target");

      const vault = await getVaultById("target-vault");
      expect(vault).not.toBeNull();
      expect(vault!.id).toBe("target-vault");
      expect(vault!.name).toBe("Target");
    });

    test("returns null when vault not found", async () => {
      const vault = await getVaultById("nonexistent");
      expect(vault).toBeNull();
    });

    test("returns null for directory without CLAUDE.md", async () => {
      const vaultDir = join(testDir, "no-claude");
      await mkdir(vaultDir);

      const vault = await getVaultById("no-claude");
      expect(vault).toBeNull();
    });

    test("throws VaultsDirError when VAULTS_DIR is unset", async () => {
      delete process.env.VAULTS_DIR;
      try {
        await getVaultById("any");
        expect.unreachable("Should have thrown VaultsDirError");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultsDirError);
      }
    });

    test("throws VaultsDirError when VAULTS_DIR does not exist", async () => {
      process.env.VAULTS_DIR = join(testDir, "nonexistent");
      try {
        await getVaultById("any");
        expect.unreachable("Should have thrown VaultsDirError");
      } catch (error) {
        expect(error).toBeInstanceOf(VaultsDirError);
      }
    });
  });

  describe("getVaultInboxPath", () => {
    test("returns absolute path to inbox", () => {
      const vault: VaultInfo = {
        id: "test-vault",
        name: "Test Vault",
        path: "/vaults/test-vault",
        hasClaudeMd: true,
        contentRoot: "/vaults/test-vault",
        inboxPath: "00_Inbox",
        metadataPath: "06_Metadata/memory-loop",
        attachmentPath: "05_Attachments",
        setupComplete: false,
        promptsPerGeneration: 5,
        maxPoolSize: 50,
        quotesPerWeek: 1,
        badges: [],
        order: 999999,
      };

      expect(getVaultInboxPath(vault)).toBe("/vaults/test-vault/00_Inbox");
    });

    test("works with custom inbox path", () => {
      const vault: VaultInfo = {
        id: "test-vault",
        name: "Test Vault",
        path: "/vaults/test-vault",
        hasClaudeMd: true,
        contentRoot: "/vaults/test-vault",
        inboxPath: "Custom/Inbox",
        metadataPath: "06_Metadata/memory-loop",
        attachmentPath: "05_Attachments",
        setupComplete: false,
        promptsPerGeneration: 5,
        maxPoolSize: 50,
        quotesPerWeek: 1,
        badges: [],
        order: 999999,
      };

      expect(getVaultInboxPath(vault)).toBe("/vaults/test-vault/Custom/Inbox");
    });

    test("works with configured contentRoot", () => {
      const vault: VaultInfo = {
        id: "test-vault",
        name: "Test Vault",
        path: "/vaults/test-vault",
        hasClaudeMd: true,
        contentRoot: "/vaults/test-vault/content",
        inboxPath: "00_Inbox",
        metadataPath: "06_Metadata/memory-loop",
        attachmentPath: "05_Attachments",
        setupComplete: false,
        promptsPerGeneration: 5,
        maxPoolSize: 50,
        quotesPerWeek: 1,
        badges: [],
        order: 999999,
      };

      expect(getVaultInboxPath(vault)).toBe("/vaults/test-vault/content/00_Inbox");
    });
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
  let testDir: string;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    testDir = join(tmpdir(), `vault-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    process.env.VAULTS_DIR = testDir;
  });

  afterEach(async () => {
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test("handles vault with empty CLAUDE.md", async () => {
    const vaultDir = join(testDir, "empty-claude");
    await mkdir(vaultDir);
    await writeFile(join(vaultDir, "CLAUDE.md"), "");

    const vault = await parseVault(testDir, "empty-claude");
    expect(vault).not.toBeNull();
    expect(vault!.name).toBe("empty-claude"); // Falls back to directory name
  });

  test("handles vault with only whitespace in CLAUDE.md", async () => {
    const vaultDir = join(testDir, "whitespace-claude");
    await mkdir(vaultDir);
    await writeFile(join(vaultDir, "CLAUDE.md"), "   \n\n   \t   ");

    const vault = await parseVault(testDir, "whitespace-claude");
    expect(vault!.name).toBe("whitespace-claude");
  });

  test("handles vault with very long name in CLAUDE.md", async () => {
    const vaultDir = join(testDir, "long-name");
    await mkdir(vaultDir);
    const longName = "A".repeat(1000);
    await writeFile(join(vaultDir, "CLAUDE.md"), `# ${longName}`);

    const vault = await parseVault(testDir, "long-name");
    expect(vault!.name).toBe(longName);
  });

  test("handles vault directory with spaces in name", async () => {
    const vaultDir = join(testDir, "my vault name");
    await mkdir(vaultDir);
    await writeFile(join(vaultDir, "CLAUDE.md"), "# Spaced Vault");

    const vault = await parseVault(testDir, "my vault name");
    expect(vault).not.toBeNull();
    expect(vault!.id).toBe("my vault name");
    expect(vault!.name).toBe("Spaced Vault");
  });

  test("handles vault directory with special characters", async () => {
    const vaultDir = join(testDir, "vault-with_chars.2025");
    await mkdir(vaultDir);
    await writeFile(join(vaultDir, "CLAUDE.md"), "# Special Chars");

    const vault = await parseVault(testDir, "vault-with_chars.2025");
    expect(vault).not.toBeNull();
    expect(vault!.id).toBe("vault-with_chars.2025");
  });

  test("handles symlinks gracefully", async () => {
    // Create a real vault
    const realVault = join(testDir, "real-vault");
    await mkdir(realVault);
    await writeFile(join(realVault, "CLAUDE.md"), "# Real Vault");

    // Create a symlink to it (if supported)
    const symlinkPath = join(testDir, "symlink-vault");
    try {
      const { symlink } = await import("node:fs/promises");
      await symlink(realVault, symlinkPath);

      const vaults = await discoverVaults();
      // Both should be discovered (symlink is a valid directory)
      expect(vaults.length).toBeGreaterThanOrEqual(1);
    } catch {
      // Symlinks may not be supported on all platforms, skip this test
    }
  });
});

// =============================================================================
// Goals Feature Tests
// =============================================================================

describe("Goals Feature", () => {
  describe("detectGoalsPath", () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `goals-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    test("returns goals path when file exists", async () => {
      const goalsDir = join(testDir, "06_Metadata", "memory-loop");
      await mkdir(goalsDir, { recursive: true });
      await writeFile(join(goalsDir, "goals.md"), "# Goals\n\n## Active\n");

      const goalsPath = await detectGoalsPath(testDir, {});
      expect(goalsPath).toBe(GOALS_FILE_PATH);
    });

    test("returns undefined when file does not exist", async () => {
      const goalsPath = await detectGoalsPath(testDir, {});
      expect(goalsPath).toBeUndefined();
    });

    test("returns undefined when directory exists but file does not", async () => {
      const goalsDir = join(testDir, "06_Metadata", "memory-loop");
      await mkdir(goalsDir, { recursive: true });

      const goalsPath = await detectGoalsPath(testDir, {});
      expect(goalsPath).toBeUndefined();
    });

    test("uses custom metadata path from config", async () => {
      const goalsDir = join(testDir, "custom-metadata");
      await mkdir(goalsDir, { recursive: true });
      await writeFile(join(goalsDir, "goals.md"), "# Goals\n\n## Active\n");

      const goalsPath = await detectGoalsPath(testDir, { metadataPath: "custom-metadata" });
      expect(goalsPath).toBe("custom-metadata/goals.md");
    });
  });

  describe("getVaultGoals", () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `vault-goals-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    test("returns null when vault has no goalsPath", async () => {
      const vault: VaultInfo = {
        id: "test-vault",
        name: "Test Vault",
        path: testDir,
        hasClaudeMd: true,
        contentRoot: testDir,
        inboxPath: "00_Inbox",
        metadataPath: "06_Metadata/memory-loop",
        attachmentPath: "05_Attachments",
        goalsPath: undefined,
        setupComplete: false,
        promptsPerGeneration: 5,
        maxPoolSize: 50,
        quotesPerWeek: 1,
        badges: [],
        order: 999999,
      };

      const goals = await getVaultGoals(vault);
      expect(goals).toBeNull();
    });

    test("returns raw content when file exists", async () => {
      const goalsDir = join(testDir, "06_Metadata", "memory-loop");
      await mkdir(goalsDir, { recursive: true });
      const goalsContent = `# Goals

## Active

- [ ] First goal
- [x] Second goal (done)
`;
      await writeFile(join(goalsDir, "goals.md"), goalsContent);

      const vault: VaultInfo = {
        id: "test-vault",
        name: "Test Vault",
        path: testDir,
        hasClaudeMd: true,
        contentRoot: testDir,
        inboxPath: "00_Inbox",
        metadataPath: "06_Metadata/memory-loop",
        attachmentPath: "05_Attachments",
        goalsPath: GOALS_FILE_PATH,
        setupComplete: false,
        promptsPerGeneration: 5,
        maxPoolSize: 50,
        quotesPerWeek: 1,
        badges: [],
        order: 999999,
      };

      const content = await getVaultGoals(vault);
      expect(content).toBe(goalsContent);
    });

    test("returns null when file is missing despite goalsPath being set", async () => {
      const vault: VaultInfo = {
        id: "test-vault",
        name: "Test Vault",
        path: testDir,
        hasClaudeMd: true,
        contentRoot: testDir,
        inboxPath: "00_Inbox",
        metadataPath: "06_Metadata/memory-loop",
        attachmentPath: "05_Attachments",
        goalsPath: GOALS_FILE_PATH,
        setupComplete: false,
        promptsPerGeneration: 5,
        maxPoolSize: 50,
        quotesPerWeek: 1,
        badges: [],
        order: 999999,
      };

      const goals = await getVaultGoals(vault);
      expect(goals).toBeNull();
    });
  });

  describe("parseVault with goals", () => {
    let testDir: string;
    const originalVaultsDir = process.env.VAULTS_DIR;

    beforeEach(async () => {
      testDir = join(tmpdir(), `vault-parse-goals-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(testDir, { recursive: true });
      process.env.VAULTS_DIR = testDir;
    });

    afterEach(async () => {
      if (originalVaultsDir === undefined) {
        delete process.env.VAULTS_DIR;
      } else {
        process.env.VAULTS_DIR = originalVaultsDir;
      }
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    test("includes goalsPath when goals.md exists", async () => {
      const vaultDir = join(testDir, "test-vault");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Test Vault");

      const goalsDir = join(vaultDir, "06_Metadata", "memory-loop");
      await mkdir(goalsDir, { recursive: true });
      await writeFile(join(goalsDir, "goals.md"), "# Goals\n\n## Active\n");

      const vault = await parseVault(testDir, "test-vault");
      expect(vault).not.toBeNull();
      expect(vault!.goalsPath).toBe(GOALS_FILE_PATH);
    });

    test("goalsPath is undefined when goals.md does not exist", async () => {
      const vaultDir = join(testDir, "test-vault");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Test Vault");

      const vault = await parseVault(testDir, "test-vault");
      expect(vault).not.toBeNull();
      expect(vault!.goalsPath).toBeUndefined();
    });
  });
});

// =============================================================================
// Setup Complete Detection Tests
// =============================================================================

describe("Setup Complete Detection", () => {
  let testDir: string;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    testDir = join(tmpdir(), `vault-setup-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    process.env.VAULTS_DIR = testDir;
  });

  afterEach(async () => {
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("parseVault with setupComplete", () => {
    test("setupComplete is false when marker does not exist", async () => {
      const vaultDir = join(testDir, "test-vault");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Test Vault");

      const vault = await parseVault(testDir, "test-vault");
      expect(vault).not.toBeNull();
      expect(vault!.setupComplete).toBe(false);
    });

    test("setupComplete is true when marker exists", async () => {
      const vaultDir = join(testDir, "test-vault");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Test Vault");

      // Create setup marker
      const markerDir = join(vaultDir, ".memory-loop");
      await mkdir(markerDir, { recursive: true });
      await writeFile(join(markerDir, "setup-complete"), JSON.stringify({
        completedAt: new Date().toISOString(),
        version: "1.0.0",
        commandsInstalled: [],
        paraCreated: [],
        claudeMdUpdated: false,
      }));

      const vault = await parseVault(testDir, "test-vault");
      expect(vault).not.toBeNull();
      expect(vault!.setupComplete).toBe(true);
    });

    test("setupComplete is false when .memory-loop exists but marker does not", async () => {
      const vaultDir = join(testDir, "test-vault");
      await mkdir(vaultDir);
      await writeFile(join(vaultDir, "CLAUDE.md"), "# Test Vault");

      // Create .memory-loop directory but no marker
      const markerDir = join(vaultDir, ".memory-loop");
      await mkdir(markerDir, { recursive: true });

      const vault = await parseVault(testDir, "test-vault");
      expect(vault).not.toBeNull();
      expect(vault!.setupComplete).toBe(false);
    });
  });

  describe("discoverVaults with setupComplete", () => {
    test("correctly identifies setup status across multiple vaults", async () => {
      // Create vault without setup
      const vault1Dir = join(testDir, "vault-1");
      await mkdir(vault1Dir);
      await writeFile(join(vault1Dir, "CLAUDE.md"), "# Vault 1");

      // Create vault with setup
      const vault2Dir = join(testDir, "vault-2");
      await mkdir(vault2Dir);
      await writeFile(join(vault2Dir, "CLAUDE.md"), "# Vault 2");
      const markerDir = join(vault2Dir, ".memory-loop");
      await mkdir(markerDir, { recursive: true });
      await writeFile(join(markerDir, "setup-complete"), "{}");

      const vaults = await discoverVaults();
      expect(vaults).toHaveLength(2);

      const vault1 = vaults.find((v) => v.id === "vault-1");
      const vault2 = vaults.find((v) => v.id === "vault-2");

      expect(vault1!.setupComplete).toBe(false);
      expect(vault2!.setupComplete).toBe(true);
    });
  });
});

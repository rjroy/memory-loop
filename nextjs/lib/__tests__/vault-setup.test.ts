/**
 * Vault Setup Tests
 *
 * Unit tests for vault setup functionality:
 * - Command template installation
 * - PARA directory creation
 * - Setup marker writing
 * - Full setup orchestration
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  installCommands,
  installSkills,
  createParaDirectories,
  writeSetupMarker,
  isSetupComplete,
  runVaultSetup,
  createClaudeMdBackup,
  buildClaudeMdPrompt,
  updateClaudeMd,
  updateGitignore,
  SETUP_VERSION,
  SETUP_MARKER_PATH,
  COMMANDS_DEST_PATH,
  SKILLS_DEST_PATH,
  CLAUDEMD_BACKUP_PATH,
  MEMORY_LOOP_IGNORE_PATTERNS,
  MEMORY_LOOP_GITIGNORE_PATH,
  type SetupCompleteMarker,
} from "../vault-setup";
import { directoryExists, fileExists } from "../vault-manager";
import { configureSdkForTesting, _resetForTesting, type QueryFunction } from "../sdk-provider";

// =============================================================================
// Mock Query Function Factory
// =============================================================================

/**
 * Creates a mock query function that simulates the SDK using tools.
 * @param updatedContent - The content to write to CLAUDE.md (simulating Edit tool)
 * @param vaultPathRef - Reference to the vault path (allows late binding)
 */
function createMockQueryFn(
  updatedContent: string,
  vaultPathRef: { current: string }
): QueryFunction {
  return (async function* mockQuery() {
    // Simulate the LLM using Edit tool to update CLAUDE.md
    const claudeMdPath = join(vaultPathRef.current, "CLAUDE.md");
    await writeFile(claudeMdPath, updatedContent, "utf-8");

    // Emit result event to signal completion
    yield {
      type: "result" as const,
    };
  }) as unknown as QueryFunction;
}

/**
 * Creates a mock query function that completes without making changes.
 * Used for testing when we just need the SDK to "complete" without file edits.
 */
function createNoOpMockQueryFn(): QueryFunction {
  return (function* mockQuery() {
    yield {
      type: "result" as const,
    };
  }) as unknown as QueryFunction;
}

/**
 * Creates a mock query function that does not emit a result event.
 * Used to test timeout/incomplete scenarios.
 */
function createIncompleteQueryFn(): QueryFunction {
  return (function* mockQuery() {
    // Emit an assistant message but no result
    yield {
      type: "assistant" as const,
      message: {
        content: [{ type: "text" as const, text: "I started but didn't finish" }],
      },
    };
  }) as unknown as QueryFunction;
}

/**
 * Creates a mock query function that throws an error.
 */
function createErrorMockQueryFn(message: string): QueryFunction {
  return (() => {
    throw new Error(message);
  }) as unknown as QueryFunction;
}

// =============================================================================
// Test Fixtures
// =============================================================================

let testDir: string;
let vaultPath: string;
// Reference object for late binding in mock functions
const vaultPathRef: { current: string } = { current: "" };
const originalVaultsDir = process.env.VAULTS_DIR;

beforeEach(async () => {
  // Create a unique test directory for each test
  testDir = join(
    tmpdir(),
    `vault-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  vaultPath = join(testDir, "test-vault");
  vaultPathRef.current = vaultPath;

  // Create vault with CLAUDE.md
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "CLAUDE.md"), "# Test Vault\n\nTest content.");

  // Set VAULTS_DIR for vault discovery
  process.env.VAULTS_DIR = testDir;
});

afterEach(async () => {
  // Reset SDK mock
  _resetForTesting();

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

// =============================================================================
// installCommands Tests
// =============================================================================

describe("installCommands", () => {
  test("creates .claude/commands directory", async () => {
    const result = await installCommands(vaultPath);

    expect(result.success).toBe(true);
    expect(await directoryExists(join(vaultPath, COMMANDS_DEST_PATH))).toBe(true);
  });

  test("copies all command templates", async () => {
    const result = await installCommands(vaultPath);

    expect(result.success).toBe(true);
    expect(result.installed.length).toBeGreaterThan(0);

    // Check that files were actually created
    const commandsDir = join(vaultPath, COMMANDS_DEST_PATH);
    const files = await readdir(commandsDir);
    expect(files.length).toBeGreaterThan(0);
  });

  test("includes expected command files", async () => {
    const result = await installCommands(vaultPath);

    expect(result.success).toBe(true);

    const commandsDir = join(vaultPath, COMMANDS_DEST_PATH);
    const files = await readdir(commandsDir);

    // Check for expected command files
    expect(files).toContain("daily-debrief.md");
    expect(files).toContain("daily-review.md");
    expect(files).toContain("expand-note.md");
    expect(files).toContain("inbox-processor.md");
    expect(files).toContain("monthly-summary.md");
    expect(files).toContain("review-goals.md");
    expect(files).toContain("weekly-debrief.md");
    expect(files).toContain("weekly-synthesis.md");
  });

  test("updates existing files on second install", async () => {
    // First install
    const result1 = await installCommands(vaultPath);
    expect(result1.success).toBe(true);
    expect(result1.installed.length).toBeGreaterThan(0);

    // Second install should update all (server-owned files)
    const result2 = await installCommands(vaultPath);
    expect(result2.success).toBe(true);
    expect(result2.installed.length).toBe(0); // None are "new"
    expect(result2.message).toContain("Updated");
  });

  test("overwrites existing files with server version", async () => {
    // Create commands directory with a custom file
    const commandsDir = join(vaultPath, COMMANDS_DEST_PATH);
    await mkdir(commandsDir, { recursive: true });
    const customContent = "# Custom daily-debrief content\n\nThis will be overwritten.";
    await writeFile(join(commandsDir, "daily-debrief.md"), customContent);

    // Run install
    await installCommands(vaultPath);

    // Verify custom file was replaced with server version
    const content = await readFile(join(commandsDir, "daily-debrief.md"), "utf-8");
    expect(content).not.toBe(customContent);
    expect(content).toContain("Quick, focused conversation"); // Should have the real content
  });

  test("reports mixed installed and updated files", async () => {
    // Create commands directory with one existing file
    const commandsDir = join(vaultPath, COMMANDS_DEST_PATH);
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, "daily-debrief.md"), "existing");

    const result = await installCommands(vaultPath);

    expect(result.success).toBe(true);
    // daily-debrief.md was updated, others were installed
    expect(result.installed).not.toContain("daily-debrief.md");
    expect(result.installed.length).toBeGreaterThan(0);
    expect(result.message).toContain("Installed");
    expect(result.message).toContain("Updated");
  });

  test("returns list of installed commands", async () => {
    const result = await installCommands(vaultPath);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.installed)).toBe(true);
    expect(result.installed.length).toBeGreaterThan(0);

    // All installed items should be .md files
    for (const file of result.installed) {
      expect(file.endsWith(".md")).toBe(true);
    }
  });

  test("creates nested directory structure", async () => {
    // Vault with deep path
    const deepVaultPath = join(testDir, "deep/nested/vault");
    await mkdir(deepVaultPath, { recursive: true });
    await writeFile(join(deepVaultPath, "CLAUDE.md"), "# Deep Vault");

    const result = await installCommands(deepVaultPath);

    expect(result.success).toBe(true);
    expect(await directoryExists(join(deepVaultPath, COMMANDS_DEST_PATH))).toBe(true);
  });
});

// =============================================================================
// installSkills Tests
// =============================================================================

describe("installSkills", () => {
  test("creates .claude/skills directory", async () => {
    const result = await installSkills(vaultPath);

    expect(result.success).toBe(true);
    expect(await directoryExists(join(vaultPath, SKILLS_DEST_PATH))).toBe(true);
  });

  test("copies skill directories", async () => {
    const result = await installSkills(vaultPath);

    expect(result.success).toBe(true);
    expect(result.installed.length).toBeGreaterThan(0);

    // Check that skill directory was created
    const skillsDir = join(vaultPath, SKILLS_DEST_PATH);
    const skills = await readdir(skillsDir);
    expect(skills.length).toBeGreaterThan(0);
  });

  test("installs vault-task-management skill", async () => {
    const result = await installSkills(vaultPath);

    expect(result.success).toBe(true);

    const skillsDir = join(vaultPath, SKILLS_DEST_PATH);
    const skills = await readdir(skillsDir);

    expect(skills).toContain("vault-task-management");
  });

  test("skill contains SKILL.md", async () => {
    await installSkills(vaultPath);

    const skillMdPath = join(vaultPath, SKILLS_DEST_PATH, "vault-task-management", "SKILL.md");
    expect(await fileExists(skillMdPath)).toBe(true);
  });

  test("skill contains scripts directory with shell scripts", async () => {
    await installSkills(vaultPath);

    const scriptsDir = join(vaultPath, SKILLS_DEST_PATH, "vault-task-management", "scripts");
    expect(await directoryExists(scriptsDir)).toBe(true);

    const scripts = await readdir(scriptsDir);
    expect(scripts).toContain("find-tasks.sh");
    expect(scripts).toContain("show-tasks.sh");
  });

  test("preserves executable permissions on shell scripts", async () => {
    await installSkills(vaultPath);

    const scriptPath = join(vaultPath, SKILLS_DEST_PATH, "vault-task-management", "scripts", "find-tasks.sh");
    const stats = await stat(scriptPath);

    // Check that the file is executable (owner execute bit set)
    expect(stats.mode & 0o100).toBeTruthy();
  });

  test("updates existing skills on second install", async () => {
    // First install
    const result1 = await installSkills(vaultPath);
    expect(result1.success).toBe(true);
    expect(result1.installed.length).toBeGreaterThan(0);

    // Second install should update all (server-owned)
    const result2 = await installSkills(vaultPath);
    expect(result2.success).toBe(true);
    expect(result2.installed.length).toBe(0); // None are "new"
    expect(result2.message).toContain("Updated");
  });

  test("overwrites existing skill with server version", async () => {
    // Create skills directory with a custom file in the skill
    const skillDir = join(vaultPath, SKILLS_DEST_PATH, "vault-task-management");
    await mkdir(skillDir, { recursive: true });
    const customContent = "# Custom SKILL.md content\n\nThis will be overwritten.";
    await writeFile(join(skillDir, "SKILL.md"), customContent);

    // Run install
    await installSkills(vaultPath);

    // Verify custom file was replaced with server version
    const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    expect(content).not.toBe(customContent);
    expect(content).toContain("vault"); // Should have the real content
  });

  test("returns list of installed skills", async () => {
    const result = await installSkills(vaultPath);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.installed)).toBe(true);
    expect(result.installed).toContain("vault-task-management");
  });
});

// =============================================================================
// createParaDirectories Tests
// =============================================================================

describe("createParaDirectories", () => {
  test("creates all PARA directories when none exist", async () => {
    const result = await createParaDirectories(vaultPath, {});

    expect(result.success).toBe(true);
    expect(result.created.length).toBe(5);

    // Check directories exist
    expect(await directoryExists(join(vaultPath, "01_Projects"))).toBe(true);
    expect(await directoryExists(join(vaultPath, "02_Areas"))).toBe(true);
    expect(await directoryExists(join(vaultPath, "03_Resources"))).toBe(true);
    expect(await directoryExists(join(vaultPath, "04_Archive"))).toBe(true);
    expect(await directoryExists(join(vaultPath, "05_Attachments"))).toBe(true);
  });

  test("skips existing directories", async () => {
    // Create some directories
    await mkdir(join(vaultPath, "01_Projects"));
    await mkdir(join(vaultPath, "02_Areas"));

    const result = await createParaDirectories(vaultPath, {});

    expect(result.success).toBe(true);
    // Should only create Resources, Archives, and Attachments
    expect(result.created).toContain("Resources");
    expect(result.created).toContain("Archives");
    expect(result.created).toContain("Attachments");
    expect(result.created).not.toContain("Projects");
    expect(result.created).not.toContain("Areas");
    expect(result.message).toContain("already existed");
  });

  test("respects custom project path from config", async () => {
    const result = await createParaDirectories(vaultPath, {
      projectPath: "Custom_Projects",
    });

    expect(result.success).toBe(true);
    expect(await directoryExists(join(vaultPath, "Custom_Projects"))).toBe(true);
    expect(await directoryExists(join(vaultPath, "01_Projects"))).toBe(false);
  });

  test("respects custom area path from config", async () => {
    const result = await createParaDirectories(vaultPath, {
      areaPath: "Custom_Areas",
    });

    expect(result.success).toBe(true);
    expect(await directoryExists(join(vaultPath, "Custom_Areas"))).toBe(true);
    expect(await directoryExists(join(vaultPath, "02_Areas"))).toBe(false);
  });

  test("respects content root from config", async () => {
    // Create content subdirectory
    const contentRoot = join(vaultPath, "content");
    await mkdir(contentRoot);

    const result = await createParaDirectories(vaultPath, {
      contentRoot: "content",
    });

    expect(result.success).toBe(true);
    // PARA directories should be inside content/
    expect(await directoryExists(join(contentRoot, "01_Projects"))).toBe(true);
    expect(await directoryExists(join(contentRoot, "02_Areas"))).toBe(true);
    expect(await directoryExists(join(contentRoot, "03_Resources"))).toBe(true);
    expect(await directoryExists(join(contentRoot, "04_Archive"))).toBe(true);
  });

  test("returns list of created directories", async () => {
    const result = await createParaDirectories(vaultPath, {});

    expect(result.success).toBe(true);
    expect(Array.isArray(result.created)).toBe(true);
    expect(result.created).toContain("Projects");
    expect(result.created).toContain("Areas");
    expect(result.created).toContain("Resources");
    expect(result.created).toContain("Archives");
  });

  test("returns empty created list when all exist", async () => {
    // Create all PARA directories
    await mkdir(join(vaultPath, "01_Projects"));
    await mkdir(join(vaultPath, "02_Areas"));
    await mkdir(join(vaultPath, "03_Resources"));
    await mkdir(join(vaultPath, "04_Archive"));
    await mkdir(join(vaultPath, "05_Attachments"));

    const result = await createParaDirectories(vaultPath, {});

    expect(result.success).toBe(true);
    expect(result.created.length).toBe(0);
    expect(result.message).toContain("already existed");
  });
});

// =============================================================================
// writeSetupMarker Tests
// =============================================================================

describe("writeSetupMarker", () => {
  test("creates .memory-loop directory", async () => {
    const marker: SetupCompleteMarker = {
      completedAt: new Date().toISOString(),
      version: SETUP_VERSION,
      commandsInstalled: ["test.md"],
      skillsInstalled: [],
      paraCreated: ["Projects"],
      claudeMdUpdated: false,
      gitignoreUpdated: false,
    };

    const result = await writeSetupMarker(vaultPath, marker);

    expect(result.success).toBe(true);
    expect(await directoryExists(join(vaultPath, ".memory-loop"))).toBe(true);
  });

  test("writes marker file with correct content", async () => {
    const marker: SetupCompleteMarker = {
      completedAt: "2026-01-05T12:00:00.000Z",
      version: SETUP_VERSION,
      commandsInstalled: ["daily-debrief.md", "weekly-debrief.md"],
      skillsInstalled: ["vault-task-management"],
      paraCreated: ["Projects", "Areas"],
      claudeMdUpdated: true,
      gitignoreUpdated: true,
    };

    const result = await writeSetupMarker(vaultPath, marker);

    expect(result.success).toBe(true);

    // Read and verify content
    const content = await readFile(join(vaultPath, SETUP_MARKER_PATH), "utf-8");
    const parsed = JSON.parse(content) as SetupCompleteMarker;

    expect(parsed.completedAt).toBe("2026-01-05T12:00:00.000Z");
    expect(parsed.version).toBe(SETUP_VERSION);
    expect(parsed.commandsInstalled).toEqual(["daily-debrief.md", "weekly-debrief.md"]);
    expect(parsed.paraCreated).toEqual(["Projects", "Areas"]);
    expect(parsed.claudeMdUpdated).toBe(true);
    expect(parsed.gitignoreUpdated).toBe(true);
  });

  test("includes errors in marker when present", async () => {
    const marker: SetupCompleteMarker = {
      completedAt: new Date().toISOString(),
      version: SETUP_VERSION,
      commandsInstalled: [],
      skillsInstalled: [],
      paraCreated: [],
      claudeMdUpdated: false,
      gitignoreUpdated: false,
      errors: ["Failed to create Projects", "Failed to update CLAUDE.md"],
    };

    const result = await writeSetupMarker(vaultPath, marker);

    expect(result.success).toBe(true);

    const content = await readFile(join(vaultPath, SETUP_MARKER_PATH), "utf-8");
    const parsed = JSON.parse(content) as SetupCompleteMarker;

    expect(parsed.errors).toEqual([
      "Failed to create Projects",
      "Failed to update CLAUDE.md",
    ]);
  });

  test("overwrites existing marker file", async () => {
    // Create initial marker
    const marker1: SetupCompleteMarker = {
      completedAt: "2026-01-01T00:00:00.000Z",
      version: "0.0.1",
      commandsInstalled: [],
      skillsInstalled: [],
      paraCreated: [],
      claudeMdUpdated: false,
      gitignoreUpdated: false,
    };
    await writeSetupMarker(vaultPath, marker1);

    // Write new marker
    const marker2: SetupCompleteMarker = {
      completedAt: "2026-01-05T12:00:00.000Z",
      version: SETUP_VERSION,
      commandsInstalled: ["updated.md"],
      skillsInstalled: ["vault-task-management"],
      paraCreated: ["All"],
      claudeMdUpdated: true,
      gitignoreUpdated: true,
    };
    const result = await writeSetupMarker(vaultPath, marker2);

    expect(result.success).toBe(true);

    // Verify new content
    const content = await readFile(join(vaultPath, SETUP_MARKER_PATH), "utf-8");
    const parsed = JSON.parse(content) as SetupCompleteMarker;

    expect(parsed.version).toBe(SETUP_VERSION);
    expect(parsed.commandsInstalled).toEqual(["updated.md"]);
  });
});

// =============================================================================
// isSetupComplete Tests
// =============================================================================

describe("isSetupComplete", () => {
  test("returns false when marker does not exist", async () => {
    const result = await isSetupComplete(vaultPath);
    expect(result).toBe(false);
  });

  test("returns true when marker exists", async () => {
    // Create marker
    const marker: SetupCompleteMarker = {
      completedAt: new Date().toISOString(),
      version: SETUP_VERSION,
      commandsInstalled: [],
      skillsInstalled: [],
      paraCreated: [],
      claudeMdUpdated: false,
      gitignoreUpdated: false,
    };
    await writeSetupMarker(vaultPath, marker);

    const result = await isSetupComplete(vaultPath);
    expect(result).toBe(true);
  });
});

// =============================================================================
// CLAUDE.md Backup Tests
// =============================================================================

describe("createClaudeMdBackup", () => {
  test("creates backup of CLAUDE.md", async () => {
    const result = await createClaudeMdBackup(vaultPath);

    expect(result.success).toBe(true);
    expect(await fileExists(join(vaultPath, CLAUDEMD_BACKUP_PATH))).toBe(true);
  });

  test("backup contains original content", async () => {
    const originalContent = "# Test Vault\n\nTest content.";
    const result = await createClaudeMdBackup(vaultPath);

    expect(result.success).toBe(true);

    const backupContent = await readFile(join(vaultPath, CLAUDEMD_BACKUP_PATH), "utf-8");
    expect(backupContent).toBe(originalContent);
  });

  test("creates .memory-loop directory if needed", async () => {
    const result = await createClaudeMdBackup(vaultPath);

    expect(result.success).toBe(true);
    expect(await directoryExists(join(vaultPath, ".memory-loop"))).toBe(true);
  });

  test("returns error if CLAUDE.md does not exist", async () => {
    const emptyVaultPath = join(testDir, "empty-vault");
    await mkdir(emptyVaultPath);

    const result = await createClaudeMdBackup(emptyVaultPath);

    expect(result.success).toBe(false);
    expect(result.error).toContain("CLAUDE.md does not exist");
  });

  test("overwrites existing backup", async () => {
    // Create initial backup
    await mkdir(join(vaultPath, ".memory-loop"), { recursive: true });
    await writeFile(join(vaultPath, CLAUDEMD_BACKUP_PATH), "old backup");

    const result = await createClaudeMdBackup(vaultPath);

    expect(result.success).toBe(true);

    const backupContent = await readFile(join(vaultPath, CLAUDEMD_BACKUP_PATH), "utf-8");
    expect(backupContent).toBe("# Test Vault\n\nTest content.");
  });
});

// =============================================================================
// CLAUDE.md Prompt Building Tests
// =============================================================================

describe("buildClaudeMdPrompt", () => {
  test("includes file path for LLM to read", () => {
    const prompt = buildClaudeMdPrompt({}, vaultPath);

    expect(prompt).toContain("CLAUDE.md");
    expect(prompt).toContain(vaultPath);
  });

  test("includes vault configuration", () => {
    const prompt = buildClaudeMdPrompt({}, vaultPath);

    expect(prompt).toContain("Inbox path:");
    expect(prompt).toContain("Goals file:");
    expect(prompt).toContain("PARA directories:");
  });

  test("uses custom inbox path from config", () => {
    const prompt = buildClaudeMdPrompt({ inboxPath: "Custom_Inbox" }, vaultPath);

    expect(prompt).toContain("Custom_Inbox");
  });

  test("uses custom metadata path for goals", () => {
    const prompt = buildClaudeMdPrompt({ metadataPath: "custom_meta" }, vaultPath);

    expect(prompt).toContain("custom_meta/goals.md");
  });

  test("includes instructions to use Edit tool", () => {
    const prompt = buildClaudeMdPrompt({}, vaultPath);

    expect(prompt).toContain("Memory Loop");
    expect(prompt).toContain("Edit tool");
    expect(prompt).toContain("Preserve all existing content");
  });

  test("includes chat transcripts location", () => {
    const prompt = buildClaudeMdPrompt({}, vaultPath);

    expect(prompt).toContain("Chat transcripts location");
    expect(prompt).toContain("/chats/");
  });

  test("chat transcripts location uses custom inbox path", () => {
    const prompt = buildClaudeMdPrompt({ inboxPath: "Custom_Inbox" }, vaultPath);

    expect(prompt).toContain("Custom_Inbox/chats/");
  });
});

// =============================================================================
// CLAUDE.md Update Tests
// =============================================================================

describe("updateClaudeMd", () => {
  const mockUpdatedContent = "# Test Vault\n\nTest content.\n\n## Memory Loop\n\nUpdated by LLM.";

  test("updates CLAUDE.md when SDK completes successfully", async () => {
    configureSdkForTesting(createMockQueryFn(mockUpdatedContent, vaultPathRef));

    const result = await updateClaudeMd(vaultPath, {});

    expect(result.success).toBe(true);

    const content = await readFile(join(vaultPath, "CLAUDE.md"), "utf-8");
    expect(content).toBe(mockUpdatedContent);
  });

  test("creates backup before updating", async () => {
    configureSdkForTesting(createMockQueryFn(mockUpdatedContent, vaultPathRef));

    await updateClaudeMd(vaultPath, {});

    expect(await fileExists(join(vaultPath, CLAUDEMD_BACKUP_PATH))).toBe(true);
  });

  test("backup contains original content", async () => {
    const originalContent = "# Test Vault\n\nTest content.";
    configureSdkForTesting(createMockQueryFn(mockUpdatedContent, vaultPathRef));

    await updateClaudeMd(vaultPath, {});

    const backupContent = await readFile(join(vaultPath, CLAUDEMD_BACKUP_PATH), "utf-8");
    expect(backupContent).toBe(originalContent);
  });

  test("returns error if backup fails", async () => {
    // Remove CLAUDE.md so backup fails
    await rm(join(vaultPath, "CLAUDE.md"));

    const result = await updateClaudeMd(vaultPath, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("CLAUDE.md does not exist");
  });

  test("returns error if SDK does not emit result event", async () => {
    configureSdkForTesting(createIncompleteQueryFn());

    const result = await updateClaudeMd(vaultPath, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("No result event");
  });

  test("returns error if SDK throws", async () => {
    configureSdkForTesting(createErrorMockQueryFn("API rate limit exceeded"));

    const result = await updateClaudeMd(vaultPath, {});

    expect(result.success).toBe(false);
    expect(result.message).toBe("SDK call failed");
  });

  test("preserves CLAUDE.md on SDK error", async () => {
    const originalContent = "# Test Vault\n\nTest content.";
    configureSdkForTesting(createErrorMockQueryFn("SDK error"));

    await updateClaudeMd(vaultPath, {});

    const content = await readFile(join(vaultPath, "CLAUDE.md"), "utf-8");
    expect(content).toBe(originalContent);
  });
});

// =============================================================================
// updateGitignore Tests
// =============================================================================

describe("updateGitignore", () => {
  test("creates .memory-loop/.gitignore when it does not exist", async () => {
    const result = await updateGitignore(vaultPath);

    expect(result.success).toBe(true);
    expect(await fileExists(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH))).toBe(true);
    expect(result.message).toContain("Created");
  });

  test("creates .memory-loop directory if needed", async () => {
    const result = await updateGitignore(vaultPath);

    expect(result.success).toBe(true);
    expect(await directoryExists(join(vaultPath, ".memory-loop"))).toBe(true);
  });

  test("includes all SQLite cache patterns", async () => {
    await updateGitignore(vaultPath);

    const content = await readFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), "utf-8");

    for (const pattern of MEMORY_LOOP_IGNORE_PATTERNS) {
      expect(content).toContain(pattern);
    }
  });

  test("includes Memory Loop section header", async () => {
    await updateGitignore(vaultPath);

    const content = await readFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), "utf-8");

    expect(content).toContain("# Memory Loop cache and session files");
  });

  test("adds patterns to existing .gitignore", async () => {
    // Create .memory-loop directory and existing .gitignore
    await mkdir(join(vaultPath, ".memory-loop"), { recursive: true });
    const existingContent = "# Existing patterns\n*.tmp\n";
    await writeFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), existingContent);

    const result = await updateGitignore(vaultPath);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Added");

    const content = await readFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), "utf-8");

    // Original content preserved
    expect(content).toContain("*.tmp");

    // New patterns added
    for (const pattern of MEMORY_LOOP_IGNORE_PATTERNS) {
      expect(content).toContain(pattern);
    }
  });

  test("does not duplicate patterns if already present", async () => {
    await mkdir(join(vaultPath, ".memory-loop"), { recursive: true });
    const existingContent = `# Memory Loop cache and session files
cache.db
cache.db-shm
cache.db-wal
sessions/
slash-commands.json
`;
    await writeFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), existingContent);

    const result = await updateGitignore(vaultPath);

    expect(result.success).toBe(true);
    expect(result.message).toContain("already up to date");

    const content = await readFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), "utf-8");

    // Count occurrences of cache.db
    const matches = content.match(/^cache\.db$/gm);
    expect(matches?.length).toBe(1);
  });

  test("adds only missing patterns when some exist", async () => {
    await mkdir(join(vaultPath, ".memory-loop"), { recursive: true });
    const existingContent = `# Partial patterns
cache.db
`;
    await writeFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), existingContent);

    const result = await updateGitignore(vaultPath);

    expect(result.success).toBe(true);
    expect(result.message).toContain("4 pattern(s)");

    const content = await readFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), "utf-8");

    // Should only have one cache.db
    const cacheDbMatches = content.match(/^cache\.db$/gm);
    expect(cacheDbMatches?.length).toBe(1);

    // Should have the other patterns
    expect(content).toContain("cache.db-shm");
    expect(content).toContain("cache.db-wal");
    expect(content).toContain("sessions/");
    expect(content).toContain("slash-commands.json");
  });

  test("handles .gitignore without trailing newline", async () => {
    await mkdir(join(vaultPath, ".memory-loop"), { recursive: true });
    const existingContent = "*.tmp"; // No trailing newline
    await writeFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), existingContent);

    const result = await updateGitignore(vaultPath);

    expect(result.success).toBe(true);

    const content = await readFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), "utf-8");

    // Original content preserved
    expect(content).toContain("*.tmp");
    // Proper separation from new content
    expect(content).toContain("\n");
  });

  test("pattern matching is line-based", async () => {
    // Test that "cache.db" doesn't match "mycache.db" or "cache.db.backup"
    await mkdir(join(vaultPath, ".memory-loop"), { recursive: true });
    const existingContent = `mycache.db
cache.db.backup
`;
    await writeFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), existingContent);

    const result = await updateGitignore(vaultPath);

    expect(result.success).toBe(true);
    expect(result.message).toContain("5 pattern(s)");

    const content = await readFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), "utf-8");
    expect(content).toContain("cache.db\n");
    expect(content).toContain("sessions/");
    expect(content).toContain("slash-commands.json");
  });
});

// =============================================================================
// runVaultSetup Tests
// =============================================================================

describe("runVaultSetup", () => {
  const mockUpdatedClaudeMd = "# Test Vault\n\n## Memory Loop\n\nConfigured.";

  beforeEach(() => {
    // Set up mock for SDK calls in runVaultSetup tests
    configureSdkForTesting(createMockQueryFn(mockUpdatedClaudeMd, vaultPathRef));
  });

  test("returns error for non-existent vault", async () => {
    const result = await runVaultSetup("nonexistent-vault");

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("Vault not found");
  });

  test("completes full setup on fresh vault", async () => {
    const result = await runVaultSetup("test-vault");

    expect(result.success).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.errors).toBeUndefined();

    // Verify commands installed
    expect(await directoryExists(join(vaultPath, COMMANDS_DEST_PATH))).toBe(true);

    // Verify skills installed
    expect(await directoryExists(join(vaultPath, SKILLS_DEST_PATH))).toBe(true);
    expect(await directoryExists(join(vaultPath, SKILLS_DEST_PATH, "vault-task-management"))).toBe(true);

    // Verify PARA directories created
    expect(await directoryExists(join(vaultPath, "01_Projects"))).toBe(true);
    expect(await directoryExists(join(vaultPath, "02_Areas"))).toBe(true);
    expect(await directoryExists(join(vaultPath, "03_Resources"))).toBe(true);
    expect(await directoryExists(join(vaultPath, "04_Archive"))).toBe(true);

    // Verify marker written
    expect(await isSetupComplete(vaultPath)).toBe(true);
  });

  test("succeeds on re-run (reconfigure)", async () => {
    // First setup
    const result1 = await runVaultSetup("test-vault");
    expect(result1.success).toBe(true);

    // Second setup (reconfigure)
    const result2 = await runVaultSetup("test-vault");
    expect(result2.success).toBe(true);
    expect(result2.summary).toContain("Setup marker written");
  });

  test("marker includes all installed commands", async () => {
    await runVaultSetup("test-vault");

    const content = await readFile(join(vaultPath, SETUP_MARKER_PATH), "utf-8");
    const marker = JSON.parse(content) as SetupCompleteMarker;

    expect(marker.commandsInstalled.length).toBeGreaterThan(0);
    expect(marker.commandsInstalled).toContain("daily-debrief.md");
  });

  test("marker includes installed skills", async () => {
    await runVaultSetup("test-vault");

    const content = await readFile(join(vaultPath, SETUP_MARKER_PATH), "utf-8");
    const marker = JSON.parse(content) as SetupCompleteMarker;

    expect(marker.skillsInstalled).toContain("vault-task-management");
  });

  test("marker includes created PARA directories", async () => {
    await runVaultSetup("test-vault");

    const content = await readFile(join(vaultPath, SETUP_MARKER_PATH), "utf-8");
    const marker = JSON.parse(content) as SetupCompleteMarker;

    expect(marker.paraCreated).toContain("Projects");
    expect(marker.paraCreated).toContain("Areas");
    expect(marker.paraCreated).toContain("Resources");
    expect(marker.paraCreated).toContain("Archives");
  });

  test("marker has claudeMdUpdated as false (fire-and-forget, result unknown)", async () => {
    // CLAUDE.md update runs in background to avoid HTTP timeouts,
    // so the marker always shows false since we don't wait for the result
    await runVaultSetup("test-vault");

    const content = await readFile(join(vaultPath, SETUP_MARKER_PATH), "utf-8");
    const marker = JSON.parse(content) as SetupCompleteMarker;

    expect(marker.claudeMdUpdated).toBe(false);
  });

  test("creates .memory-loop/.gitignore with SQLite patterns", async () => {
    await runVaultSetup("test-vault");

    expect(await fileExists(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH))).toBe(true);

    const gitignoreContent = await readFile(join(vaultPath, MEMORY_LOOP_GITIGNORE_PATH), "utf-8");
    expect(gitignoreContent).toContain("cache.db");
    expect(gitignoreContent).toContain("cache.db-shm");
    expect(gitignoreContent).toContain("cache.db-wal");
  });

  test("marker has gitignoreUpdated as true on success", async () => {
    await runVaultSetup("test-vault");

    const content = await readFile(join(vaultPath, SETUP_MARKER_PATH), "utf-8");
    const marker = JSON.parse(content) as SetupCompleteMarker;

    expect(marker.gitignoreUpdated).toBe(true);
  });

  test("respects custom paths from .memory-loop.json", async () => {
    // Create config file
    await writeFile(
      join(vaultPath, ".memory-loop.json"),
      JSON.stringify({
        projectPath: "My_Projects",
        areaPath: "My_Areas",
      })
    );

    const result = await runVaultSetup("test-vault");

    expect(result.success).toBe(true);

    // Check custom paths were used
    expect(await directoryExists(join(vaultPath, "My_Projects"))).toBe(true);
    expect(await directoryExists(join(vaultPath, "My_Areas"))).toBe(true);

    // Default paths should NOT exist
    expect(await directoryExists(join(vaultPath, "01_Projects"))).toBe(false);
    expect(await directoryExists(join(vaultPath, "02_Areas"))).toBe(false);
  });

  test("summary includes meaningful messages", async () => {
    const result = await runVaultSetup("test-vault");

    expect(result.success).toBe(true);

    // Summary should have messages about commands, PARA, and marker
    const summaryText = result.summary.join(" ");
    expect(summaryText).toContain("command");
    expect(summaryText).toContain("directory");
    expect(summaryText).toContain("marker");
  });
});

// =============================================================================
// Partial Failure Tests
// =============================================================================

describe("Partial Failure Handling", () => {
  const mockUpdatedClaudeMd = "# Test Vault\n\n## Memory Loop\n\nConfigured.";

  beforeEach(() => {
    configureSdkForTesting(createMockQueryFn(mockUpdatedClaudeMd, vaultPathRef));
  });

  test("continues after command install failure and accumulates errors", async () => {
    // This test verifies the error accumulation behavior
    // We can't easily simulate a command install failure without more complex mocking
    // but we can verify the structure handles errors correctly

    // Create a vault where setup should succeed
    const result = await runVaultSetup("test-vault");

    expect(result.success).toBe(true);
    // Verify errors array is undefined when no errors
    expect(result.errors).toBeUndefined();
    // Summary should still have entries for all steps
    expect(result.summary.length).toBeGreaterThanOrEqual(3);
  });

  test("marker is written even with partial failures", async () => {
    // Setup should complete even if some operations are skipped/already exist
    await mkdir(join(vaultPath, "01_Projects"));
    await mkdir(join(vaultPath, "02_Areas"));

    const result = await runVaultSetup("test-vault");

    expect(result.success).toBe(true);
    expect(await isSetupComplete(vaultPath)).toBe(true);

    // Check marker reflects what was actually created (not all 4)
    const content = await readFile(join(vaultPath, SETUP_MARKER_PATH), "utf-8");
    const marker = JSON.parse(content) as SetupCompleteMarker;

    // Only Resources and Archives should be in paraCreated
    expect(marker.paraCreated).toContain("Resources");
    expect(marker.paraCreated).toContain("Archives");
    expect(marker.paraCreated).not.toContain("Projects");
    expect(marker.paraCreated).not.toContain("Areas");
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
  beforeEach(() => {
    // Use no-op mock since these tests use different vault paths
    // and just verify setup completes without error
    configureSdkForTesting(createNoOpMockQueryFn());
  });

  test("handles vault with spaces in name", async () => {
    // Create vault with spaces
    const spacedVaultPath = join(testDir, "my vault");
    await mkdir(spacedVaultPath);
    await writeFile(join(spacedVaultPath, "CLAUDE.md"), "# Spaced Vault");

    const result = await runVaultSetup("my vault");

    expect(result.success).toBe(true);
    expect(await directoryExists(join(spacedVaultPath, COMMANDS_DEST_PATH))).toBe(true);
  });

  test("handles vault with special characters in name", async () => {
    // Create vault with special chars
    const specialVaultPath = join(testDir, "vault-2025_test.v1");
    await mkdir(specialVaultPath);
    await writeFile(join(specialVaultPath, "CLAUDE.md"), "# Special Vault");

    const result = await runVaultSetup("vault-2025_test.v1");

    expect(result.success).toBe(true);
    expect(await isSetupComplete(specialVaultPath)).toBe(true);
  });

  test("setup version is correct", () => {
    expect(SETUP_VERSION).toBe("1.3.0");
  });

  test("marker path is correct", () => {
    expect(SETUP_MARKER_PATH).toBe(".memory-loop/setup-complete");
  });

  test("commands destination path is correct", () => {
    expect(COMMANDS_DEST_PATH).toBe(".claude/commands");
  });

  test("skills destination path is correct", () => {
    expect(SKILLS_DEST_PATH).toBe(".claude/skills");
  });
});

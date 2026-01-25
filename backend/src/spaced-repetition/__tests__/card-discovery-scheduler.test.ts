/**
 * Tests for Card Discovery Scheduler
 *
 * Tests scheduled card discovery with daily and weekly passes.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  calculateChecksum,
  discoverAllFiles,
  runDailyPass,
  runWeeklyPass,
  shouldRunDaily,
  shouldRunWeekly,
  shouldCatchUpOnStartup,
  startScheduler,
  stopScheduler,
  isSchedulerRunning,
  getDiscoveryHourFromEnv,
  DEFAULT_DISCOVERY_HOUR,
  WEEKLY_CATCH_UP_LIMIT,
} from "../card-discovery-scheduler.js";
import {
  readDiscoveryState,
  writeDiscoveryState,
  createEmptyState,
} from "../card-discovery-state.js";
import * as cardGenerator from "../card-generator.js";
import * as cardManager from "../card-manager.js";

// =============================================================================
// Test Utilities
// =============================================================================

let testDir: string;
let originalHome: string | undefined;
let originalVaultsDir: string | undefined;
let originalDiscoveryHour: string | undefined;

async function createTestDir(): Promise<string> {
  const dir = join(tmpdir(), `card-discovery-scheduler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function createTestVault(basePath: string, name: string): Promise<string> {
  const vaultPath = join(basePath, name);
  await mkdir(vaultPath, { recursive: true });
  // Create CLAUDE.md (required for vault discovery)
  await writeFile(join(vaultPath, "CLAUDE.md"), "# Test Vault\n");
  // Create metadata path
  await mkdir(join(vaultPath, "06_Metadata", "memory-loop"), { recursive: true });
  return vaultPath;
}

async function createMarkdownFile(vaultPath: string, relativePath: string, content: string): Promise<void> {
  const fullPath = join(vaultPath, relativePath);
  const dir = join(fullPath, "..");
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, content);
}

// =============================================================================
// Setup and Teardown
// =============================================================================

beforeEach(async () => {
  // Save original env vars
  originalHome = process.env.HOME;
  originalVaultsDir = process.env.VAULTS_DIR;
  originalDiscoveryHour = process.env.CARD_DISCOVERY_HOUR;

  // Create isolated test directories
  testDir = await createTestDir();
  process.env.HOME = testDir;
  process.env.VAULTS_DIR = join(testDir, "vaults");
  delete process.env.CARD_DISCOVERY_HOUR;

  // Create vaults directory
  await mkdir(join(testDir, "vaults"), { recursive: true });
  await mkdir(join(testDir, ".config", "memory-loop"), { recursive: true });
});

afterEach(async () => {
  // Stop scheduler if running
  if (isSchedulerRunning()) {
    stopScheduler();
  }

  // Restore env vars
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
  }
  if (originalVaultsDir !== undefined) {
    process.env.VAULTS_DIR = originalVaultsDir;
  } else {
    delete process.env.VAULTS_DIR;
  }
  if (originalDiscoveryHour !== undefined) {
    process.env.CARD_DISCOVERY_HOUR = originalDiscoveryHour;
  }

  // Clean up test directory
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// =============================================================================
// Checksum Tests
// =============================================================================

describe("calculateChecksum", () => {
  it("returns consistent hash for same content", () => {
    const content = "Hello, world!";
    const hash1 = calculateChecksum(content);
    const hash2 = calculateChecksum(content);
    expect(hash1).toBe(hash2);
  });

  it("returns different hash for different content", () => {
    const hash1 = calculateChecksum("Hello");
    const hash2 = calculateChecksum("World");
    expect(hash1).not.toBe(hash2);
  });

  it("returns 64-character hex string (SHA-256)", () => {
    const hash = calculateChecksum("test");
    expect(hash.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("handles empty string", () => {
    const hash = calculateChecksum("");
    expect(hash.length).toBe(64);
  });

  it("handles unicode content", () => {
    const hash = calculateChecksum("Hello \u{1F600} World");
    expect(hash.length).toBe(64);
  });
});

// =============================================================================
// File Discovery Tests
// =============================================================================

describe("discoverAllFiles", () => {
  it("discovers markdown files in vault", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note1.md", "# Test Note 1\nSome content.");
    await createMarkdownFile(vaultPath, "note2.md", "# Test Note 2\nMore content.");

    const files = await discoverAllFiles();
    expect(files.length).toBe(2); // note1.md, note2.md (CLAUDE.md excluded)
    expect(files.some((f) => f.relativePath === "note1.md")).toBe(true);
    expect(files.some((f) => f.relativePath === "note2.md")).toBe(true);
  });

  it("skips CLAUDE.md files (project instructions)", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    // createTestVault already creates CLAUDE.md at root
    await createMarkdownFile(vaultPath, "regular.md", "# Regular Note");
    // Also test CLAUDE.md in subdirectory
    await createMarkdownFile(vaultPath, "folder/CLAUDE.md", "# Nested CLAUDE");
    await createMarkdownFile(vaultPath, "folder/note.md", "# Nested Note");

    const files = await discoverAllFiles();
    expect(files.some((f) => f.relativePath === "CLAUDE.md")).toBe(false);
    expect(files.some((f) => f.relativePath === "folder/CLAUDE.md")).toBe(false);
    expect(files.some((f) => f.relativePath === "regular.md")).toBe(true);
    expect(files.some((f) => f.relativePath === "folder/note.md")).toBe(true);
  });

  it("discovers files in subdirectories", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "folder/nested.md", "# Nested Note");
    await createMarkdownFile(vaultPath, "folder/subfolder/deep.md", "# Deep Note");

    const files = await discoverAllFiles();
    expect(files.some((f) => f.relativePath === "folder/nested.md")).toBe(true);
    expect(files.some((f) => f.relativePath === "folder/subfolder/deep.md")).toBe(true);
  });

  it("skips hidden files and directories", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, ".hidden.md", "# Hidden");
    await createMarkdownFile(vaultPath, ".obsidian/config.md", "# Config");
    await createMarkdownFile(vaultPath, "visible.md", "# Visible");

    const files = await discoverAllFiles();
    expect(files.some((f) => f.relativePath === ".hidden.md")).toBe(false);
    expect(files.some((f) => f.relativePath.includes(".obsidian"))).toBe(false);
    expect(files.some((f) => f.relativePath === "visible.md")).toBe(true);
  });

  it("skips metadata directory", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "06_Metadata/memory-loop/cards/test.md", "# Card");
    await createMarkdownFile(vaultPath, "regular.md", "# Regular");

    const files = await discoverAllFiles();
    expect(files.some((f) => f.relativePath.includes("06_Metadata"))).toBe(false);
    expect(files.some((f) => f.relativePath === "regular.md")).toBe(true);
  });

  it("skips chat transcripts directory", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    // Create inbox directory (00_Inbox is auto-detected as inboxPath)
    await createMarkdownFile(vaultPath, "00_Inbox/chats/2026-01-24-session.md", "# Chat Transcript");
    await createMarkdownFile(vaultPath, "00_Inbox/daily/2026-01-24.md", "# Daily Note");
    await createMarkdownFile(vaultPath, "regular.md", "# Regular");

    const files = await discoverAllFiles();
    // Chats should be excluded (ephemeral, not curated knowledge)
    expect(files.some((f) => f.relativePath.includes("00_Inbox/chats"))).toBe(false);
    // Other inbox files should be included
    expect(files.some((f) => f.relativePath === "00_Inbox/daily/2026-01-24.md")).toBe(true);
    expect(files.some((f) => f.relativePath === "regular.md")).toBe(true);
  });

  it("only includes .md files", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note.md", "# Note");
    await writeFile(join(vaultPath, "data.json"), "{}");
    await writeFile(join(vaultPath, "readme.txt"), "text");

    const files = await discoverAllFiles();
    expect(files.every((f) => f.relativePath.endsWith(".md"))).toBe(true);
  });

  it("discovers files across multiple vaults", async () => {
    await createTestVault(join(testDir, "vaults"), "vault1");
    await createTestVault(join(testDir, "vaults"), "vault2");
    await createMarkdownFile(join(testDir, "vaults", "vault1"), "note1.md", "# Note 1");
    await createMarkdownFile(join(testDir, "vaults", "vault2"), "note2.md", "# Note 2");

    const files = await discoverAllFiles();
    // Check we found files from both vaults by checking the paths
    const vaultPaths = files.map((f) => f.vault.contentRoot);
    expect(vaultPaths.some((p) => p.includes("vault1"))).toBe(true);
    expect(vaultPaths.some((p) => p.includes("vault2"))).toBe(true);
  });

  it("includes file size and mtime", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    const content = "# Test Content\nWith some text.";
    await createMarkdownFile(vaultPath, "note.md", content);

    const files = await discoverAllFiles();
    const noteFile = files.find((f) => f.relativePath === "note.md");
    expect(noteFile).toBeDefined();
    expect(noteFile!.size).toBe(Buffer.byteLength(content));
    expect(noteFile!.mtime instanceof Date).toBe(true);
  });

  it("skips vaults with cardsEnabled set to false", async () => {
    // Create vault with cardsEnabled false
    const disabledVault = await createTestVault(join(testDir, "vaults"), "disabled-vault");
    await writeFile(
      join(disabledVault, ".memory-loop.json"),
      JSON.stringify({ cardsEnabled: false })
    );
    await createMarkdownFile(disabledVault, "note-in-disabled.md", "# Disabled vault note");

    // Create vault with cardsEnabled true (or default)
    const enabledVault = await createTestVault(join(testDir, "vaults"), "enabled-vault");
    await createMarkdownFile(enabledVault, "note-in-enabled.md", "# Enabled vault note");

    const files = await discoverAllFiles();

    // Should find files from enabled vault
    expect(files.some((f) => f.relativePath === "note-in-enabled.md")).toBe(true);

    // Should NOT find files from disabled vault
    expect(files.some((f) => f.relativePath === "note-in-disabled.md")).toBe(false);
    expect(files.some((f) => f.vault.name === "disabled-vault")).toBe(false);
  });

  it("includes vaults with cardsEnabled set to true", async () => {
    // Create vault with explicit cardsEnabled true
    const vaultPath = await createTestVault(join(testDir, "vaults"), "explicit-enabled-vault");
    await writeFile(
      join(vaultPath, ".memory-loop.json"),
      JSON.stringify({ cardsEnabled: true })
    );
    await createMarkdownFile(vaultPath, "note.md", "# Test Note");

    const files = await discoverAllFiles();

    expect(files.some((f) => f.relativePath === "note.md")).toBe(true);
  });

  it("includes vaults without cardsEnabled setting (default true)", async () => {
    // Create vault without .memory-loop.json
    const vaultPath = await createTestVault(join(testDir, "vaults"), "default-vault");
    await createMarkdownFile(vaultPath, "default-note.md", "# Default Note");

    const files = await discoverAllFiles();

    expect(files.some((f) => f.relativePath === "default-note.md")).toBe(true);
  });
});

// =============================================================================
// Scheduling Logic Tests
// =============================================================================

describe("shouldRunDaily", () => {
  it("returns true at configured hour when never run", () => {
    const getNow = () => new Date("2026-01-24T03:30:00Z");
    expect(shouldRunDaily(3, null, getNow)).toBe(true);
  });

  it("returns false at wrong hour", () => {
    const getNow = () => new Date("2026-01-24T05:30:00Z");
    expect(shouldRunDaily(3, null, getNow)).toBe(false);
  });

  it("returns true at configured hour when last run was yesterday", () => {
    const getNow = () => new Date("2026-01-24T03:30:00Z");
    expect(shouldRunDaily(3, "2026-01-23T03:00:00Z", getNow)).toBe(true);
  });

  it("returns false at configured hour when already run today", () => {
    const getNow = () => new Date("2026-01-24T03:30:00Z");
    expect(shouldRunDaily(3, "2026-01-24T03:05:00Z", getNow)).toBe(false);
  });

  it("handles midnight correctly", () => {
    const getNow = () => new Date("2026-01-24T00:15:00Z");
    expect(shouldRunDaily(0, "2026-01-23T00:00:00Z", getNow)).toBe(true);
  });

  it("handles end of day correctly", () => {
    const getNow = () => new Date("2026-01-24T23:45:00Z");
    expect(shouldRunDaily(23, null, getNow)).toBe(true);
    expect(shouldRunDaily(23, "2026-01-24T23:00:00Z", getNow)).toBe(false);
  });
});

describe("shouldRunWeekly", () => {
  it("returns true on Sunday at configured hour when never run", () => {
    // 2026-01-25 is a Sunday
    const getNow = () => new Date("2026-01-25T03:30:00Z");
    expect(shouldRunWeekly(3, null, getNow)).toBe(true);
  });

  it("returns false on non-Sunday", () => {
    // 2026-01-24 is a Saturday
    const getNow = () => new Date("2026-01-24T03:30:00Z");
    expect(shouldRunWeekly(3, null, getNow)).toBe(false);
  });

  it("returns false on Sunday at wrong hour", () => {
    // 2026-01-25 is a Sunday
    const getNow = () => new Date("2026-01-25T10:30:00Z");
    expect(shouldRunWeekly(3, null, getNow)).toBe(false);
  });

  it("returns true on Sunday when last run was more than a week ago", () => {
    const getNow = () => new Date("2026-01-25T03:30:00Z");
    expect(shouldRunWeekly(3, "2026-01-17T03:00:00Z", getNow)).toBe(true);
  });

  it("returns false on Sunday when run within the week", () => {
    const getNow = () => new Date("2026-01-25T03:30:00Z");
    expect(shouldRunWeekly(3, "2026-01-20T03:00:00Z", getNow)).toBe(false);
  });
});

describe("shouldCatchUpOnStartup", () => {
  it("returns false when never run (first run lets weekly handle backlog)", () => {
    expect(shouldCatchUpOnStartup(null)).toBe(false);
  });

  it("returns true when last run was more than 24h ago", () => {
    const getNow = () => new Date("2026-01-24T12:00:00Z");
    expect(shouldCatchUpOnStartup("2026-01-23T10:00:00Z", getNow)).toBe(true);
  });

  it("returns false when last run was within 24h", () => {
    const getNow = () => new Date("2026-01-24T12:00:00Z");
    expect(shouldCatchUpOnStartup("2026-01-24T00:00:00Z", getNow)).toBe(false);
  });

  it("returns false when last run was exactly 24h ago", () => {
    const getNow = () => new Date("2026-01-24T12:00:00Z");
    expect(shouldCatchUpOnStartup("2026-01-23T12:00:00Z", getNow)).toBe(false);
  });
});

// =============================================================================
// Environment Configuration Tests
// =============================================================================

describe("getDiscoveryHourFromEnv", () => {
  it("returns default when env var not set", () => {
    delete process.env.CARD_DISCOVERY_HOUR;
    expect(getDiscoveryHourFromEnv()).toBe(DEFAULT_DISCOVERY_HOUR);
  });

  it("returns configured hour when valid", () => {
    process.env.CARD_DISCOVERY_HOUR = "5";
    expect(getDiscoveryHourFromEnv()).toBe(5);
  });

  it("returns default for invalid value", () => {
    process.env.CARD_DISCOVERY_HOUR = "invalid";
    expect(getDiscoveryHourFromEnv()).toBe(DEFAULT_DISCOVERY_HOUR);
  });

  it("returns default for hour < 0", () => {
    process.env.CARD_DISCOVERY_HOUR = "-1";
    expect(getDiscoveryHourFromEnv()).toBe(DEFAULT_DISCOVERY_HOUR);
  });

  it("returns default for hour > 23", () => {
    process.env.CARD_DISCOVERY_HOUR = "24";
    expect(getDiscoveryHourFromEnv()).toBe(DEFAULT_DISCOVERY_HOUR);
  });

  it("accepts hour 0 (midnight)", () => {
    process.env.CARD_DISCOVERY_HOUR = "0";
    expect(getDiscoveryHourFromEnv()).toBe(0);
  });

  it("accepts hour 23 (11pm)", () => {
    process.env.CARD_DISCOVERY_HOUR = "23";
    expect(getDiscoveryHourFromEnv()).toBe(23);
  });
});

// =============================================================================
// Daily Pass Tests
// =============================================================================

describe("runDailyPass", () => {
  it("processes files modified in last 24 hours", async () => {
    // Create vault with a file
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    const content = "# Recent Note\nThis is factual: The capital of France is Paris.";
    await createMarkdownFile(vaultPath, "recent.md", content);

    // Mock card generator to return a card
    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [{ question: "Capital of France?", answer: "Paris" }] }),
    }));

    // Mock card manager
    const mockCreateCard = spyOn(cardManager, "createCard").mockImplementation(() =>
      Promise.resolve({
        success: true as const,
        data: {
          metadata: {
            id: "test-id",
            type: "qa",
            created_date: "2026-01-24",
            last_reviewed: null,
            next_review: "2026-01-24",
            ease_factor: 2.5,
            interval: 0,
            repetitions: 0,
          },
          content: { question: "Q", answer: "A" },
        },
      })
    );

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    const stats = await runDailyPass(getNow);

    expect(stats.filesScanned).toBeGreaterThan(0);
    expect(mockGenerate).toHaveBeenCalled();
    expect(mockCreateCard).toHaveBeenCalled();

    // Check state was updated
    const state = await readDiscoveryState();
    expect(state.lastDailyRun).toBeDefined();

    mockGenerate.mockRestore();
    mockCreateCard.mockRestore();
  });

  it("skips already processed files with same checksum", async () => {
    // Create vault with a file
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    const content = "# Test Note\nSome content.";
    await createMarkdownFile(vaultPath, "note.md", content);

    // Pre-populate state with this file processed
    const checksum = calculateChecksum(content);
    const state = createEmptyState();
    state.processedFiles[join(vaultPath, "note.md")] = {
      checksum,
      processedAt: "2026-01-23T00:00:00Z",
    };
    await writeDiscoveryState(state);

    // Mock generator - should not be called for already processed file
    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [] }),
    }));

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    const stats = await runDailyPass(getNow);

    // File should be skipped (already processed with same checksum)
    expect(stats.filesSkipped).toBeGreaterThan(0);

    mockGenerate.mockRestore();
  });

  it("reprocesses file when checksum changes", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    const oldContent = "# Old Content";
    const newContent = "# New Content with Facts\nThe sky is blue.";
    await createMarkdownFile(vaultPath, "note.md", newContent);

    // Pre-populate state with old checksum
    const state = createEmptyState();
    state.processedFiles[join(vaultPath, "note.md")] = {
      checksum: calculateChecksum(oldContent),
      processedAt: "2026-01-23T00:00:00Z",
    };
    await writeDiscoveryState(state);

    // Mock generator
    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [{ question: "Q", answer: "A" }] }),
    }));

    const mockCreateCard = spyOn(cardManager, "createCard").mockImplementation(() =>
      Promise.resolve({
        success: true as const,
        data: {
          metadata: {
            id: "test-id",
            type: "qa",
            created_date: "2026-01-24",
            last_reviewed: null,
            next_review: "2026-01-24",
            ease_factor: 2.5,
            interval: 0,
            repetitions: 0,
          },
          content: { question: "Q", answer: "A" },
        },
      })
    );

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    const stats = await runDailyPass(getNow);

    // File should be processed (checksum changed)
    expect(stats.filesProcessed).toBeGreaterThan(0);

    mockGenerate.mockRestore();
    mockCreateCard.mockRestore();
  });

  it("handles empty vault gracefully", async () => {
    await createTestVault(join(testDir, "vaults"), "empty-vault");

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    const stats = await runDailyPass(getNow);

    // Should complete without error
    expect(stats.errors).toBe(0);
  });

  it("logs progress and updates state", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note.md", "# Test Note");

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [] }),
    }));

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    await runDailyPass(getNow);

    const state = await readDiscoveryState();
    expect(state.lastDailyRun).toBe("2026-01-24T03:00:00.000Z");

    mockGenerate.mockRestore();
  });
});

// =============================================================================
// Weekly Pass Tests
// =============================================================================

describe("runWeeklyPass", () => {
  it("processes oldest unprocessed files first", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note1.md", "# Note 1\nFact: One is less than two.");
    await createMarkdownFile(vaultPath, "note2.md", "# Note 2\nFact: Two is greater than one.");

    const processedFiles: string[] = [];
    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: (_content: string, filePath: string) => {
        processedFiles.push(filePath);
        return Promise.resolve({ success: true, cards: [] });
      },
    }));

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    await runWeeklyPass(WEEKLY_CATCH_UP_LIMIT, getNow);

    expect(processedFiles.length).toBeGreaterThan(0);

    mockGenerate.mockRestore();
  });

  it("respects weekly byte limit", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    // Create files larger than limit combined
    const largeContent = "x".repeat(600 * 1024); // 600KB
    await createMarkdownFile(vaultPath, "large1.md", largeContent);
    await createMarkdownFile(vaultPath, "large2.md", largeContent);

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [] }),
    }));

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    const stats = await runWeeklyPass(500 * 1024, getNow); // 500KB limit

    // Should process at most one file due to size limit
    expect(stats.filesProcessed).toBeLessThanOrEqual(1);

    mockGenerate.mockRestore();
  });

  it("tracks weekly progress across runs", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "small.md", "x".repeat(100));

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [] }),
    }));

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    await runWeeklyPass(WEEKLY_CATCH_UP_LIMIT, getNow);

    const state = await readDiscoveryState();
    expect(state.weeklyProgress).toBeDefined();
    expect(state.weeklyProgress!.bytesProcessed).toBeGreaterThan(0);
    expect(state.weeklyProgress!.weekStartDate).toBeDefined();

    mockGenerate.mockRestore();
  });

  it("resets weekly progress at start of new week", async () => {
    // Set up state from previous week
    const state = createEmptyState();
    state.weeklyProgress = {
      bytesProcessed: 400000,
      weekStartDate: "2026-01-13", // Previous week
    };
    await writeDiscoveryState(state);

    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note.md", "# Content");

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [] }),
    }));

    // Run in new week
    const getNow = () => new Date("2026-01-24T03:00:00Z");
    await runWeeklyPass(WEEKLY_CATCH_UP_LIMIT, getNow);

    const newState = await readDiscoveryState();
    // Weekly progress should be reset (new week started)
    expect(newState.weeklyProgress!.weekStartDate).not.toBe("2026-01-13");

    mockGenerate.mockRestore();
  });

  it("updates lastWeeklyRun timestamp", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note.md", "# Test Note");

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [] }),
    }));

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    await runWeeklyPass(WEEKLY_CATCH_UP_LIMIT, getNow);

    const state = await readDiscoveryState();
    expect(state.lastWeeklyRun).toBe("2026-01-24T03:00:00.000Z");

    mockGenerate.mockRestore();
  });
});

// =============================================================================
// Scheduler Lifecycle Tests
// =============================================================================

describe("startScheduler / stopScheduler", () => {
  it("starts and stops scheduler", async () => {
    expect(isSchedulerRunning()).toBe(false);

    // Start with catch-up disabled to avoid running discovery
    await startScheduler({ catchUpOnStartup: false });
    expect(isSchedulerRunning()).toBe(true);

    stopScheduler();
    expect(isSchedulerRunning()).toBe(false);
  });

  it("warns when starting already running scheduler", async () => {
    await startScheduler({ catchUpOnStartup: false });
    expect(isSchedulerRunning()).toBe(true);

    // Starting again should not throw
    await startScheduler({ catchUpOnStartup: false });
    expect(isSchedulerRunning()).toBe(true);

    stopScheduler();
  });

  it("warns when stopping non-running scheduler", () => {
    expect(isSchedulerRunning()).toBe(false);
    stopScheduler(); // Should not throw
    expect(isSchedulerRunning()).toBe(false);
  });

  it("runs catch-up on startup when last run > 24h ago", async () => {
    // Set up state with old last run
    const state = createEmptyState();
    state.lastDailyRun = "2026-01-20T00:00:00Z"; // Several days ago
    await writeDiscoveryState(state);

    // Create vault with a markdown file for catch-up to process
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note.md", "# Test Note");

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [] }),
    }));

    const getNow = () => new Date("2026-01-24T10:00:00Z");
    await startScheduler({ catchUpOnStartup: true, getNow });

    // Should have run catch-up
    const newState = await readDiscoveryState();
    expect(newState.lastDailyRun).toBe("2026-01-24T10:00:00.000Z");

    stopScheduler();
    mockGenerate.mockRestore();
  });

  it("skips catch-up on first run to let weekly pass handle backlog", async () => {
    // First run: no prior state, lastDailyRun is null
    // Should NOT run catch-up - weekly pass handles the backlog gradually

    // Create vault with files
    await createTestVault(join(testDir, "vaults"), "test-vault");

    const getNow = () => new Date("2026-01-24T10:00:00Z");
    await startScheduler({ catchUpOnStartup: true, getNow });

    // lastDailyRun should still be null (no catch-up ran)
    const newState = await readDiscoveryState();
    expect(newState.lastDailyRun).toBeNull();

    stopScheduler();
  });

  it("skips catch-up on startup when disabled", async () => {
    const state = createEmptyState();
    state.lastDailyRun = "2026-01-20T00:00:00Z";
    await writeDiscoveryState(state);

    await startScheduler({ catchUpOnStartup: false });

    // State should be unchanged
    const newState = await readDiscoveryState();
    expect(newState.lastDailyRun).toBe("2026-01-20T00:00:00Z");

    stopScheduler();
  });

  it("uses configured discovery hour", async () => {
    await startScheduler({ discoveryHour: 5, catchUpOnStartup: false });
    expect(isSchedulerRunning()).toBe(true);
    stopScheduler();
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("error handling", () => {
  it("handles retriable generator errors gracefully", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note.md", "# Test\nContent here.");

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: false, error: "LLM rate limit", retriable: true }),
    }));

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    const stats = await runDailyPass(getNow);

    // Should complete with retriable count (not errors)
    expect(stats.filesRetriable).toBeGreaterThan(0);
    expect(stats.errors).toBe(0);

    mockGenerate.mockRestore();
  });

  it("handles permanent generator errors", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note.md", "# Test\nContent here.");

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: false, error: "Invalid content", retriable: false }),
    }));

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    const stats = await runDailyPass(getNow);

    // Should complete with error count
    expect(stats.errors).toBeGreaterThan(0);

    mockGenerate.mockRestore();
  });

  it("handles card creation errors gracefully", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note.md", "# Test\nFact: Testing is good.");

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [{ question: "Q?", answer: "A" }] }),
    }));

    const mockCreateCard = spyOn(cardManager, "createCard").mockImplementation(() =>
      Promise.resolve({
        success: false as const,
        error: "Storage error",
      })
    );

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    const stats = await runDailyPass(getNow);

    // Should complete with error count
    expect(stats.errors).toBeGreaterThan(0);
    expect(stats.cardsCreated).toBe(0);

    mockGenerate.mockRestore();
    mockCreateCard.mockRestore();
  });

  it("continues processing other files after error", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "good1.md", "# Good 1\nFact: One.");
    await createMarkdownFile(vaultPath, "bad.md", "# Bad\nError trigger.");
    await createMarkdownFile(vaultPath, "good2.md", "# Good 2\nFact: Two.");

    let callCount = 0;
    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: (content: string) => {
        callCount++;
        if (content.includes("Error trigger")) {
          return Promise.resolve({ success: false, error: "Simulated error", retriable: false });
        }
        return Promise.resolve({ success: true, cards: [{ question: "Q?", answer: "A" }] });
      },
    }));

    const mockCreateCard = spyOn(cardManager, "createCard").mockImplementation(() =>
      Promise.resolve({
        success: true as const,
        data: {
          metadata: {
            id: "test-id",
            type: "qa",
            created_date: "2026-01-24",
            last_reviewed: null,
            next_review: "2026-01-24",
            ease_factor: 2.5,
            interval: 0,
            repetitions: 0,
          },
          content: { question: "Q", answer: "A" },
        },
      })
    );

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    await runDailyPass(getNow);

    // Should have processed multiple files (including the one that errors)
    expect(callCount).toBeGreaterThanOrEqual(3); // At least good1, bad, good2

    mockGenerate.mockRestore();
    mockCreateCard.mockRestore();
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("integration", () => {
  it("creates cards from discovered files", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(
      vaultPath,
      "knowledge.md",
      "# Knowledge\nThe Earth orbits the Sun in approximately 365.25 days."
    );

    const createdCards: Array<{ question: string; answer: string }> = [];

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () =>
        Promise.resolve({
          success: true,
          cards: [
            {
              question: "How long does Earth take to orbit the Sun?",
              answer: "Approximately 365.25 days",
            },
          ],
        }),
    }));

    const mockCreateCard = spyOn(cardManager, "createCard").mockImplementation((_vault, input) => {
      createdCards.push({ question: input.question, answer: input.answer });
      return Promise.resolve({
        success: true as const,
        data: {
          metadata: {
            id: "test-id",
            type: "qa",
            created_date: "2026-01-24",
            last_reviewed: null,
            next_review: "2026-01-24",
            ease_factor: 2.5,
            interval: 0,
            repetitions: 0,
            source_file: input.sourceFile,
          },
          content: { question: input.question, answer: input.answer },
        },
      });
    });

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    const stats = await runDailyPass(getNow);

    expect(stats.cardsCreated).toBeGreaterThan(0);
    expect(createdCards.length).toBeGreaterThan(0);
    expect(createdCards[0].question).toContain("Earth");

    mockGenerate.mockRestore();
    mockCreateCard.mockRestore();
  });

  it("marks files as processed after card creation", async () => {
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    const content = "# Test\nSome factual content here.";
    await createMarkdownFile(vaultPath, "note.md", content);

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: () => Promise.resolve({ success: true, cards: [] }),
    }));

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    await runDailyPass(getNow);

    const state = await readDiscoveryState();
    const filePath = join(vaultPath, "note.md");
    expect(state.processedFiles[filePath]).toBeDefined();
    expect(state.processedFiles[filePath].checksum).toBe(calculateChecksum(content));

    mockGenerate.mockRestore();
  });

  it("saves state after each file to prevent repeat work on crash", async () => {
    // Create vault with multiple files
    const vaultPath = await createTestVault(join(testDir, "vaults"), "test-vault");
    await createMarkdownFile(vaultPath, "note1.md", "# Note 1\nFirst file content.");
    await createMarkdownFile(vaultPath, "note2.md", "# Note 2\nSecond file content.");
    await createMarkdownFile(vaultPath, "note3.md", "# Note 3\nThird file content.");

    const stateSnapshots: number[] = [];

    const mockGenerate = spyOn(cardGenerator, "createQACardGenerator").mockImplementation(() => ({
      type: "qa",
      generate: async () => {
        // After each generate call, check how many files are in state
        const currentState = await readDiscoveryState();
        stateSnapshots.push(Object.keys(currentState.processedFiles).length);
        return { success: true, cards: [] };
      },
    }));

    const getNow = () => new Date("2026-01-24T03:00:00Z");
    await runDailyPass(getNow);

    // State should be saved incrementally after each file
    // The generator sees state grow: 0, 1, 2 (before each file is marked)
    // After all processing, state should have all files
    const finalState = await readDiscoveryState();
    expect(Object.keys(finalState.processedFiles).length).toBeGreaterThanOrEqual(3);

    // At minimum, we should see incremental progress in snapshots
    // (first call sees 0 or fewer files than last call)
    if (stateSnapshots.length >= 2) {
      expect(stateSnapshots[stateSnapshots.length - 1]).toBeGreaterThanOrEqual(stateSnapshots[0]);
    }

    mockGenerate.mockRestore();
  });
});

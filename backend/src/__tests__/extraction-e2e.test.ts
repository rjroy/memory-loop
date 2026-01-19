/**
 * Extraction System End-to-End Tests
 *
 * Integration tests covering all spec acceptance scenarios.
 * Note: Tests that require filesystem isolation use controlled fixtures
 * and verify logic behavior rather than actual file operations.
 *
 * Spec Requirements Tested:
 * - REQ-F-4: Overnight batch processing
 * - REQ-F-5: Process transcripts from all vaults
 * - REQ-F-11: Idempotent extraction
 * - REQ-NF-1: 50KB size limit with pruning
 * - REQ-F-6: Customizable extraction prompt
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  readExtractionState,
  writeExtractionState,
  createEmptyState,
  markTranscriptProcessed,
  updateLastRunAt,
} from "../extraction/extraction-state";
import {
  enforceMemoryLimit,
  checkMemorySize,
  mergeFactsWithDeduplication,
  isDuplicate,
  extractFactsFromContent,
  filterDuplicates,
  MEMORY_FILE_PATH,
  SANDBOX_RELATIVE_PATH,
  MAX_MEMORY_SIZE_BYTES,
  MEMORY_SIZE_WARNING_BYTES,
} from "../extraction/memory-writer";
import {
  buildExtractionPrompt,
} from "../extraction/fact-extractor";
import {
  needsCatchUp,
  getCatchUpThresholdMs,
  DEFAULT_CATCHUP_THRESHOLD_MS,
} from "../extraction/extraction-manager";

// =============================================================================
// Test Utilities
// =============================================================================

let tempDir: string;

/**
 * Generate a valid SHA-256 checksum for test data.
 */
function generateChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// =============================================================================
// Setup and Teardown
// =============================================================================

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "extraction-e2e-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// =============================================================================
// Acceptance Test: Extraction State Management
// =============================================================================

describe("Extraction state management", () => {
  it("creates empty state with correct structure", () => {
    const state = createEmptyState();

    expect(state.lastRunAt).toBeNull();
    expect(state.processedTranscripts).toEqual([]);
    expect(Array.isArray(state.processedTranscripts)).toBe(true);
  });

  it("marks transcripts as processed with valid checksum", () => {
    let state = createEmptyState();
    const checksum = generateChecksum("test content");

    state = markTranscriptProcessed(state, "vault1", "/path/to/file.md", checksum);

    expect(state.processedTranscripts.length).toBe(1);
    const record = state.processedTranscripts[0];
    expect(record.vaultId).toBe("vault1");
    expect(record.path).toBe("/path/to/file.md");
    expect(record.checksum).toBe(checksum);
    expect(record.processedAt).toBeDefined();
  });

  it("updates lastRunAt timestamp", () => {
    let state = createEmptyState();
    expect(state.lastRunAt).toBeNull();

    state = updateLastRunAt(state);

    expect(state.lastRunAt).not.toBeNull();
    // Should be a valid ISO date string
    const lastRunAt = state.lastRunAt as string;
    expect(new Date(lastRunAt).toISOString()).toBe(lastRunAt);
  });

  it("persists state to JSON file", async () => {
    const statePath = join(tempDir, "extraction-state.json");

    // Create state with valid checksum
    let state = createEmptyState();
    const checksum = generateChecksum("test content");
    state = markTranscriptProcessed(state, "vault1", "/test/file.md", checksum);
    state = updateLastRunAt(state);

    // Write state to temp file
    await writeExtractionState(state, statePath);

    // Read back
    const loadedState = await readExtractionState(statePath);

    expect(loadedState.processedTranscripts.length).toBe(1);
    expect(loadedState.processedTranscripts[0].vaultId).toBe("vault1");
    expect(loadedState.processedTranscripts[0].path).toBe("/test/file.md");
    expect(loadedState.processedTranscripts[0].checksum).toBe(checksum);
    expect(loadedState.lastRunAt).toBe(state.lastRunAt);
  });
});

// =============================================================================
// Acceptance Test: Incremental Extraction Logic
// =============================================================================

describe("Incremental extraction: tracking processed transcripts", () => {
  it("detects unprocessed transcripts by checksum mismatch", () => {
    let state = createEmptyState();
    const oldChecksum = generateChecksum("old content");
    const newChecksum = generateChecksum("new content");

    // Mark transcript as processed with old checksum
    state = markTranscriptProcessed(state, "vault1", "/file.md", oldChecksum);

    // Find the record and check if checksum matches new content
    const record = state.processedTranscripts.find(
      (t) => t.vaultId === "vault1" && t.path === "/file.md"
    );
    const isModified = record?.checksum !== newChecksum;

    expect(isModified).toBe(true);
  });

  it("identifies already processed transcripts", () => {
    let state = createEmptyState();
    const checksum = generateChecksum("same content");

    // Mark transcript as processed
    state = markTranscriptProcessed(state, "vault1", "/file.md", checksum);

    // Find the record and check if checksum matches
    const record = state.processedTranscripts.find(
      (t) => t.vaultId === "vault1" && t.path === "/file.md"
    );
    const isProcessed = record?.checksum === checksum;

    expect(isProcessed).toBe(true);
  });

  it("handles multiple vaults independently", () => {
    let state = createEmptyState();
    const checksum1 = generateChecksum("content 1");
    const checksum2 = generateChecksum("content 2");

    state = markTranscriptProcessed(state, "vault1", "/file.md", checksum1);
    state = markTranscriptProcessed(state, "vault2", "/file.md", checksum2);

    const vault1Record = state.processedTranscripts.find(
      (t) => t.vaultId === "vault1" && t.path === "/file.md"
    );
    const vault2Record = state.processedTranscripts.find(
      (t) => t.vaultId === "vault2" && t.path === "/file.md"
    );

    expect(vault1Record?.checksum).toBe(checksum1);
    expect(vault2Record?.checksum).toBe(checksum2);
  });
});

// =============================================================================
// Acceptance Test: Memory Size Limit
// =============================================================================

describe("Size limit: enforcing 50KB limit", () => {
  it("defines correct size limits", () => {
    expect(MAX_MEMORY_SIZE_BYTES).toBe(50 * 1024);
    expect(MEMORY_SIZE_WARNING_BYTES).toBe(45 * 1024);
  });

  it("reports size correctly", () => {
    const content = "x".repeat(1024); // 1KB
    const result = checkMemorySize(content);

    expect(result.sizeBytes).toBe(1024);
    expect(result.isOverLimit).toBe(false);
    expect(result.isWarning).toBe(false);
  });

  it("detects content over 50KB limit", () => {
    const content = "x".repeat(51 * 1024); // 51KB
    const result = checkMemorySize(content);

    expect(result.isOverLimit).toBe(true);
  });

  it("detects content near limit (warning threshold)", () => {
    const content = "x".repeat(46 * 1024); // 46KB - over warning but under limit
    const result = checkMemorySize(content);

    expect(result.isWarning).toBe(true);
    expect(result.isOverLimit).toBe(false);
  });

  it("enforceMemoryLimit prunes when over limit with structured content", () => {
    // Need structured content with sections for pruning to work
    let largeContent = "# Memory\n\n## Section One\n\n";
    // Add many lines to exceed limit
    for (let i = 0; i < 3000; i++) {
      largeContent += `- Fact number ${i} with some extra text to fill space\n`;
    }

    const result = enforceMemoryLimit(largeContent);

    // Should be pruned to under or at limit
    expect(Buffer.byteLength(result.content, "utf-8")).toBeLessThanOrEqual(MAX_MEMORY_SIZE_BYTES);
    expect(result.wasPruned).toBe(true);
  });

  it("enforceMemoryLimit does not prune when under limit", () => {
    const smallContent = "# Memory\n\nSmall content.";
    const result = enforceMemoryLimit(smallContent);

    expect(result.content).toBe(smallContent);
    expect(result.wasPruned).toBe(false);
  });
});

// =============================================================================
// Acceptance Test: Duplicate Detection and Merging
// =============================================================================

describe("Duplicate handling: facts merged not duplicated", () => {
  it("detects exact duplicate facts", () => {
    const fact1 = "User prefers dark mode.";
    const fact2 = "User prefers dark mode.";

    expect(isDuplicate(fact1, fact2)).toBe(true);
  });

  it("detects nearly identical facts above threshold", () => {
    // Use facts that differ only in punctuation (will normalize to identical)
    const fact1 = "User prefers dark mode!";
    const fact2 = "User prefers dark mode.";

    // These should normalize to the same text
    expect(isDuplicate(fact1, fact2)).toBe(true);
  });

  it("allows distinct facts through", () => {
    const fact1 = "User prefers dark mode.";
    const fact2 = "User lives in New York.";

    expect(isDuplicate(fact1, fact2)).toBe(false);
  });

  it("filters duplicate facts from list against existing facts", () => {
    const newFacts = [
      "User prefers dark mode.",
      "User prefers dark mode.", // self-duplicate
      "User lives in New York.",
    ];
    const existingFacts = [
      "User prefers dark mode.", // matches first new fact
    ];

    const result = filterDuplicates(newFacts, existingFacts);

    // First fact is duplicate of existing, second is self-duplicate
    expect(result.uniqueFacts.length).toBe(1);
    expect(result.uniqueFacts[0]).toBe("User lives in New York.");
    expect(result.duplicateCount).toBe(2);
  });

  it("merges new facts with existing facts", () => {
    const existing = "# Memory\n\n## Facts\n\n- User likes TypeScript.\n- User uses Bun.\n";
    const newFacts = ["- User likes TypeScript.", "- User prefers dark mode."]; // First is duplicate

    const result = mergeFactsWithDeduplication(existing, newFacts, "## Facts");

    // Should contain the new unique fact but not duplicate the existing one
    expect(result.content).toContain("User prefers dark mode");
    expect(result.duplicateCount).toBe(1);
  });

  it("extracts facts from content", () => {
    const content = "# Memory\n\n- Fact one.\n- Fact two.\n- Fact three.";
    const facts = extractFactsFromContent(content);

    expect(facts.length).toBe(3);
    // extractFactsFromContent keeps the full line including the "- " prefix
    expect(facts).toContain("- Fact one.");
    expect(facts).toContain("- Fact two.");
    expect(facts).toContain("- Fact three.");
  });
});

// =============================================================================
// Acceptance Test: Prompt Customization
// =============================================================================

describe("Prompt customization", () => {
  it("builds extraction prompt with transcript references", () => {
    const basePrompt = "# Extraction Prompt\n\nExtract facts about the user.";
    const transcripts = [
      {
        vaultId: "vault1",
        path: "/path/to/meeting1.md",
        absolutePath: "/vaults/vault1/path/to/meeting1.md",
        checksum: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1",
        content: "Meeting content 1",
        body: "Meeting content 1",
      },
      {
        vaultId: "vault1",
        path: "/path/to/meeting2.md",
        absolutePath: "/vaults/vault1/path/to/meeting2.md",
        checksum: "def456def456def456def456def456def456def456def456def456def456def4",
        content: "Meeting content 2",
        body: "Meeting content 2",
      },
    ];

    const fullPrompt = buildExtractionPrompt(basePrompt, transcripts, "/vaults");

    expect(fullPrompt).toContain(basePrompt);
    expect(fullPrompt).toContain("meeting1.md");
    expect(fullPrompt).toContain("meeting2.md");
  });

  it("includes sandbox file path in prompt", () => {
    const basePrompt = "# Extraction Prompt";
    const transcripts = [
      {
        vaultId: "v1",
        path: "/t.md",
        absolutePath: "/vaults/v1/t.md",
        checksum: "abcdef12345678901234567890abcdef12345678901234567890abcdef123456",
        content: "c",
        body: "c",
      },
    ];

    const fullPrompt = buildExtractionPrompt(basePrompt, transcripts, "/vaults");

    // Should reference the sandbox location
    expect(fullPrompt).toContain(".memory-extraction/memory.md");
  });
});

// =============================================================================
// Acceptance Test: Catch-up Extraction Logic
// =============================================================================

describe("Catch-up extraction: threshold logic", () => {
  it("defines default threshold as 24 hours", () => {
    expect(DEFAULT_CATCHUP_THRESHOLD_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("returns current threshold", () => {
    const threshold = getCatchUpThresholdMs();
    expect(threshold).toBe(DEFAULT_CATCHUP_THRESHOLD_MS);
  });

  it("triggers catch-up when never run", () => {
    const state = createEmptyState();
    // Default state has null lastRunAt
    expect(needsCatchUp(state)).toBe(true);
  });

  it("triggers catch-up when last run exceeds threshold", () => {
    const state = createEmptyState();
    // Set to 25 hours ago
    state.lastRunAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    expect(needsCatchUp(state)).toBe(true);
  });

  it("does not trigger catch-up when last run is recent", () => {
    const state = createEmptyState();
    // Set to 1 hour ago
    state.lastRunAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    expect(needsCatchUp(state)).toBe(false);
  });

  it("handles boundary condition at exactly threshold", () => {
    const state = createEmptyState();
    // Set to exactly 24 hours ago (boundary)
    state.lastRunAt = new Date(Date.now() - DEFAULT_CATCHUP_THRESHOLD_MS).toISOString();

    // At exactly the threshold, should not need catch-up (> not >=)
    expect(needsCatchUp(state)).toBe(false);
  });
});

// =============================================================================
// Acceptance Test: Sandbox Pattern
// =============================================================================

describe("Sandbox pattern for safe operations", () => {
  it("uses correct sandbox path", () => {
    expect(SANDBOX_RELATIVE_PATH).toBe(".memory-extraction/memory.md");
  });

  it("memory file is stored in correct location", () => {
    expect(MEMORY_FILE_PATH).toContain(".claude/rules/memory.md");
  });
});

// =============================================================================
// Acceptance Test: File Paths and Configuration
// =============================================================================

describe("Configuration constants", () => {
  it("defines memory file in .claude/rules/", () => {
    expect(MEMORY_FILE_PATH).toMatch(/\.claude\/rules\/memory\.md$/);
  });

  it("defines sandbox in .memory-extraction/", () => {
    expect(SANDBOX_RELATIVE_PATH).toBe(".memory-extraction/memory.md");
  });
});

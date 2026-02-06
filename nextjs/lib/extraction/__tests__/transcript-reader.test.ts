/**
 * Transcript Reader Tests
 *
 * Tests for discovering and reading transcript files from vault directories.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseTranscriptContent,
  listTranscriptFiles,
  readTranscript,
  discoverVaultTranscripts,
} from "../transcript-reader";
import { getTranscriptsDirectory } from "../../transcript-manager";
import { createEmptyState, markTranscriptProcessed, calculateChecksum } from "../extraction-state";
import { createMockVault } from "../../__tests__/test-helpers";

// =============================================================================
// Test Fixtures
// =============================================================================

const SAMPLE_FRONTMATTER = `---
date: 2026-01-18
time: "14:30"
session_id: abc12345-6789
title: "Sample conversation about testing"
---

# Discussion - 2026-01-18 14:30

## [14:30] User

Hello, this is a test message.

## [14:31] Assistant

Hello! How can I help you today?
`;

const NO_FRONTMATTER = `# Notes

Some plain markdown without frontmatter.
`;

const MALFORMED_FRONTMATTER = `---
date: 2026-01-18
time: "14:30"
This line has no colon
---

Content after broken frontmatter.
`;

// =============================================================================
// parseTranscriptContent Tests
// =============================================================================

describe("parseTranscriptContent", () => {
  describe("with valid frontmatter", () => {
    it("parses date field", () => {
      const result = parseTranscriptContent(SAMPLE_FRONTMATTER);
      expect(result.frontmatter?.date).toBe("2026-01-18");
    });

    it("parses time field with quotes removed", () => {
      const result = parseTranscriptContent(SAMPLE_FRONTMATTER);
      expect(result.frontmatter?.time).toBe("14:30");
    });

    it("parses session_id field", () => {
      const result = parseTranscriptContent(SAMPLE_FRONTMATTER);
      expect(result.frontmatter?.session_id).toBe("abc12345-6789");
    });

    it("parses title field with quotes removed", () => {
      const result = parseTranscriptContent(SAMPLE_FRONTMATTER);
      expect(result.frontmatter?.title).toBe("Sample conversation about testing");
    });

    it("extracts body after frontmatter", () => {
      const result = parseTranscriptContent(SAMPLE_FRONTMATTER);
      expect(result.body).toContain("# Discussion - 2026-01-18 14:30");
      expect(result.body).toContain("Hello, this is a test message.");
    });

    it("body does not contain frontmatter delimiters", () => {
      const result = parseTranscriptContent(SAMPLE_FRONTMATTER);
      expect(result.body.startsWith("---")).toBe(false);
    });
  });

  describe("without frontmatter", () => {
    it("returns undefined frontmatter", () => {
      const result = parseTranscriptContent(NO_FRONTMATTER);
      expect(result.frontmatter).toBeUndefined();
    });

    it("returns entire content as body", () => {
      const result = parseTranscriptContent(NO_FRONTMATTER);
      expect(result.body).toBe(NO_FRONTMATTER);
    });
  });

  describe("with malformed frontmatter", () => {
    it("still parses valid fields", () => {
      const result = parseTranscriptContent(MALFORMED_FRONTMATTER);
      expect(result.frontmatter?.date).toBe("2026-01-18");
      expect(result.frontmatter?.time).toBe("14:30");
    });

    it("ignores lines without colons", () => {
      const result = parseTranscriptContent(MALFORMED_FRONTMATTER);
      // The malformed line should not cause an error
      expect(result.body).toContain("Content after broken frontmatter.");
    });
  });

  describe("quote handling", () => {
    it("removes double quotes from values", () => {
      const content = `---
title: "Quoted title"
---

Body`;
      const result = parseTranscriptContent(content);
      expect(result.frontmatter?.title).toBe("Quoted title");
    });

    it("removes single quotes from values", () => {
      const content = `---
title: 'Single quoted'
---

Body`;
      const result = parseTranscriptContent(content);
      expect(result.frontmatter?.title).toBe("Single quoted");
    });

    it("preserves unquoted values", () => {
      const content = `---
date: 2026-01-18
---

Body`;
      const result = parseTranscriptContent(content);
      expect(result.frontmatter?.date).toBe("2026-01-18");
    });
  });

  describe("edge cases", () => {
    it("handles empty content", () => {
      const result = parseTranscriptContent("");
      expect(result.frontmatter).toBeUndefined();
      expect(result.body).toBe("");
    });

    it("handles content that starts with --- but is not frontmatter", () => {
      const content = "--- horizontal rule\nSome content";
      const result = parseTranscriptContent(content);
      expect(result.frontmatter).toBeUndefined();
      expect(result.body).toBe(content);
    });

    it("handles Windows line endings", () => {
      const content = "---\r\ndate: 2026-01-18\r\n---\r\nBody content";
      const result = parseTranscriptContent(content);
      expect(result.frontmatter?.date).toBe("2026-01-18");
      expect(result.body).toBe("Body content");
    });
  });
});

// =============================================================================
// File Operations Tests (with temp directory)
// =============================================================================

describe("file operations", () => {
  let tempDir: string;
  let vaultPath: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "transcript-reader-test-"));
    vaultPath = join(tempDir, "test-vault");
    chatsDir = join(vaultPath, "00_Inbox", "chats");
    await mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("getTranscriptsDirectory", () => {
    it("returns path to {inbox}/chats/ directory", () => {
      const vault = createMockVault({
        path: vaultPath,
        contentRoot: vaultPath,
        inboxPath: "00_Inbox",
      });
      const result = getTranscriptsDirectory(vault);
      expect(result).toBe(join(vaultPath, "00_Inbox", "chats"));
    });

    it("uses custom inbox path", () => {
      const vault = createMockVault({
        path: vaultPath,
        contentRoot: vaultPath,
        inboxPath: "Custom_Inbox",
      });
      const result = getTranscriptsDirectory(vault);
      expect(result).toBe(join(vaultPath, "Custom_Inbox", "chats"));
    });
  });

  describe("listTranscriptFiles", () => {
    it("returns empty array when chats directory does not exist", async () => {
      const emptyVaultPath = join(tempDir, "empty-vault");
      await mkdir(emptyVaultPath);
      const vault = createMockVault({
        path: emptyVaultPath,
        contentRoot: emptyVaultPath,
      });
      const result = await listTranscriptFiles(vault);
      expect(result).toEqual([]);
    });

    it("returns empty array when chats directory is empty", async () => {
      const vault = createMockVault({
        path: vaultPath,
        contentRoot: vaultPath,
      });
      const result = await listTranscriptFiles(vault);
      expect(result).toEqual([]);
    });

    it("lists only markdown files", async () => {
      await writeFile(join(chatsDir, "chat1.md"), "content");
      await writeFile(join(chatsDir, "chat2.md"), "content");
      await writeFile(join(chatsDir, "notes.txt"), "content");
      await writeFile(join(chatsDir, ".hidden.md"), "content");

      const vault = createMockVault({
        path: vaultPath,
        contentRoot: vaultPath,
      });
      const result = await listTranscriptFiles(vault);

      expect(result).toContain("chat1.md");
      expect(result).toContain("chat2.md");
      expect(result).toContain(".hidden.md");
      expect(result).not.toContain("notes.txt");
    });

    it("excludes subdirectories", async () => {
      await mkdir(join(chatsDir, "subdir.md"), { recursive: true });
      await writeFile(join(chatsDir, "chat.md"), "content");

      const vault = createMockVault({
        path: vaultPath,
        contentRoot: vaultPath,
      });
      const result = await listTranscriptFiles(vault);

      expect(result).toEqual(["chat.md"]);
    });
  });

  describe("readTranscript", () => {
    it("reads and parses a transcript file", async () => {
      await writeFile(join(chatsDir, "test.md"), SAMPLE_FRONTMATTER);

      const vault = createMockVault({
        id: "test-vault",
        path: vaultPath,
        contentRoot: vaultPath,
      });
      const result = await readTranscript(vault, "test.md");

      expect(result).not.toBeNull();
      expect(result?.vaultId).toBe("test-vault");
      expect(result?.path).toBe("00_Inbox/chats/test.md");
      expect(result?.absolutePath).toBe(join(chatsDir, "test.md"));
      expect(result?.content).toBe(SAMPLE_FRONTMATTER);
      expect(result?.frontmatter?.date).toBe("2026-01-18");
      expect(result?.body).toContain("Hello, this is a test message.");
    });

    it("calculates checksum correctly", async () => {
      const content = "Test content for checksum";
      await writeFile(join(chatsDir, "test.md"), content);

      const vault = createMockVault({
        path: vaultPath,
        contentRoot: vaultPath,
      });
      const result = await readTranscript(vault, "test.md");

      expect(result?.checksum).toBe(calculateChecksum(content));
    });

    it("returns null for non-existent file", async () => {
      const vault = createMockVault({
        path: vaultPath,
        contentRoot: vaultPath,
      });
      const result = await readTranscript(vault, "nonexistent.md");
      expect(result).toBeNull();
    });

    it("handles files without frontmatter", async () => {
      await writeFile(join(chatsDir, "plain.md"), NO_FRONTMATTER);

      const vault = createMockVault({
        path: vaultPath,
        contentRoot: vaultPath,
      });
      const result = await readTranscript(vault, "plain.md");

      expect(result).not.toBeNull();
      expect(result?.frontmatter).toBeUndefined();
      expect(result?.body).toBe(NO_FRONTMATTER);
    });
  });

  describe("discoverVaultTranscripts", () => {
    it("discovers all transcripts in a vault", async () => {
      await writeFile(join(chatsDir, "chat1.md"), SAMPLE_FRONTMATTER);
      await writeFile(join(chatsDir, "chat2.md"), NO_FRONTMATTER);

      const vault = createMockVault({
        id: "test-vault",
        path: vaultPath,
        contentRoot: vaultPath,
      });
      const state = createEmptyState();
      const result = await discoverVaultTranscripts(vault, state);

      expect(result.total).toBe(2);
      expect(result.unprocessed).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it("filters out already processed transcripts", async () => {
      const content1 = "Content 1";
      const content2 = "Content 2";
      await writeFile(join(chatsDir, "chat1.md"), content1);
      await writeFile(join(chatsDir, "chat2.md"), content2);

      const vault = createMockVault({
        id: "test-vault",
        path: vaultPath,
        contentRoot: vaultPath,
      });

      // Mark chat1 as processed
      const state = createEmptyState();
      markTranscriptProcessed(
        state,
        "test-vault",
        "00_Inbox/chats/chat1.md",
        calculateChecksum(content1)
      );

      const result = await discoverVaultTranscripts(vault, state);

      expect(result.total).toBe(2);
      expect(result.unprocessed).toHaveLength(1);
      expect(result.unprocessed[0].path).toBe("00_Inbox/chats/chat2.md");
    });

    it("includes modified transcripts even if previously processed", async () => {
      const originalContent = "Original content";
      const modifiedContent = "Modified content";
      await writeFile(join(chatsDir, "chat.md"), modifiedContent);

      const vault = createMockVault({
        id: "test-vault",
        path: vaultPath,
        contentRoot: vaultPath,
      });

      // Mark as processed with original checksum
      const state = createEmptyState();
      markTranscriptProcessed(
        state,
        "test-vault",
        "00_Inbox/chats/chat.md",
        calculateChecksum(originalContent) // Different from current content
      );

      const result = await discoverVaultTranscripts(vault, state);

      expect(result.total).toBe(1);
      expect(result.unprocessed).toHaveLength(1);
      expect(result.unprocessed[0].checksum).toBe(calculateChecksum(modifiedContent));
    });

    it("returns empty result when no transcripts exist", async () => {
      const vault = createMockVault({
        path: vaultPath,
        contentRoot: vaultPath,
      });
      const state = createEmptyState();
      const result = await discoverVaultTranscripts(vault, state);

      expect(result.total).toBe(0);
      expect(result.unprocessed).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("returns empty result when chats directory does not exist", async () => {
      const emptyVaultPath = join(tempDir, "empty-vault");
      await mkdir(emptyVaultPath);

      const vault = createMockVault({
        path: emptyVaultPath,
        contentRoot: emptyVaultPath,
      });
      const state = createEmptyState();
      const result = await discoverVaultTranscripts(vault, state);

      expect(result.total).toBe(0);
      expect(result.unprocessed).toHaveLength(0);
    });
  });
});

// =============================================================================
// Transcript Content Structure Tests
// =============================================================================

describe("DiscoveredTranscript structure", () => {
  let tempDir: string;
  let vaultPath: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "transcript-struct-test-"));
    vaultPath = join(tempDir, "test-vault");
    chatsDir = join(vaultPath, "00_Inbox", "chats");
    await mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("includes all required fields", async () => {
    await writeFile(join(chatsDir, "test.md"), SAMPLE_FRONTMATTER);

    const vault = createMockVault({
      id: "my-vault",
      path: vaultPath,
      contentRoot: vaultPath,
    });
    const transcript = await readTranscript(vault, "test.md");

    expect(transcript).toMatchObject({
      vaultId: "my-vault",
      path: "00_Inbox/chats/test.md",
      absolutePath: join(chatsDir, "test.md"),
    });
    expect(transcript?.content).toBeTruthy();
    expect(transcript?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(transcript?.body).toBeTruthy();
  });

  it("frontmatter is optional", async () => {
    await writeFile(join(chatsDir, "plain.md"), "Just some text");

    const vault = createMockVault({
      path: vaultPath,
      contentRoot: vaultPath,
    });
    const transcript = await readTranscript(vault, "plain.md");

    expect(transcript?.frontmatter).toBeUndefined();
    expect(transcript?.body).toBe("Just some text");
  });
});

// =============================================================================
// Real-world Transcript Format Tests
// =============================================================================

describe("real-world transcript formats", () => {
  const DISCUSSION_TRANSCRIPT = `---
date: 2026-01-18
time: "09:15"
session_id: d8f2e3c1-4567
title: "Working on memory extraction feature"
---

# Discussion - 2026-01-18 09:15

## [09:15] User

I want to implement a memory extraction feature that learns from our conversations.

## [09:16] Assistant

> **Tool:** Read
> File: \`docs/design.md\`
> ✓

I'll help you implement that. Let me first look at the existing design documents.

Based on the design, here's what I suggest:

1. Create an extraction pipeline
2. Store facts in a memory.md file
3. Use checksums for deduplication

## [09:18] User

That sounds good. Let's start with the pipeline.
`;

  it("parses discussion transcript with tool invocations", () => {
    const result = parseTranscriptContent(DISCUSSION_TRANSCRIPT);

    expect(result.frontmatter?.date).toBe("2026-01-18");
    expect(result.frontmatter?.time).toBe("09:15");
    expect(result.frontmatter?.session_id).toBe("d8f2e3c1-4567");
    expect(result.frontmatter?.title).toBe("Working on memory extraction feature");

    expect(result.body).toContain("## [09:15] User");
    expect(result.body).toContain("## [09:16] Assistant");
    expect(result.body).toContain("> **Tool:** Read");
    expect(result.body).toContain("## [09:18] User");
  });

  it("body preserves all conversation content", () => {
    const result = parseTranscriptContent(DISCUSSION_TRANSCRIPT);

    // User messages preserved
    expect(result.body).toContain("I want to implement a memory extraction feature");
    expect(result.body).toContain("That sounds good. Let's start with the pipeline.");

    // Assistant response preserved
    expect(result.body).toContain("I'll help you implement that");
    expect(result.body).toContain("1. Create an extraction pipeline");
    expect(result.body).toContain("2. Store facts in a memory.md file");
    expect(result.body).toContain("3. Use checksums for deduplication");
  });
});

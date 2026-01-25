/**
 * Transcript Manager Tests
 *
 * Unit tests for transcript file generation, message formatting, and file operations.
 * Uses filesystem with temp directories to test all scenarios.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VaultInfo, StoredToolInvocation } from "@memory-loop/shared";
import {
  getTranscriptsDirectory,
  generateTranscriptFilename,
  generateTranscriptFrontmatter,
  formatUserMessage,
  formatAssistantMessage,
  formatToolInvocation,
  initializeTranscript,
  appendToTranscript,
  ensureTranscriptsDirectory,
  TranscriptError,
} from "../transcript-manager";

// =============================================================================
// Filename Generation Tests
// =============================================================================

describe("generateTranscriptFilename", () => {
  test("generates filename with date, time, and short ID", () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const date = new Date(2026, 0, 16, 14, 30); // January 16, 2026 14:30
    const filename = generateTranscriptFilename(sessionId, date);
    expect(filename).toBe("2026-01-16-1430-550e8.md");
  });

  test("pads single-digit months and days", () => {
    const sessionId = "abc12345-defg";
    const date = new Date(2026, 0, 5, 9, 5); // January 5, 2026 09:05
    const filename = generateTranscriptFilename(sessionId, date);
    expect(filename).toBe("2026-01-05-0905-abc12.md");
  });

  test("handles midnight correctly", () => {
    const sessionId = "12345678";
    const date = new Date(2026, 5, 15, 0, 0); // June 15, 2026 00:00
    const filename = generateTranscriptFilename(sessionId, date);
    expect(filename).toBe("2026-06-15-0000-12345.md");
  });

  test("extracts first 5 characters of session ID", () => {
    const sessionId = "ABCDEFGHIJKLMNOP";
    const date = new Date(2026, 0, 16, 12, 0);
    const filename = generateTranscriptFilename(sessionId, date);
    expect(filename).toContain("abcde");
  });

  test("handles short session ID", () => {
    const sessionId = "abc";
    const date = new Date(2026, 0, 16, 12, 0);
    const filename = generateTranscriptFilename(sessionId, date);
    expect(filename).toContain("abc");
  });
});

// =============================================================================
// Frontmatter Generation Tests
// =============================================================================

describe("generateTranscriptFrontmatter", () => {
  test("generates valid YAML frontmatter", () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const firstMessage = "Help me understand how the widget system works";
    const date = new Date(2026, 0, 16, 14, 30);
    const frontmatter = generateTranscriptFrontmatter(sessionId, firstMessage, date);

    expect(frontmatter).toContain("---");
    expect(frontmatter).toContain("date: 2026-01-16");
    expect(frontmatter).toContain('time: "14:30"');
    expect(frontmatter).toContain(`session_id: ${sessionId}`);
    expect(frontmatter).toContain('title: "Help me understand how the widget system works"');
  });

  test("truncates long titles with ellipsis", () => {
    const sessionId = "test-session";
    const firstMessage = "A".repeat(100);
    const date = new Date(2026, 0, 16, 14, 30);
    const frontmatter = generateTranscriptFrontmatter(sessionId, firstMessage, date);

    // Should truncate to 59 chars + ellipsis = 60 total
    expect(frontmatter).toContain('"' + "A".repeat(59) + "…");
  });

  test("escapes quotes in title", () => {
    const sessionId = "test-session";
    const firstMessage = 'What does "hello world" mean?';
    const date = new Date(2026, 0, 16, 14, 30);
    const frontmatter = generateTranscriptFrontmatter(sessionId, firstMessage, date);

    expect(frontmatter).toContain('\\"hello world\\"');
  });

  test("uses first line only for multiline messages", () => {
    const sessionId = "test-session";
    const firstMessage = "First line\nSecond line\nThird line";
    const date = new Date(2026, 0, 16, 14, 30);
    const frontmatter = generateTranscriptFrontmatter(sessionId, firstMessage, date);

    expect(frontmatter).toContain('title: "First line"');
    expect(frontmatter).not.toContain("Second line");
  });

  test("includes Discussion heading", () => {
    const sessionId = "test-session";
    const firstMessage = "Test";
    const date = new Date(2026, 0, 16, 14, 30);
    const frontmatter = generateTranscriptFrontmatter(sessionId, firstMessage, date);

    expect(frontmatter).toContain("# Discussion - 2026-01-16 14:30");
  });
});

// =============================================================================
// User Message Formatting Tests
// =============================================================================

describe("formatUserMessage", () => {
  test("formats message with timestamp heading", () => {
    const content = "How do I configure widgets?";
    const timestamp = new Date(2026, 0, 16, 14, 30);
    const formatted = formatUserMessage(content, timestamp);

    expect(formatted).toContain("## [14:30] User");
    expect(formatted).toContain(content);
  });

  test("preserves multiline content", () => {
    const content = "Line 1\nLine 2\nLine 3";
    const timestamp = new Date(2026, 0, 16, 9, 15);
    const formatted = formatUserMessage(content, timestamp);

    expect(formatted).toContain("Line 1\nLine 2\nLine 3");
  });

  test("adds trailing newlines for separation", () => {
    const content = "Test message";
    const timestamp = new Date(2026, 0, 16, 12, 0);
    const formatted = formatUserMessage(content, timestamp);

    expect(formatted.endsWith("\n\n")).toBe(true);
  });
});

// =============================================================================
// Tool Invocation Formatting Tests
// =============================================================================

describe("formatToolInvocation", () => {
  test("formats basic tool invocation", () => {
    const tool: StoredToolInvocation = {
      toolUseId: "tool_123",
      toolName: "Read",
      status: "complete",
    };
    const formatted = formatToolInvocation(tool);

    expect(formatted).toContain("> **Tool:** Read");
    expect(formatted).toContain("> ✓");
  });

  test("shows running status with ellipsis", () => {
    const tool: StoredToolInvocation = {
      toolUseId: "tool_123",
      toolName: "Grep",
      status: "running",
    };
    const formatted = formatToolInvocation(tool);

    expect(formatted).toContain("> …");
  });

  test("includes pattern for tools with pattern input", () => {
    const tool: StoredToolInvocation = {
      toolUseId: "tool_123",
      toolName: "Glob",
      input: { pattern: "**/*.ts" },
      status: "complete",
    };
    const formatted = formatToolInvocation(tool);

    expect(formatted).toContain("> Pattern: `**/*.ts`");
  });

  test("includes file path for tools with file_path input", () => {
    const tool: StoredToolInvocation = {
      toolUseId: "tool_123",
      toolName: "Read",
      input: { file_path: "/src/index.ts" },
      status: "complete",
    };
    const formatted = formatToolInvocation(tool);

    expect(formatted).toContain("> File: `/src/index.ts`");
  });

  test("truncates long commands", () => {
    const longCommand = "npm run " + "very-long-argument ".repeat(10);
    const tool: StoredToolInvocation = {
      toolUseId: "tool_123",
      toolName: "Bash",
      input: { command: longCommand },
      status: "complete",
    };
    const formatted = formatToolInvocation(tool);

    expect(formatted).toContain("> Command:");
    expect(formatted).toContain("...");
    expect(formatted.length).toBeLessThan(longCommand.length + 100);
  });

  test("includes file count in output for completed searches", () => {
    const tool: StoredToolInvocation = {
      toolUseId: "tool_123",
      toolName: "Glob",
      input: { pattern: "**/*.ts" },
      output: "Found 12 files matching pattern",
      status: "complete",
    };
    const formatted = formatToolInvocation(tool);

    expect(formatted).toContain("Found 12 files");
  });
});

// =============================================================================
// Assistant Message Formatting Tests
// =============================================================================

describe("formatAssistantMessage", () => {
  test("formats message with timestamp heading", () => {
    const content = "I'll help you with that.";
    const timestamp = new Date(2026, 0, 16, 14, 31);
    const formatted = formatAssistantMessage(content, undefined, timestamp);

    expect(formatted).toContain("## [14:31] Assistant");
    expect(formatted).toContain(content);
  });

  test("includes tool invocations before content", () => {
    const content = "Here's what I found.";
    const tools: StoredToolInvocation[] = [
      {
        toolUseId: "tool_1",
        toolName: "Glob",
        input: { pattern: "*.ts" },
        status: "complete",
      },
    ];
    const timestamp = new Date(2026, 0, 16, 14, 31);
    const formatted = formatAssistantMessage(content, tools, timestamp);

    const toolIndex = formatted.indexOf("**Tool:** Glob");
    const contentIndex = formatted.indexOf("Here's what I found");
    expect(toolIndex).toBeLessThan(contentIndex);
  });

  test("handles multiple tool invocations", () => {
    const content = "Analysis complete.";
    const tools: StoredToolInvocation[] = [
      { toolUseId: "tool_1", toolName: "Glob", status: "complete" },
      { toolUseId: "tool_2", toolName: "Read", status: "complete" },
      { toolUseId: "tool_3", toolName: "Grep", status: "complete" },
    ];
    const timestamp = new Date(2026, 0, 16, 14, 31);
    const formatted = formatAssistantMessage(content, tools, timestamp);

    expect(formatted).toContain("**Tool:** Glob");
    expect(formatted).toContain("**Tool:** Read");
    expect(formatted).toContain("**Tool:** Grep");
  });

  test("handles empty content with tools", () => {
    const content = "";
    const tools: StoredToolInvocation[] = [
      { toolUseId: "tool_1", toolName: "Read", status: "running" },
    ];
    const timestamp = new Date(2026, 0, 16, 14, 31);
    const formatted = formatAssistantMessage(content, tools, timestamp);

    expect(formatted).toContain("## [14:31] Assistant");
    expect(formatted).toContain("**Tool:** Read");
  });

  test("handles empty tools array", () => {
    const content = "Here's my response.";
    const timestamp = new Date(2026, 0, 16, 14, 31);
    const formatted = formatAssistantMessage(content, [], timestamp);

    expect(formatted).toContain(content);
    expect(formatted).not.toContain("**Tool:**");
  });
});

// =============================================================================
// Directory Operations Tests
// =============================================================================

describe("getTranscriptsDirectory", () => {
  test("returns path under inbox/chats", () => {
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
    cardsEnabled: true,
    };
    const dir = getTranscriptsDirectory(vault);
    expect(dir).toBe("/vaults/test-vault/00_Inbox/chats");
  });

  test("handles custom inbox path", () => {
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
    cardsEnabled: true,
    };
    const dir = getTranscriptsDirectory(vault);
    expect(dir).toBe("/vaults/test-vault/Custom/Inbox/chats");
  });

  test("handles different content root", () => {
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
    cardsEnabled: true,
    };
    const dir = getTranscriptsDirectory(vault);
    expect(dir).toBe("/vaults/test-vault/content/00_Inbox/chats");
  });
});

// =============================================================================
// TranscriptError Tests
// =============================================================================

describe("TranscriptError", () => {
  test("has correct name property", () => {
    const error = new TranscriptError("Test message");
    expect(error.name).toBe("TranscriptError");
  });

  test("is instance of Error", () => {
    const error = new TranscriptError("Test message");
    expect(error).toBeInstanceOf(Error);
  });

  test("preserves error message", () => {
    const error = new TranscriptError("Custom error message");
    expect(error.message).toBe("Custom error message");
  });
});

// =============================================================================
// Integration Tests with Real Filesystem
// =============================================================================

describe("Transcript Integration", () => {
  let testDir: string;
  let vault: VaultInfo;

  beforeEach(async () => {
    // Create a unique test directory
    testDir = join(
      tmpdir(),
      `transcript-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    // Create vault structure
    vault = {
      id: "test-vault",
      name: "Test Vault",
      path: testDir,
      hasClaudeMd: true,
      contentRoot: testDir,
      inboxPath: "00_Inbox",
      metadataPath: "06_Metadata/memory-loop",
      attachmentPath: "05_Attachments",
      setupComplete: false,
      promptsPerGeneration: 5,
      maxPoolSize: 50,
      quotesPerWeek: 1,
      badges: [],
      order: 999999,
    cardsEnabled: true,
    };
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("ensureTranscriptsDirectory", () => {
    test("creates chats directory if not exists", async () => {
      const chatsDir = await ensureTranscriptsDirectory(vault);

      const { stat } = await import("node:fs/promises");
      const stats = await stat(chatsDir);
      expect(stats.isDirectory()).toBe(true);
    });

    test("returns path to chats directory", async () => {
      const chatsDir = await ensureTranscriptsDirectory(vault);

      expect(chatsDir).toBe(join(testDir, "00_Inbox/chats"));
    });

    test("is idempotent (can be called multiple times)", async () => {
      const path1 = await ensureTranscriptsDirectory(vault);
      const path2 = await ensureTranscriptsDirectory(vault);

      expect(path1).toBe(path2);
    });
  });

  describe("initializeTranscript", () => {
    test("creates transcript file with frontmatter", async () => {
      const sessionId = "550e8400-e29b-41d4-a716-446655440000";
      const firstMessage = "Help me understand widgets";
      const date = new Date(2026, 0, 16, 14, 30);

      const transcriptPath = await initializeTranscript(vault, sessionId, firstMessage, date);

      const content = await readFile(transcriptPath, "utf-8");
      expect(content).toContain("---");
      expect(content).toContain("date: 2026-01-16");
      expect(content).toContain('time: "14:30"');
      expect(content).toContain(`session_id: ${sessionId}`);
      expect(content).toContain("# Discussion - 2026-01-16 14:30");
    });

    test("returns absolute path to transcript", async () => {
      const sessionId = "test-session-123";
      const date = new Date(2026, 0, 16, 14, 30);

      const transcriptPath = await initializeTranscript(vault, sessionId, "Test", date);

      expect(transcriptPath).toContain(testDir);
      expect(transcriptPath).toContain("chats");
      expect(transcriptPath).toContain(".md");
    });

    test("creates parent directories if needed", async () => {
      const sessionId = "test-session-123";
      const date = new Date(2026, 0, 16, 14, 30);

      // No inbox or chats directory exists yet
      const transcriptPath = await initializeTranscript(vault, sessionId, "Test", date);

      // Verify file exists by reading it (throws if not found)
      const content = await readFile(transcriptPath, "utf-8");
      expect(content).toContain("---");
    });
  });

  describe("appendToTranscript", () => {
    test("appends content to existing transcript", async () => {
      const sessionId = "test-session-123";
      const date = new Date(2026, 0, 16, 14, 30);

      // Initialize transcript
      const transcriptPath = await initializeTranscript(vault, sessionId, "Initial question", date);

      // Append user message
      const userContent = formatUserMessage("How do I configure this?", date);
      await appendToTranscript(transcriptPath, userContent);

      const content = await readFile(transcriptPath, "utf-8");
      expect(content).toContain("## [14:30] User");
      expect(content).toContain("How do I configure this?");
    });

    test("appends multiple messages in order", async () => {
      const sessionId = "test-session-123";
      const date1 = new Date(2026, 0, 16, 14, 30);
      const date2 = new Date(2026, 0, 16, 14, 31);
      const date3 = new Date(2026, 0, 16, 14, 32);

      const transcriptPath = await initializeTranscript(vault, sessionId, "Question", date1);

      await appendToTranscript(transcriptPath, formatUserMessage("Question", date1));
      await appendToTranscript(transcriptPath, formatAssistantMessage("Answer", undefined, date2));
      await appendToTranscript(transcriptPath, formatUserMessage("Follow-up", date3));

      const content = await readFile(transcriptPath, "utf-8");

      // Check order
      const q1Index = content.indexOf("Question");
      const ansIndex = content.indexOf("Answer");
      const q2Index = content.lastIndexOf("Follow-up");

      expect(q1Index).toBeLessThan(ansIndex);
      expect(ansIndex).toBeLessThan(q2Index);
    });

    test("preserves tool invocations in transcript", async () => {
      const sessionId = "test-session-123";
      const date = new Date(2026, 0, 16, 14, 30);

      const transcriptPath = await initializeTranscript(vault, sessionId, "Test", date);

      const tools: StoredToolInvocation[] = [
        {
          toolUseId: "tool_1",
          toolName: "Glob",
          input: { pattern: "**/*.ts" },
          output: "Found 15 files",
          status: "complete",
        },
      ];
      const assistantContent = formatAssistantMessage("Here are the files.", tools, date);
      await appendToTranscript(transcriptPath, assistantContent);

      const content = await readFile(transcriptPath, "utf-8");
      expect(content).toContain("**Tool:** Glob");
      expect(content).toContain("Pattern: `**/*.ts`");
      expect(content).toContain("Found 15 files");
    });
  });

  describe("Full conversation flow", () => {
    test("creates complete transcript with conversation", async () => {
      const sessionId = "550e8400-e29b-41d4-a716-446655440000";
      const userTime = new Date(2026, 0, 16, 14, 30);
      const assistantTime = new Date(2026, 0, 16, 14, 31);

      // Initialize transcript
      const userQuestion = "Help me understand how the widget system works";
      const transcriptPath = await initializeTranscript(vault, sessionId, userQuestion, userTime);

      // Append user message
      await appendToTranscript(transcriptPath, formatUserMessage(userQuestion, userTime));

      // Append assistant response with tools
      const tools: StoredToolInvocation[] = [
        {
          toolUseId: "tool_1",
          toolName: "Glob",
          input: { pattern: "**/widget*.ts" },
          output: "Found 12 files",
          status: "complete",
        },
      ];
      const assistantResponse = "The widget system has the following architecture...";
      await appendToTranscript(
        transcriptPath,
        formatAssistantMessage(assistantResponse, tools, assistantTime)
      );

      // Read and verify complete transcript
      const content = await readFile(transcriptPath, "utf-8");

      // Verify frontmatter
      expect(content).toContain("---");
      expect(content).toContain("date: 2026-01-16");
      expect(content).toContain('time: "14:30"');
      expect(content).toContain(`session_id: ${sessionId}`);

      // Verify user message
      expect(content).toContain("## [14:30] User");
      expect(content).toContain(userQuestion);

      // Verify assistant message with tools
      expect(content).toContain("## [14:31] Assistant");
      expect(content).toContain("**Tool:** Glob");
      expect(content).toContain(assistantResponse);
    });
  });
});

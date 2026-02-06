/**
 * Extraction State Tests
 *
 * Tests for extraction state persistence, checksum calculation,
 * and transcript tracking utilities.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_STATE_PATH,
  ProcessedTranscriptSchema,
  ExtractionStateSchema,
  createEmptyState,
  calculateChecksum,
  isTranscriptProcessed,
  findUnprocessedTranscripts,
  readExtractionState,
  writeExtractionState,
  markTranscriptProcessed,
  updateLastRunAt,
  parseExtractionState,
  safeParseExtractionState,
  formatExtractionStateError,
  type ExtractionState,
} from "../extraction-state";
import { z } from "zod";

describe("extraction-state", () => {
  let testDir: string;
  let testStatePath: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `extraction-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    testStatePath = join(testDir, "extraction-state.json");
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("DEFAULT_STATE_PATH", () => {
    test("points to config directory in user home", () => {
      expect(DEFAULT_STATE_PATH).toContain(".config");
      expect(DEFAULT_STATE_PATH).toContain("memory-loop");
      expect(DEFAULT_STATE_PATH).toEndWith("extraction-state.json");
    });
  });

  describe("ProcessedTranscriptSchema", () => {
    test("accepts valid transcript record", () => {
      const record = {
        path: "chats/2026-01-18.md",
        vaultId: "vault-123",
        checksum: "a".repeat(64),
        processedAt: "2026-01-18T10:30:00.000Z",
      };

      const result = ProcessedTranscriptSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    test("rejects empty path", () => {
      const record = {
        path: "",
        vaultId: "vault-123",
        checksum: "a".repeat(64),
        processedAt: "2026-01-18T10:30:00.000Z",
      };

      const result = ProcessedTranscriptSchema.safeParse(record);
      expect(result.success).toBe(false);
    });

    test("rejects empty vaultId", () => {
      const record = {
        path: "chats/transcript.md",
        vaultId: "",
        checksum: "a".repeat(64),
        processedAt: "2026-01-18T10:30:00.000Z",
      };

      const result = ProcessedTranscriptSchema.safeParse(record);
      expect(result.success).toBe(false);
    });

    test("rejects invalid checksum length", () => {
      const record = {
        path: "chats/transcript.md",
        vaultId: "vault-123",
        checksum: "abc123", // Too short
        processedAt: "2026-01-18T10:30:00.000Z",
      };

      const result = ProcessedTranscriptSchema.safeParse(record);
      expect(result.success).toBe(false);
    });

    test("rejects invalid checksum characters", () => {
      const record = {
        path: "chats/transcript.md",
        vaultId: "vault-123",
        checksum: "g".repeat(64), // 'g' is not hex
        processedAt: "2026-01-18T10:30:00.000Z",
      };

      const result = ProcessedTranscriptSchema.safeParse(record);
      expect(result.success).toBe(false);
    });

    test("rejects invalid timestamp format", () => {
      const record = {
        path: "chats/transcript.md",
        vaultId: "vault-123",
        checksum: "a".repeat(64),
        processedAt: "not a timestamp",
      };

      const result = ProcessedTranscriptSchema.safeParse(record);
      expect(result.success).toBe(false);
    });
  });

  describe("ExtractionStateSchema", () => {
    test("accepts valid state with lastRunAt", () => {
      const state = {
        lastRunAt: "2026-01-18T10:30:00.000Z",
        processedTranscripts: [],
      };

      const result = ExtractionStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    test("accepts valid state with null lastRunAt", () => {
      const state = {
        lastRunAt: null,
        processedTranscripts: [],
      };

      const result = ExtractionStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    test("accepts state with transcripts", () => {
      const state = {
        lastRunAt: "2026-01-18T10:30:00.000Z",
        processedTranscripts: [
          {
            path: "chats/2026-01-18.md",
            vaultId: "vault-123",
            checksum: "a".repeat(64),
            processedAt: "2026-01-18T10:30:00.000Z",
          },
        ],
      };

      const result = ExtractionStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    test("rejects state with invalid transcript", () => {
      const state = {
        lastRunAt: null,
        processedTranscripts: [
          {
            path: "", // Invalid
            vaultId: "vault-123",
            checksum: "a".repeat(64),
            processedAt: "2026-01-18T10:30:00.000Z",
          },
        ],
      };

      const result = ExtractionStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });

    test("rejects undefined lastRunAt", () => {
      const state = {
        lastRunAt: undefined,
        processedTranscripts: [],
      };

      const result = ExtractionStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });
  });

  describe("createEmptyState", () => {
    test("returns state with null lastRunAt", () => {
      const state = createEmptyState();
      expect(state.lastRunAt).toBeNull();
    });

    test("returns state with empty processedTranscripts", () => {
      const state = createEmptyState();
      expect(state.processedTranscripts).toEqual([]);
    });

    test("returns valid state per schema", () => {
      const state = createEmptyState();
      const result = ExtractionStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });
  });

  describe("calculateChecksum", () => {
    test("returns 64-character hex string", () => {
      const checksum = calculateChecksum("test content");
      expect(checksum).toHaveLength(64);
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    test("returns consistent checksum for same content", () => {
      const content = "Hello, World!";
      const checksum1 = calculateChecksum(content);
      const checksum2 = calculateChecksum(content);
      expect(checksum1).toBe(checksum2);
    });

    test("returns different checksum for different content", () => {
      const checksum1 = calculateChecksum("content A");
      const checksum2 = calculateChecksum("content B");
      expect(checksum1).not.toBe(checksum2);
    });

    test("handles empty string", () => {
      const checksum = calculateChecksum("");
      expect(checksum).toHaveLength(64);
      // SHA-256 of empty string is a known value
      expect(checksum).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });

    test("handles unicode content", () => {
      const checksum = calculateChecksum("Hello, !");
      expect(checksum).toHaveLength(64);
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    test("handles multi-line content", () => {
      const content = "Line 1\nLine 2\nLine 3";
      const checksum = calculateChecksum(content);
      expect(checksum).toHaveLength(64);
    });
  });

  describe("isTranscriptProcessed", () => {
    test("returns false for empty state", () => {
      const state = createEmptyState();
      const result = isTranscriptProcessed(state, "vault-1", "path/to/file.md", "a".repeat(64));
      expect(result).toBe(false);
    });

    test("returns false for untracked transcript", () => {
      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "other/file.md",
            vaultId: "vault-1",
            checksum: "a".repeat(64),
            processedAt: "2026-01-18T10:00:00.000Z",
          },
        ],
      };

      const result = isTranscriptProcessed(state, "vault-1", "path/to/file.md", "a".repeat(64));
      expect(result).toBe(false);
    });

    test("returns false for different vault", () => {
      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "path/to/file.md",
            vaultId: "vault-1",
            checksum: "a".repeat(64),
            processedAt: "2026-01-18T10:00:00.000Z",
          },
        ],
      };

      const result = isTranscriptProcessed(state, "vault-2", "path/to/file.md", "a".repeat(64));
      expect(result).toBe(false);
    });

    test("returns false when checksum differs", () => {
      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "path/to/file.md",
            vaultId: "vault-1",
            checksum: "a".repeat(64),
            processedAt: "2026-01-18T10:00:00.000Z",
          },
        ],
      };

      const result = isTranscriptProcessed(state, "vault-1", "path/to/file.md", "b".repeat(64));
      expect(result).toBe(false);
    });

    test("returns true when transcript matches with same checksum", () => {
      const checksum = "a".repeat(64);
      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "path/to/file.md",
            vaultId: "vault-1",
            checksum,
            processedAt: "2026-01-18T10:00:00.000Z",
          },
        ],
      };

      const result = isTranscriptProcessed(state, "vault-1", "path/to/file.md", checksum);
      expect(result).toBe(true);
    });
  });

  describe("findUnprocessedTranscripts", () => {
    test("returns all transcripts for empty state", () => {
      const state = createEmptyState();
      const transcripts = [
        { vaultId: "vault-1", path: "file1.md", content: "content 1" },
        { vaultId: "vault-1", path: "file2.md", content: "content 2" },
      ];

      const result = findUnprocessedTranscripts(state, transcripts);
      expect(result).toHaveLength(2);
    });

    test("filters out already processed transcripts", () => {
      const content1 = "content 1";
      const checksum1 = calculateChecksum(content1);

      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "file1.md",
            vaultId: "vault-1",
            checksum: checksum1,
            processedAt: "2026-01-18T10:00:00.000Z",
          },
        ],
      };

      const transcripts = [
        { vaultId: "vault-1", path: "file1.md", content: content1 },
        { vaultId: "vault-1", path: "file2.md", content: "content 2" },
      ];

      const result = findUnprocessedTranscripts(state, transcripts);
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("file2.md");
    });

    test("includes transcripts with changed content", () => {
      const originalContent = "original content";
      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "file1.md",
            vaultId: "vault-1",
            checksum: calculateChecksum(originalContent),
            processedAt: "2026-01-18T10:00:00.000Z",
          },
        ],
      };

      const transcripts = [
        { vaultId: "vault-1", path: "file1.md", content: "modified content" },
      ];

      const result = findUnprocessedTranscripts(state, transcripts);
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("file1.md");
    });

    test("handles multiple vaults correctly", () => {
      const content = "same content";
      const checksum = calculateChecksum(content);

      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "file.md",
            vaultId: "vault-1",
            checksum,
            processedAt: "2026-01-18T10:00:00.000Z",
          },
        ],
      };

      const transcripts = [
        { vaultId: "vault-1", path: "file.md", content }, // Already processed
        { vaultId: "vault-2", path: "file.md", content }, // Different vault, unprocessed
      ];

      const result = findUnprocessedTranscripts(state, transcripts);
      expect(result).toHaveLength(1);
      expect(result[0].vaultId).toBe("vault-2");
    });

    test("returns empty array when all processed", () => {
      const content = "content";
      const checksum = calculateChecksum(content);

      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "file.md",
            vaultId: "vault-1",
            checksum,
            processedAt: "2026-01-18T10:00:00.000Z",
          },
        ],
      };

      const transcripts = [{ vaultId: "vault-1", path: "file.md", content }];

      const result = findUnprocessedTranscripts(state, transcripts);
      expect(result).toHaveLength(0);
    });
  });

  describe("readExtractionState", () => {
    test("returns empty state when file does not exist", async () => {
      const state = await readExtractionState(testStatePath);
      expect(state).toEqual(createEmptyState());
    });

    test("reads valid state file", async () => {
      const stateData: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "chats/test.md",
            vaultId: "vault-123",
            checksum: "a".repeat(64),
            processedAt: "2026-01-18T09:00:00.000Z",
          },
        ],
      };
      await writeFile(testStatePath, JSON.stringify(stateData));

      const state = await readExtractionState(testStatePath);
      expect(state).toEqual(stateData);
    });

    test("returns empty state for invalid JSON", async () => {
      await writeFile(testStatePath, "{ invalid json }");

      const state = await readExtractionState(testStatePath);
      expect(state).toEqual(createEmptyState());
    });

    test("returns empty state for non-object JSON", async () => {
      await writeFile(testStatePath, '"just a string"');

      const state = await readExtractionState(testStatePath);
      expect(state).toEqual(createEmptyState());
    });

    test("returns empty state for schema validation failure", async () => {
      const invalidState = {
        lastRunAt: "not a timestamp",
        processedTranscripts: [],
      };
      await writeFile(testStatePath, JSON.stringify(invalidState));

      const state = await readExtractionState(testStatePath);
      expect(state).toEqual(createEmptyState());
    });

    test("returns empty state for null JSON", async () => {
      await writeFile(testStatePath, "null");

      const state = await readExtractionState(testStatePath);
      expect(state).toEqual(createEmptyState());
    });
  });

  describe("writeExtractionState", () => {
    test("creates state file and parent directories", async () => {
      const nestedPath = join(testDir, "nested", "dir", "state.json");
      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [],
      };

      await writeExtractionState(state, nestedPath);

      const content = await readFile(nestedPath, "utf-8");
      const parsed = JSON.parse(content) as ExtractionState;
      expect(parsed).toEqual(state);
    });

    test("writes valid state file", async () => {
      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "chats/test.md",
            vaultId: "vault-123",
            checksum: "b".repeat(64),
            processedAt: "2026-01-18T09:00:00.000Z",
          },
        ],
      };

      await writeExtractionState(state, testStatePath);

      const content = await readFile(testStatePath, "utf-8");
      const parsed = JSON.parse(content) as ExtractionState;
      expect(parsed).toEqual(state);
    });

    test("overwrites existing state file", async () => {
      const oldState: ExtractionState = {
        lastRunAt: "2026-01-17T10:00:00.000Z",
        processedTranscripts: [],
      };
      await writeFile(testStatePath, JSON.stringify(oldState));

      const newState: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "new.md",
            vaultId: "vault-1",
            checksum: "c".repeat(64),
            processedAt: "2026-01-18T10:00:00.000Z",
          },
        ],
      };

      await writeExtractionState(newState, testStatePath);

      const content = await readFile(testStatePath, "utf-8");
      const parsed = JSON.parse(content) as ExtractionState;
      expect(parsed).toEqual(newState);
    });

    test("writes pretty-printed JSON with trailing newline", async () => {
      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [],
      };

      await writeExtractionState(state, testStatePath);

      const content = await readFile(testStatePath, "utf-8");
      expect(content).toContain("\n");
      expect(content.endsWith("\n")).toBe(true);
    });

    test("throws error for invalid state", () => {
      const invalidState = {
        lastRunAt: "not a timestamp",
        processedTranscripts: [],
      } as unknown as ExtractionState;

      expect(writeExtractionState(invalidState, testStatePath)).rejects.toThrow(
        "Invalid extraction state"
      );
    });

    test("cleans up temp file on write failure", async () => {
      // Create a directory at the target path to cause write failure
      const dirPath = join(testDir, "blocked-file");
      await mkdir(dirPath);

      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [],
      };

      // Use try/catch pattern to handle rejected promise
      let didThrow = false;
      try {
        await writeExtractionState(state, dirPath);
      } catch {
        didThrow = true;
      }
      expect(didThrow).toBe(true);

      // Verify no temp files left behind
      const { readdirSync } = await import("node:fs");
      const files = readdirSync(testDir);
      const tempFiles = files.filter((f) => f.includes(".tmp"));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe("markTranscriptProcessed", () => {
    test("adds new transcript to empty state", () => {
      const state = createEmptyState();
      const checksum = "d".repeat(64);

      markTranscriptProcessed(state, "vault-1", "file.md", checksum);

      expect(state.processedTranscripts).toHaveLength(1);
      expect(state.processedTranscripts[0].path).toBe("file.md");
      expect(state.processedTranscripts[0].vaultId).toBe("vault-1");
      expect(state.processedTranscripts[0].checksum).toBe(checksum);
    });

    test("updates existing transcript record", () => {
      const oldChecksum = "e".repeat(64);
      const newChecksum = "f".repeat(64);

      const state: ExtractionState = {
        lastRunAt: null,
        processedTranscripts: [
          {
            path: "file.md",
            vaultId: "vault-1",
            checksum: oldChecksum,
            processedAt: "2026-01-17T10:00:00.000Z",
          },
        ],
      };

      markTranscriptProcessed(state, "vault-1", "file.md", newChecksum);

      expect(state.processedTranscripts).toHaveLength(1);
      expect(state.processedTranscripts[0].checksum).toBe(newChecksum);
      expect(state.processedTranscripts[0].processedAt).not.toBe("2026-01-17T10:00:00.000Z");
    });

    test("handles same path in different vaults", () => {
      const state = createEmptyState();

      markTranscriptProcessed(state, "vault-1", "file.md", "a".repeat(64));
      markTranscriptProcessed(state, "vault-2", "file.md", "b".repeat(64));

      expect(state.processedTranscripts).toHaveLength(2);
      expect(state.processedTranscripts[0].vaultId).toBe("vault-1");
      expect(state.processedTranscripts[1].vaultId).toBe("vault-2");
    });

    test("returns the same state reference", () => {
      const state = createEmptyState();
      const result = markTranscriptProcessed(state, "vault-1", "file.md", "a".repeat(64));
      expect(result).toBe(state);
    });

    test("sets processedAt to current ISO timestamp", () => {
      const state = createEmptyState();
      const before = new Date().toISOString();

      markTranscriptProcessed(state, "vault-1", "file.md", "a".repeat(64));

      const after = new Date().toISOString();
      const processedAt = state.processedTranscripts[0].processedAt;

      expect(processedAt >= before).toBe(true);
      expect(processedAt <= after).toBe(true);
    });
  });

  describe("updateLastRunAt", () => {
    test("updates null lastRunAt", () => {
      const state = createEmptyState();
      expect(state.lastRunAt).toBeNull();

      updateLastRunAt(state);

      expect(state.lastRunAt).not.toBeNull();
    });

    test("updates existing lastRunAt", () => {
      const state: ExtractionState = {
        lastRunAt: "2026-01-17T10:00:00.000Z",
        processedTranscripts: [],
      };

      updateLastRunAt(state);

      expect(state.lastRunAt).not.toBe("2026-01-17T10:00:00.000Z");
    });

    test("returns the same state reference", () => {
      const state = createEmptyState();
      const result = updateLastRunAt(state);
      expect(result).toBe(state);
    });

    test("sets lastRunAt to valid ISO timestamp", () => {
      const state = createEmptyState();
      const before = new Date().toISOString();

      updateLastRunAt(state);

      const after = new Date().toISOString();
      expect(state.lastRunAt! >= before).toBe(true);
      expect(state.lastRunAt! <= after).toBe(true);
    });
  });

  describe("parseExtractionState", () => {
    test("parses valid state", () => {
      const data = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [],
      };

      const result = parseExtractionState(data);
      expect(result).toEqual(data);
    });

    test("throws ZodError for invalid state", () => {
      const data = {
        lastRunAt: "invalid",
        processedTranscripts: [],
      };

      expect(() => parseExtractionState(data)).toThrow(z.ZodError);
    });
  });

  describe("safeParseExtractionState", () => {
    test("returns success for valid state", () => {
      const data = {
        lastRunAt: null,
        processedTranscripts: [],
      };

      const result = safeParseExtractionState(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(data);
      }
    });

    test("returns failure for invalid state", () => {
      const data = {
        lastRunAt: "invalid",
        processedTranscripts: [],
      };

      const result = safeParseExtractionState(data);
      expect(result.success).toBe(false);
    });
  });

  describe("formatExtractionStateError", () => {
    test("formats single error", () => {
      const result = safeParseExtractionState({
        lastRunAt: "invalid",
        processedTranscripts: [],
      });

      if (!result.success) {
        const message = formatExtractionStateError(result.error);
        expect(message).toContain("Invalid extraction state");
        expect(message).toContain("lastRunAt");
      } else {
        throw new Error("Expected validation to fail");
      }
    });

    test("formats multiple errors", () => {
      const result = safeParseExtractionState({
        lastRunAt: "invalid",
        processedTranscripts: [
          {
            path: "",
            vaultId: "",
            checksum: "short",
            processedAt: "invalid",
          },
        ],
      });

      if (!result.success) {
        const message = formatExtractionStateError(result.error);
        expect(message).toContain("Invalid extraction state");
        // Should have multiple error lines
        const lines = message.split("\n").filter((l) => l.trim().startsWith("-"));
        expect(lines.length).toBeGreaterThan(1);
      } else {
        throw new Error("Expected validation to fail");
      }
    });
  });

  describe("round-trip persistence", () => {
    test("state survives write and read cycle", async () => {
      const state: ExtractionState = {
        lastRunAt: "2026-01-18T10:00:00.000Z",
        processedTranscripts: [
          {
            path: "chats/conversation-1.md",
            vaultId: "main-vault",
            checksum: calculateChecksum("transcript content 1"),
            processedAt: "2026-01-18T09:30:00.000Z",
          },
          {
            path: "chats/conversation-2.md",
            vaultId: "main-vault",
            checksum: calculateChecksum("transcript content 2"),
            processedAt: "2026-01-18T09:45:00.000Z",
          },
          {
            path: "chats/daily.md",
            vaultId: "work-vault",
            checksum: calculateChecksum("work notes"),
            processedAt: "2026-01-18T10:00:00.000Z",
          },
        ],
      };

      await writeExtractionState(state, testStatePath);
      const loaded = await readExtractionState(testStatePath);

      expect(loaded).toEqual(state);
    });

    test("empty state survives write and read cycle", async () => {
      const state = createEmptyState();

      await writeExtractionState(state, testStatePath);
      const loaded = await readExtractionState(testStatePath);

      expect(loaded).toEqual(state);
    });
  });
});

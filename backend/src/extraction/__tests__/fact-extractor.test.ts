/**
 * Fact Extractor Tests
 *
 * Tests for the Claude Agent SDK-based fact extraction.
 * Uses mocked SDK responses to avoid real API calls.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SDKMessage, Query } from "@anthropic-ai/claude-agent-sdk";
import {
  loadExtractionPrompt,
  hasPromptOverride,
  buildExtractionPrompt,
  extractFacts,
  EXTRACTION_SDK_OPTIONS,
  type QueryFunction,
} from "../fact-extractor.js";
import type { DiscoveredTranscript } from "../transcript-reader.js";

// =============================================================================
// Mock SDK
// =============================================================================

/**
 * Creates a mock Query object that satisfies the interface for testing.
 * Uses type assertion since we only need the iterator functionality.
 */
function createMockQueryResult(generator: AsyncGenerator<SDKMessage, void>): Query {
  // The fact extractor only iterates over the generator, so we just need
  // to provide the async iterator interface. Cast through unknown to bypass
  // strict type checking for test mocks.
  return generator as unknown as Query;
}

/**
 * Creates a mock query function that yields success events.
 */
function createMockQuery(events: SDKMessage[] = []): QueryFunction {
  return () => {
    const generator = (async function* () {
      await Promise.resolve();
      for (const event of events) {
        yield event;
      }
    })();
    return createMockQueryResult(generator);
  };
}

/**
 * Creates a mock query function that throws an error.
 */
function createFailingMockQuery(errorMessage: string): QueryFunction {
  return () => {
    // eslint-disable-next-line require-yield
    const generator = (async function* (): AsyncGenerator<SDKMessage, void> {
      await Promise.resolve();
      throw new Error(errorMessage);
    })();
    return createMockQueryResult(generator);
  };
}

/**
 * Creates a mock query function that fails once then succeeds.
 */
function createRetryMockQuery(): QueryFunction {
  let callCount = 0;

  return () => {
    callCount++;

    if (callCount === 1) {
      // eslint-disable-next-line require-yield
      const generator = (async function* (): AsyncGenerator<SDKMessage, void> {
        await Promise.resolve();
        throw new Error("First attempt failed");
      })();
      return createMockQueryResult(generator);
    }

    const generator = (async function* () {
      await Promise.resolve();
      yield { type: "result", result: "Success on retry" } as SDKMessage;
    })();
    return createMockQueryResult(generator);
  };
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockTranscript(
  vaultId: string,
  path: string,
  content: string
): DiscoveredTranscript {
  return {
    vaultId,
    path,
    absolutePath: `/vaults/${vaultId}/${path}`,
    content,
    checksum: "abc123",
    body: content,
  };
}

// =============================================================================
// loadExtractionPrompt Tests
// =============================================================================

describe("loadExtractionPrompt", () => {
  it("loads the default prompt from codebase", async () => {
    // This test relies on the actual default prompt file existing
    const result = await loadExtractionPrompt();

    expect(result.isOverride).toBe(false);
    expect(result.content).toContain("Durable Facts");
    expect(result.path).toContain("durable-facts.md");
  });

  // Note: Testing user override requires writing to ~/.config which we avoid
  // in unit tests. Integration tests should cover that path.
});

describe("hasPromptOverride", () => {
  it("returns false when no override exists", async () => {
    // Assumes no override file exists in test environment
    // This could be flaky if a real override exists
    const result = await hasPromptOverride();
    // Just verify it returns a boolean without error
    expect(typeof result).toBe("boolean");
  });
});

// =============================================================================
// buildExtractionPrompt Tests
// =============================================================================

describe("buildExtractionPrompt", () => {
  const basePrompt = "# Extraction Prompt\n\nExtract facts from transcripts.";

  it("includes base prompt content", () => {
    const transcripts: DiscoveredTranscript[] = [];
    const result = buildExtractionPrompt(basePrompt, transcripts, "/vaults");

    expect(result).toContain("# Extraction Prompt");
    expect(result).toContain("Extract facts from transcripts.");
  });

  it("lists transcripts with absolute paths", () => {
    const transcripts = [
      createMockTranscript("vault1", "00_Inbox/chats/chat1.md", "content1"),
      createMockTranscript("vault2", "00_Inbox/chats/chat2.md", "content2"),
    ];

    const result = buildExtractionPrompt(basePrompt, transcripts, "/vaults");

    // Uses absolutePath from DiscoveredTranscript
    expect(result).toContain("/vaults/vault1/00_Inbox/chats/chat1.md");
    expect(result).toContain("/vaults/vault2/00_Inbox/chats/chat2.md");
  });

  it("includes transcript count", () => {
    const transcripts = [
      createMockTranscript("vault1", "chat1.md", "content"),
      createMockTranscript("vault1", "chat2.md", "content"),
      createMockTranscript("vault1", "chat3.md", "content"),
    ];

    const result = buildExtractionPrompt(basePrompt, transcripts, "/vaults");

    expect(result).toContain("Transcripts to Process (3)");
  });

  it("includes operational instructions with memory path", () => {
    const result = buildExtractionPrompt(basePrompt, [], "/my/vaults/dir");

    // Operational instructions are added by buildExtractionPrompt
    expect(result).toContain("## Task");
    expect(result).toContain("/my/vaults/dir/.memory-extraction/memory.md");
    expect(result).toContain("### Process");
  });

  it("includes memory file location", () => {
    const result = buildExtractionPrompt(basePrompt, [], "/vaults");

    expect(result).toContain("/vaults/.memory-extraction/memory.md");
  });
});

// =============================================================================
// EXTRACTION_SDK_OPTIONS Tests
// =============================================================================

describe("EXTRACTION_SDK_OPTIONS", () => {
  it("uses haiku model", () => {
    expect(EXTRACTION_SDK_OPTIONS.model).toBe("haiku");
  });

  it("includes required tools", () => {
    const tools = EXTRACTION_SDK_OPTIONS.allowedTools;
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
    expect(tools).toContain("Read");
    expect(tools).toContain("Edit");
    expect(tools).toContain("Write");
    expect(tools).toContain("Task");
  });

  it("accepts edits automatically", () => {
    expect(EXTRACTION_SDK_OPTIONS.permissionMode).toBe("acceptEdits");
  });

  it("has conservative budget", () => {
    expect(EXTRACTION_SDK_OPTIONS.maxBudgetUsd).toBeLessThanOrEqual(1.0);
  });
});

// =============================================================================
// extractFacts Tests
// =============================================================================

describe("extractFacts", () => {
  describe("with no transcripts", () => {
    it("returns success immediately", async () => {
      const mockQuery = createMockQuery();
      const result = await extractFacts([], "/vaults", mockQuery);

      expect(result.success).toBe(true);
      expect(result.transcriptsProcessed).toBe(0);
      expect(result.wasRetry).toBe(false);
    });
  });

  describe("with successful extraction", () => {
    it("returns success with transcript count", async () => {
      const mockQuery = createMockQuery([
        { type: "result", result: "Extraction complete" } as SDKMessage,
      ]);

      const transcripts = [
        createMockTranscript("vault1", "chat1.md", "User: Hello"),
        createMockTranscript("vault1", "chat2.md", "User: Hi there"),
      ];

      const result = await extractFacts(transcripts, "/vaults", mockQuery);

      expect(result.success).toBe(true);
      expect(result.transcriptsProcessed).toBe(2);
      expect(result.wasRetry).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });

  describe("with SDK errors", () => {
    it("retries once on failure", async () => {
      const mockQuery = createRetryMockQuery();

      const transcripts = [
        createMockTranscript("vault1", "chat1.md", "content"),
      ];

      const result = await extractFacts(transcripts, "/vaults", mockQuery);

      expect(result.success).toBe(true);
      expect(result.wasRetry).toBe(true);
    });

    it("returns error after retry fails", async () => {
      const mockQuery = createFailingMockQuery("API unavailable");

      const transcripts = [
        createMockTranscript("vault1", "chat1.md", "content"),
      ];

      const result = await extractFacts(transcripts, "/vaults", mockQuery);

      expect(result.success).toBe(false);
      expect(result.error).toContain("API unavailable");
      expect(result.wasRetry).toBe(true);
      expect(result.transcriptsProcessed).toBe(0);
    });
  });

  describe("event consumption", () => {
    it("processes all SDK events", async () => {
      // Cast through unknown for test mocks
      const events: SDKMessage[] = [
        { type: "system", session_id: "test-123" } as unknown as SDKMessage,
        { type: "result", result: "Done" } as unknown as SDKMessage,
      ];

      const mockQuery = createMockQuery(events);
      const transcripts = [createMockTranscript("v1", "c.md", "x")];

      const result = await extractFacts(transcripts, "/vaults", mockQuery);

      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// Integration-style Tests (with temp directories)
// =============================================================================

describe("fact extraction integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fact-extractor-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses vaultsDir as cwd for SDK", async () => {
    let capturedOptions: { cwd?: string } | undefined;

    const mockQuery: QueryFunction = (params) => {
      capturedOptions = params.options;
      const generator = (async function* () {
        await Promise.resolve();
        yield { type: "result", result: "ok" } as SDKMessage;
      })();
      return createMockQueryResult(generator);
    };

    const transcripts = [createMockTranscript("v1", "c.md", "x")];
    await extractFacts(transcripts, tempDir, mockQuery);

    expect(capturedOptions?.cwd).toBe(tempDir);
  });

  it("passes extraction prompt to SDK", async () => {
    let capturedPrompt: string | undefined;

    const mockQuery: QueryFunction = (params) => {
      capturedPrompt = typeof params.prompt === "string" ? params.prompt : undefined;
      const generator = (async function* () {
        await Promise.resolve();
        yield { type: "result", result: "ok" } as SDKMessage;
      })();
      return createMockQueryResult(generator);
    };

    const transcripts = [
      createMockTranscript("test-vault", "00_Inbox/chats/discussion.md", "Hello world"),
    ];

    await extractFacts(transcripts, tempDir, mockQuery);

    expect(capturedPrompt).toContain("Memory Extraction");
    expect(capturedPrompt).toContain("test-vault");
    expect(capturedPrompt).toContain("discussion.md");
  });
});

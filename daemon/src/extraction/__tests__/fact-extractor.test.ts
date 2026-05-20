/**
 * Fact Extractor Tests
 *
 * Tests for the pi-agent-based fact extraction.
 * Injects a mock session factory to avoid real API calls.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  loadExtractionPrompt,
  hasPromptOverride,
  buildExtractionPrompt,
  extractFacts,
  _finalText,
  type CreateSessionFn,
} from "../fact-extractor";
import type { DiscoveredTranscript } from "../transcript-reader";
import type { PiSessionOptions, PiSessionResult } from "../../pi-session-factory";

// =============================================================================
// Mock helpers
// =============================================================================

/**
 * Build an AgentMessage shaped like a real assistant message with text content.
 */
function makeAssistantMessage(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
  } as AgentMessage;
}

/**
 * Build a mock AgentSession with controllable messages and a prompt()
 * implementation. By default prompt() resolves immediately; pass `prompt`
 * to override (e.g. to throw or capture the argument).
 */
function makeMockSession(
  messages: AgentMessage[] = [],
  prompt: (text: string) => Promise<void> = async () => {}
): AgentSession {
  return {
    messages,
    prompt,
    bindExtensions: async () => {},
    setModel: async () => {},
    dispose: () => {},
    sessionFile: undefined,
    modelRegistry: { find: () => undefined },
  } as unknown as AgentSession;
}

/**
 * Wrap a session in the PiSessionResult shape expected by CreateSessionFn.
 */
function asSessionResult(session: AgentSession): PiSessionResult {
  return { session, jsonlPath: null };
}

/**
 * Create a session factory that returns a controlled session.
 * Optionally captures the options passed to it.
 */
function makeSuccessFactory(
  messages: AgentMessage[] = [],
  capturedOpts?: { value?: PiSessionOptions }
): CreateSessionFn {
  return async (opts) => {
    if (capturedOpts) capturedOpts.value = opts;
    return asSessionResult(makeMockSession(messages));
  };
}

/**
 * Create a session factory whose prompt() throws on every call.
 */
function makeFailingFactory(errorMessage: string): CreateSessionFn {
  return async () =>
    asSessionResult(
      makeMockSession([], async () => {
        throw new Error(errorMessage);
      })
    );
}

/**
 * Create a session factory that fails the first call then succeeds.
 */
function makeRetryFactory(successMessages: AgentMessage[] = []): CreateSessionFn {
  let callCount = 0;
  return async () => {
    callCount++;
    if (callCount === 1) {
      return asSessionResult(
        makeMockSession([], async () => {
          throw new Error("First attempt failed");
        })
      );
    }
    return asSessionResult(makeMockSession(successMessages));
  };
}

// =============================================================================
// Test fixtures
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
// loadExtractionPrompt tests
// =============================================================================

describe("loadExtractionPrompt", () => {
  it("loads the default prompt from codebase", async () => {
    const result = await loadExtractionPrompt();

    expect(result.isOverride).toBe(false);
    expect(result.content).toContain("Durable Facts");
    expect(result.path).toContain("durable-facts.md");
  });

  // Note: Testing user override requires writing to ~/.config which we avoid
  // in unit tests. Integration tests should cover that path.
});

describe("hasPromptOverride", () => {
  it("returns a boolean without error", async () => {
    const result = await hasPromptOverride();
    expect(typeof result).toBe("boolean");
  });
});

// =============================================================================
// buildExtractionPrompt tests
// =============================================================================

describe("buildExtractionPrompt", () => {
  const basePrompt = "# Extraction Prompt\n\nExtract facts from transcripts.";

  it("includes base prompt content", () => {
    const result = buildExtractionPrompt(basePrompt, [], "/vaults");

    expect(result).toContain("# Extraction Prompt");
    expect(result).toContain("Extract facts from transcripts.");
  });

  it("lists transcripts with absolute paths", () => {
    const transcripts = [
      createMockTranscript("vault1", "00_Inbox/chats/chat1.md", "content1"),
      createMockTranscript("vault2", "00_Inbox/chats/chat2.md", "content2"),
    ];

    const result = buildExtractionPrompt(basePrompt, transcripts, "/vaults");

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
// extractFacts tests
// =============================================================================

describe("extractFacts", () => {
  describe("with no transcripts", () => {
    it("returns success immediately without calling the factory", async () => {
      let factoryCalled = false;
      const factory: CreateSessionFn = async () => {
        factoryCalled = true;
        return { session: makeMockSession() as unknown as AgentSession, jsonlPath: null };
      };

      const result = await extractFacts([], "/vaults", factory);

      expect(result.success).toBe(true);
      expect(result.transcriptsProcessed).toBe(0);
      expect(result.wasRetry).toBe(false);
      expect(factoryCalled).toBe(false);
    });
  });

  describe("with successful extraction", () => {
    it("returns success with transcript count", async () => {
      const messages = [makeAssistantMessage("Extraction complete")];
      const factory = makeSuccessFactory(messages);

      const transcripts = [
        createMockTranscript("vault1", "chat1.md", "User: Hello"),
        createMockTranscript("vault1", "chat2.md", "User: Hi there"),
      ];

      const result = await extractFacts(transcripts, "/vaults", factory);

      expect(result.success).toBe(true);
      expect(result.transcriptsProcessed).toBe(2);
      expect(result.wasRetry).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("passes vaultsDir as cwd to the session factory", async () => {
      const captured: { value?: PiSessionOptions } = {};
      const factory = makeSuccessFactory([], captured);

      const transcripts = [createMockTranscript("v1", "c.md", "x")];
      await extractFacts(transcripts, "/my/vaults", factory);

      expect(captured.value?.cwd).toBe("/my/vaults");
    });

    it("uses an inMemory session manager", async () => {
      const captured: { value?: PiSessionOptions } = {};
      const factory = makeSuccessFactory([], captured);

      const transcripts = [createMockTranscript("v1", "c.md", "x")];
      await extractFacts(transcripts, "/my/vaults", factory);

      // SessionManager.inMemory() returns a manager object; confirm it's truthy
      expect(captured.value?.sessionManager).toBeTruthy();
    });

    it("passes the extraction prompt as systemPrompt to the session factory", async () => {
      const captured: { value?: PiSessionOptions } = {};
      const factory = makeSuccessFactory([], captured);

      const transcripts = [createMockTranscript("v1", "c.md", "x")];
      await extractFacts(transcripts, "/my/vaults", factory);

      expect(captured.value?.systemPrompt).toBeTruthy();
      expect(captured.value?.systemPrompt).toContain("Memory Extraction");
    });

    it("passes the extraction prompt to the session", async () => {
      let receivedPrompt: string | undefined;
      const factory: CreateSessionFn = async () => {
        return {
          session: {
            ...makeMockSession(),
            prompt: async (text: string) => {
              receivedPrompt = text;
            },
          } as unknown as AgentSession,
          jsonlPath: null,
        };
      };

      const transcripts = [
        createMockTranscript("test-vault", "00_Inbox/chats/discussion.md", "Hello world"),
      ];

      await extractFacts(transcripts, "/my/vaults", factory);

      expect(receivedPrompt).toContain("Memory Extraction");
      expect(receivedPrompt).toContain("test-vault");
      expect(receivedPrompt).toContain("discussion.md");
    });
  });

  describe("with session errors", () => {
    it("retries once on failure", async () => {
      const factory = makeRetryFactory([makeAssistantMessage("Success on retry")]);

      const transcripts = [createMockTranscript("vault1", "chat1.md", "content")];
      const result = await extractFacts(transcripts, "/vaults", factory);

      expect(result.success).toBe(true);
      expect(result.wasRetry).toBe(true);
    });

    it("returns error after both attempts fail", async () => {
      const factory = makeFailingFactory("API unavailable");

      const transcripts = [createMockTranscript("vault1", "chat1.md", "content")];
      const result = await extractFacts(transcripts, "/vaults", factory);

      expect(result.success).toBe(false);
      expect(result.error).toContain("API unavailable");
      expect(result.wasRetry).toBe(true);
      expect(result.transcriptsProcessed).toBe(0);
    });
  });

  describe("finalText extraction", () => {
    it("does not crash with multiple assistant messages", async () => {
      const messages = [
        makeAssistantMessage("First response"),
        makeAssistantMessage("Final response"),
      ];
      const factory = makeSuccessFactory(messages);

      const transcripts = [createMockTranscript("v1", "c.md", "x")];
      const result = await extractFacts(transcripts, "/vaults", factory);

      expect(result.success).toBe(true);
    });

    it("handles sessions with no assistant messages", async () => {
      // No assistant messages: finalText returns "". Extraction still reports success.
      const factory = makeSuccessFactory([]);

      const transcripts = [createMockTranscript("v1", "c.md", "x")];
      const result = await extractFacts(transcripts, "/vaults", factory);

      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// _finalText unit tests
// =============================================================================

describe("_finalText", () => {
  it("returns empty string when there are no messages", () => {
    expect(_finalText([])).toBe("");
  });

  it("returns empty string when there are no assistant messages", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ] as AgentMessage[];
    expect(_finalText(messages)).toBe("");
  });

  it("returns text from a single assistant message", () => {
    const messages = [makeAssistantMessage("Hello from assistant")];
    expect(_finalText(messages)).toBe("Hello from assistant");
  });

  it("returns text from the LAST assistant message, not the first", () => {
    const messages = [
      makeAssistantMessage("First response"),
      makeAssistantMessage("Final response"),
    ];
    expect(_finalText(messages)).toBe("Final response");
  });

  it("ignores non-assistant messages that follow the last assistant message", () => {
    const messages = [
      makeAssistantMessage("First response"),
      { role: "user", content: [{ type: "text", text: "Thanks" }] } as AgentMessage,
      makeAssistantMessage("Second response"),
      { role: "user", content: [{ type: "text", text: "Done" }] } as AgentMessage,
    ];
    // The last assistant message is "Second response"; the trailing user turn is ignored
    expect(_finalText(messages)).toBe("Second response");
  });

  it("concatenates multiple text blocks in the last assistant message", () => {
    const multiBlockMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Part one" },
        { type: "tool_use", id: "t1", name: "read", input: {} },
        { type: "text", text: "Part two" },
      ],
    } as AgentMessage;
    expect(_finalText([multiBlockMessage])).toBe("Part one\nPart two");
  });
});

// =============================================================================
// Integration-style tests (with temp directories)
// =============================================================================

describe("fact extraction integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fact-extractor-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses tempDir as cwd for the session", async () => {
    const captured: { value?: PiSessionOptions } = {};
    const factory = makeSuccessFactory([], captured);

    const transcripts = [createMockTranscript("v1", "c.md", "x")];
    await extractFacts(transcripts, tempDir, factory);

    expect(captured.value?.cwd).toBe(tempDir);
  });

  it("includes transcript paths in the prompt sent to the session", async () => {
    let receivedPrompt: string | undefined;
    const factory: CreateSessionFn = async () => {
      return {
        session: {
          ...makeMockSession(),
          prompt: async (text: string) => {
            receivedPrompt = text;
          },
        } as unknown as AgentSession,
        jsonlPath: null,
      };
    };

    const transcripts = [
      createMockTranscript("test-vault", "00_Inbox/chats/discussion.md", "Hello world"),
    ];

    await extractFacts(transcripts, tempDir, factory);

    expect(receivedPrompt).toContain("Memory Extraction");
    expect(receivedPrompt).toContain("test-vault");
    expect(receivedPrompt).toContain("discussion.md");
  });
});

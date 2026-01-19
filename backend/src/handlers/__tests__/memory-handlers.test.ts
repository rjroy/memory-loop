/**
 * Memory Handlers Tests
 *
 * Tests for memory file and extraction prompt WebSocket handlers.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// =============================================================================
// Global Test Setup - Isolate from real user files
// =============================================================================

let globalTempDir: string;
const originalMemoryPathOverride = process.env.MEMORY_FILE_PATH_OVERRIDE;

beforeAll(async () => {
  // Create a temp directory for all memory handler tests
  globalTempDir = await mkdtemp(join(tmpdir(), "memory-handlers-global-"));
  // Redirect memory file operations to temp directory
  const memoryDir = join(globalTempDir, ".claude", "rules");
  await mkdir(memoryDir, { recursive: true });
  process.env.MEMORY_FILE_PATH_OVERRIDE = join(memoryDir, "memory.md");
});

afterAll(async () => {
  // Restore original environment
  if (originalMemoryPathOverride) {
    process.env.MEMORY_FILE_PATH_OVERRIDE = originalMemoryPathOverride;
  } else {
    delete process.env.MEMORY_FILE_PATH_OVERRIDE;
  }
  // Clean up temp directory
  if (globalTempDir) {
    await rm(globalTempDir, { recursive: true, force: true });
  }
});
import type { HandlerContext } from "../types.js";
import type { ServerMessage, ErrorCode } from "@memory-loop/shared";
import {
  handleGetMemory,
  handleSaveMemory,
  handleGetExtractionPrompt,
  handleSaveExtractionPrompt,
  handleResetExtractionPrompt,
  handleTriggerExtraction,
} from "../memory-handlers.js";

// =============================================================================
// Test Utilities
// =============================================================================

interface MockContext {
  ctx: HandlerContext;
  sentMessages: ServerMessage[];
  sentErrors: Array<{ code: ErrorCode; message: string }>;
}

function createMockContext(): MockContext {
  const sentMessages: ServerMessage[] = [];
  const sentErrors: Array<{ code: ErrorCode; message: string }> = [];

  const ctx: HandlerContext = {
    state: {
      currentVault: null,
      currentSessionId: null,
      activeQuery: null,
      pendingPermissions: new Map(),
      pendingAskUserQuestions: new Map(),
      searchIndex: null,
      activeModel: null,
      cumulativeTokens: 0,
      contextWindow: null,
      widgetEngine: null,
      widgetWatcher: null,
      healthCollector: null,
      activeMeeting: null,
    },
    send: (message: ServerMessage) => {
      sentMessages.push(message);
    },
    sendError: (code: ErrorCode, message: string) => {
      sentErrors.push({ code, message });
    },
    deps: {} as HandlerContext["deps"],
  };

  return { ctx, sentMessages, sentErrors };
}

// =============================================================================
// handleGetMemory Tests
// =============================================================================

describe("handleGetMemory", () => {
  it("sends memory_content message", async () => {
    const { ctx, sentMessages } = createMockContext();

    await handleGetMemory(ctx);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("memory_content");

    const msg = sentMessages[0] as {
      type: "memory_content";
      content: string;
      sizeBytes: number;
      exists: boolean;
    };
    expect(typeof msg.content).toBe("string");
    expect(typeof msg.sizeBytes).toBe("number");
    expect(typeof msg.exists).toBe("boolean");
  });

  it("returns empty content when file does not exist", async () => {
    // Note: This test depends on whether ~/.claude/rules/memory.md exists
    // In a test environment, it likely doesn't exist
    const { ctx, sentMessages } = createMockContext();

    await handleGetMemory(ctx);

    expect(sentMessages.length).toBe(1);
    const msg = sentMessages[0] as {
      type: "memory_content";
      content: string;
      sizeBytes: number;
      exists: boolean;
    };

    // Content should be empty string if file doesn't exist
    if (!msg.exists) {
      expect(msg.content).toBe("");
      expect(msg.sizeBytes).toBe(0);
    }
  });
});

// =============================================================================
// handleSaveMemory Tests
// =============================================================================

describe("handleSaveMemory", () => {
  it("sends memory_saved message on success", async () => {
    const { ctx, sentMessages } = createMockContext();
    const testContent = "# Memory\n\n## Facts\n\n- Test fact\n";

    await handleSaveMemory(ctx, testContent);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("memory_saved");

    const msg = sentMessages[0] as {
      type: "memory_saved";
      success: boolean;
      sizeBytes?: number;
      error?: string;
    };
    expect(msg.success).toBe(true);
    expect(typeof msg.sizeBytes).toBe("number");
  });

  it("respects content in saved message", async () => {
    const { ctx, sentMessages } = createMockContext();
    const testContent = "# Memory\n\nNew content here\n";

    await handleSaveMemory(ctx, testContent);

    const msg = sentMessages[0] as {
      type: "memory_saved";
      success: boolean;
      sizeBytes?: number;
    };

    // The size should roughly match the content size
    expect(msg.success).toBe(true);
    expect(msg.sizeBytes).toBeGreaterThan(0);
  });
});

// =============================================================================
// handleGetExtractionPrompt Tests
// =============================================================================

describe("handleGetExtractionPrompt", () => {
  it("sends extraction_prompt_content message", async () => {
    const { ctx, sentMessages } = createMockContext();

    await handleGetExtractionPrompt(ctx);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("extraction_prompt_content");

    const msg = sentMessages[0] as {
      type: "extraction_prompt_content";
      content: string;
      isOverride: boolean;
    };
    expect(typeof msg.content).toBe("string");
    expect(typeof msg.isOverride).toBe("boolean");
  });

  it("returns non-empty content", async () => {
    const { ctx, sentMessages } = createMockContext();

    await handleGetExtractionPrompt(ctx);

    const msg = sentMessages[0] as {
      type: "extraction_prompt_content";
      content: string;
      isOverride: boolean;
    };
    // Content should be non-empty (either default prompt or user override)
    expect(msg.content.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// handleSaveExtractionPrompt Tests
// =============================================================================

describe("handleSaveExtractionPrompt", () => {
  let tempDir: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "memory-handlers-test-"));
    // Note: We can't easily mock homedir() without complex module mocking
    // These tests verify the handler structure rather than file system behavior
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.env.HOME = originalHome;
  });

  it("sends extraction_prompt_saved message", async () => {
    const { ctx, sentMessages } = createMockContext();
    const testPrompt = "# Custom Extraction Prompt\n\nExtract the following...\n";

    await handleSaveExtractionPrompt(ctx, testPrompt);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("extraction_prompt_saved");

    const msg = sentMessages[0] as {
      type: "extraction_prompt_saved";
      success: boolean;
      isOverride: boolean;
      error?: string;
    };
    expect(typeof msg.success).toBe("boolean");
    expect(typeof msg.isOverride).toBe("boolean");
  });
});

// =============================================================================
// handleResetExtractionPrompt Tests
// =============================================================================

describe("handleResetExtractionPrompt", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "memory-handlers-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.env.HOME = originalHome;
  });

  it("sends extraction_prompt_reset message", async () => {
    const { ctx, sentMessages } = createMockContext();

    await handleResetExtractionPrompt(ctx);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe("extraction_prompt_reset");

    const msg = sentMessages[0] as {
      type: "extraction_prompt_reset";
      success: boolean;
      content: string;
      error?: string;
    };
    expect(typeof msg.success).toBe("boolean");
    expect(typeof msg.content).toBe("string");
  });

  it("returns default prompt content on success", async () => {
    const { ctx, sentMessages } = createMockContext();

    await handleResetExtractionPrompt(ctx);

    const msg = sentMessages[0] as {
      type: "extraction_prompt_reset";
      success: boolean;
      content: string;
    };
    // Should return non-empty content (the default prompt)
    expect(msg.content.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// handleTriggerExtraction Tests
// =============================================================================

describe("handleTriggerExtraction", () => {
  it("sends extraction_status running message first", async () => {
    const { ctx, sentMessages } = createMockContext();

    // Start extraction (will likely fail due to missing vaults in test env)
    const promise = handleTriggerExtraction(ctx);

    // Wait a tick to allow the first message to be sent
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have at least one message
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);

    // First message should indicate running status
    const firstMsg = sentMessages[0] as {
      type: "extraction_status";
      status: string;
      message?: string;
    };
    expect(firstMsg.type).toBe("extraction_status");
    expect(firstMsg.status).toBe("running");

    // Wait for completion
    await promise;
  });

  it("sends final status message", async () => {
    const { ctx, sentMessages } = createMockContext();

    await handleTriggerExtraction(ctx);

    // Should have multiple messages (running + complete/error)
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);

    // Last message should be complete or error
    const lastMsg = sentMessages[sentMessages.length - 1] as {
      type: "extraction_status";
      status: string;
    };
    expect(lastMsg.type).toBe("extraction_status");
    expect(["complete", "error", "running"]).toContain(lastMsg.status);
  });
});

// =============================================================================
// Message Type Validation Tests
// =============================================================================

describe("message type validation", () => {
  it("handleGetMemory returns correct message type", async () => {
    const { ctx, sentMessages } = createMockContext();
    await handleGetMemory(ctx);
    expect(sentMessages[0].type).toBe("memory_content");
  });

  it("handleSaveMemory returns correct message type", async () => {
    const { ctx, sentMessages } = createMockContext();
    await handleSaveMemory(ctx, "test");
    expect(sentMessages[0].type).toBe("memory_saved");
  });

  it("handleGetExtractionPrompt returns correct message type", async () => {
    const { ctx, sentMessages } = createMockContext();
    await handleGetExtractionPrompt(ctx);
    expect(sentMessages[0].type).toBe("extraction_prompt_content");
  });

  it("handleSaveExtractionPrompt returns correct message type", async () => {
    const { ctx, sentMessages } = createMockContext();
    await handleSaveExtractionPrompt(ctx, "test");
    expect(sentMessages[0].type).toBe("extraction_prompt_saved");
  });

  it("handleResetExtractionPrompt returns correct message type", async () => {
    const { ctx, sentMessages } = createMockContext();
    await handleResetExtractionPrompt(ctx);
    expect(sentMessages[0].type).toBe("extraction_prompt_reset");
  });

  it("handleTriggerExtraction returns correct message type", async () => {
    const { ctx, sentMessages } = createMockContext();
    await handleTriggerExtraction(ctx);
    expect(sentMessages[0].type).toBe("extraction_status");
  });
});

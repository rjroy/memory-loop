/**
 * Session Manager Tests
 *
 * Tests session lifecycle, resume failure handling, and piSessionPath storage.
 * Uses real filesystem (temp dirs) for vault config and session metadata.
 * Uses mock pi-session factory via configurePiSessionForTesting.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DISCUSSION_TOOLS,
  resumeSession,
  createSession,
  saveSession,
  loadSession,
  SessionError,
} from "../session-manager";
import {
  configurePiSessionForTesting,
  _resetPiSessionForTesting,
  type PiSessionResult,
} from "../pi-session-factory";
import type { SessionMetadata, VaultInfo } from "@memory-loop/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

let tempDir: string;

/**
 * Minimal AgentSession mock that satisfies the interface shape.
 * Only the fields actually accessed by session-manager are needed.
 */
function makeMockAgentSession(): AgentSession {
  return {
    sessionFile: undefined,
    bindExtensions: async () => {},
    setModel: async () => {},
    modelRegistry: { find: () => undefined },
    prompt: async () => {},
    subscribe: () => () => {},
    abort: async () => {},
    isStreaming: false,
    state: { messages: [] },
    messages: [],
    sessionId: "mock-session-id",
    sessionName: undefined,
    scopedModels: [],
  } as unknown as AgentSession;
}

/**
 * Builds a PiSessionResult for injection into the mock factory.
 */
function makeMockPiSessionResult(jsonlPath: string | null = "/tmp/test.jsonl"): PiSessionResult {
  return {
    session: makeMockAgentSession(),
    jsonlPath,
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(join("/tmp/claude-1000", "session-mgr-test-"));
});

afterEach(async () => {
  _resetPiSessionForTesting();
  await rm(tempDir, { recursive: true, force: true });
});

// =============================================================================
// DISCUSSION_TOOLS constant
// =============================================================================

describe("DISCUSSION_TOOLS", () => {
  test("contains the expected pi-agent built-in tool names", () => {
    expect(DISCUSSION_TOOLS).toContain("read");
    expect(DISCUSSION_TOOLS).toContain("grep");
    expect(DISCUSSION_TOOLS).toContain("bash");
  });

  test("does not contain legacy SDK tool names", () => {
    // These were in DISCUSSION_MODE_OPTIONS.allowedTools but have no pi-agent equivalent
    expect(DISCUSSION_TOOLS).not.toContain("WebFetch");
    expect(DISCUSSION_TOOLS).not.toContain("WebSearch");
    expect(DISCUSSION_TOOLS).not.toContain("Task");
    expect(DISCUSSION_TOOLS).not.toContain("AskUserQuestion");
  });
});

// =============================================================================
// createSession
// =============================================================================

describe("createSession", () => {
  const mockVault: VaultInfo = {
    id: "test-vault",
    path: "",       // set in beforeEach
    name: "Test Vault",
    contentRoot: "",
  } as VaultInfo;

  beforeEach(() => {
    mockVault.path = tempDir;
    mockVault.contentRoot = tempDir;
  });

  test("stores piSessionPath in metadata when factory returns a path", async () => {
    const mockResult = makeMockPiSessionResult("/tmp/pi-sessions/test.jsonl");
    const cleanup = configurePiSessionForTesting(async () => mockResult);

    try {
      const result = await createSession(mockVault);

      const metadata = await loadSession(tempDir, result.sessionId);
      expect(metadata).not.toBeNull();
      expect(metadata!.piSessionPath).toBe("/tmp/pi-sessions/test.jsonl");
    } finally {
      cleanup();
    }
  });

  test("stores undefined piSessionPath when factory returns null jsonlPath", async () => {
    const mockResult = makeMockPiSessionResult(null);
    const cleanup = configurePiSessionForTesting(async () => mockResult);

    try {
      const result = await createSession(mockVault);

      const metadata = await loadSession(tempDir, result.sessionId);
      expect(metadata).not.toBeNull();
      expect(metadata!.piSessionPath).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("returns the session ID and piSession from the factory result", async () => {
    const fakeSession = makeMockAgentSession();
    const cleanup = configurePiSessionForTesting(async () => ({
      session: fakeSession,
      jsonlPath: "/tmp/pi-sessions/test.jsonl",
    }));

    try {
      const result = await createSession(mockVault);

      expect(result.sessionId).toBeTruthy();
      expect(result.piSession).toBe(fakeSession);
      expect(result.previousMessages).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("session metadata is persisted on disk", async () => {
    const cleanup = configurePiSessionForTesting(async () => makeMockPiSessionResult());

    try {
      const result = await createSession(mockVault);

      const loaded = await loadSession(tempDir, result.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(result.sessionId);
      expect(loaded!.vaultId).toBe(mockVault.id);
      expect(loaded!.vaultPath).toBe(tempDir);
      expect(loaded!.messages).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("uses vault config model when present", async () => {
    await writeFile(
      join(tempDir, ".memory-loop.json"),
      JSON.stringify({ discussionModel: "haiku" })
    );

    let capturedOpts: { model?: { provider: string; modelId: string } } = {};
    const cleanup = configurePiSessionForTesting(async (opts) => {
      capturedOpts = opts;
      return makeMockPiSessionResult();
    });

    try {
      await createSession(mockVault);
      expect(capturedOpts.model).toEqual({ provider: "anthropic", modelId: "claude-haiku-4-5" });
    } finally {
      cleanup();
    }
  });

  test("passes no model when vault config has no discussionModel", async () => {
    // No .memory-loop.json — uses default "opus" which maps to anthropic/claude-opus-4-5
    let capturedOpts: { model?: { provider: string; modelId: string } } = {};
    const cleanup = configurePiSessionForTesting(async (opts) => {
      capturedOpts = opts;
      return makeMockPiSessionResult();
    });

    try {
      await createSession(mockVault);
      // Default is "opus"
      expect(capturedOpts.model).toEqual({ provider: "anthropic", modelId: "claude-opus-4-5" });
    } finally {
      cleanup();
    }
  });

  test("wraps factory errors in SessionError with SDK_ERROR code", async () => {
    const cleanup = configurePiSessionForTesting(async () => {
      throw new Error("rate_limit exceeded");
    });

    try {
      await createSession(mockVault);
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(SessionError);
      expect((err as SessionError).code).toBe("SDK_ERROR");
    } finally {
      cleanup();
    }
  });
});

// =============================================================================
// resumeSession failure detection
// =============================================================================

describe("resumeSession failure detection", () => {
  async function createTestSession(sessionId: string, piSessionPath?: string): Promise<void> {
    const sessionsDir = join(tempDir, ".memory-loop", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const metadata: SessionMetadata = {
      id: sessionId,
      vaultId: "test-vault",
      vaultPath: tempDir,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      messages: [],
      piSessionPath,
    };
    await saveSession(metadata);
  }

  test("throws RESUME_FAILED when piSessionPath is absent from metadata", async () => {
    await createTestSession("sess-no-path"); // no piSessionPath

    try {
      await resumeSession(tempDir, "sess-no-path");
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(SessionError);
      const sessionErr = err as SessionError;
      expect(sessionErr.code).toBe("RESUME_FAILED");
      expect(sessionErr.message).toContain("no pi-agent session path");
    }
  });

  test("throws SESSION_NOT_FOUND when session metadata does not exist", async () => {
    try {
      await resumeSession(tempDir, "nonexistent-session");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(SessionError);
      expect((err as SessionError).code).toBe("SESSION_NOT_FOUND");
    }
  });

  test("returns piSession and previousMessages on successful resume", async () => {
    await createTestSession("sess-with-path", "/tmp/pi-sessions/existing.jsonl");

    const fakeSession = makeMockAgentSession();
    const cleanup = configurePiSessionForTesting(async () => ({
      session: fakeSession,
      jsonlPath: "/tmp/pi-sessions/existing.jsonl",
    }));

    try {
      const result = await resumeSession(tempDir, "sess-with-path");
      expect(result.sessionId).toBe("sess-with-path");
      expect(result.piSession).toBe(fakeSession);
      expect(result.previousMessages).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("wraps factory errors in SessionError with SDK_ERROR code", async () => {
    await createTestSession("sess-factory-error", "/tmp/pi-sessions/missing.jsonl");

    const cleanup = configurePiSessionForTesting(async () => {
      throw new Error("ENOENT: file not found");
    });

    try {
      await resumeSession(tempDir, "sess-factory-error");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(SessionError);
      expect((err as SessionError).code).toBe("SDK_ERROR");
    } finally {
      cleanup();
    }
  });

  test("SessionError thrown by factory propagates unchanged", async () => {
    await createTestSession("sess-session-error", "/tmp/pi-sessions/test.jsonl");

    const cleanup = configurePiSessionForTesting(async () => {
      throw new SessionError("internal failure", "STORAGE_ERROR");
    });

    try {
      await resumeSession(tempDir, "sess-session-error");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(SessionError);
      expect((err as SessionError).code).toBe("STORAGE_ERROR");
    } finally {
      cleanup();
    }
  });
});

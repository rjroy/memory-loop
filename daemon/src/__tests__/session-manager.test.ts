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
import {
  configureRegistryForTesting,
  _resetRegistryForTesting,
} from "../global-config";
import type { SessionMetadata, VaultInfo } from "@memory-loop/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

let tempDir: string;

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
  _resetRegistryForTesting();
  await rm(tempDir, { recursive: true, force: true });
});

describe("DISCUSSION_TOOLS", () => {
  test("contains the expected pi-agent built-in tool names", () => {
    expect(DISCUSSION_TOOLS).toContain("read");
    expect(DISCUSSION_TOOLS).toContain("grep");
    expect(DISCUSSION_TOOLS).toContain("bash");
  });

  test("does not contain legacy SDK tool names", () => {
    expect(DISCUSSION_TOOLS).not.toContain("WebFetch");
    expect(DISCUSSION_TOOLS).not.toContain("WebSearch");
    expect(DISCUSSION_TOOLS).not.toContain("Task");
    expect(DISCUSSION_TOOLS).not.toContain("AskUserQuestion");
  });
});

describe("createSession", () => {
  const mockVault: VaultInfo = {
    id: "test-vault",
    path: "",
    name: "Test Vault",
    contentRoot: "",
  } as VaultInfo;

  let cleanupPiSession: (() => void) | undefined;

  beforeEach(() => {
    mockVault.path = tempDir;
    mockVault.contentRoot = tempDir;
  });

  afterEach(() => {
    cleanupPiSession?.();
    cleanupPiSession = undefined;
  });

  function mockPiSession(factory: Parameters<typeof configurePiSessionForTesting>[0]): void {
    cleanupPiSession = configurePiSessionForTesting(factory);
  }

  test("stores piSessionPath in metadata when factory returns a path", async () => {
    mockPiSession(async () => makeMockPiSessionResult("/tmp/pi-sessions/test.jsonl"));

    const result = await createSession(mockVault);

    const metadata = await loadSession(tempDir, result.sessionId);
    expect(metadata).not.toBeNull();
    expect(metadata!.piSessionPath).toBe("/tmp/pi-sessions/test.jsonl");
  });

  test("stores undefined piSessionPath when factory returns null jsonlPath", async () => {
    mockPiSession(async () => makeMockPiSessionResult(null));

    const result = await createSession(mockVault);

    const metadata = await loadSession(tempDir, result.sessionId);
    expect(metadata).not.toBeNull();
    expect(metadata!.piSessionPath).toBeUndefined();
  });

  test("returns the session ID and piSession from the factory result", async () => {
    const fakeSession = makeMockAgentSession();
    mockPiSession(async () => ({ session: fakeSession, jsonlPath: "/tmp/pi-sessions/test.jsonl" }));

    const result = await createSession(mockVault);

    expect(result.sessionId).toBeTruthy();
    expect(result.piSession).toBe(fakeSession);
    expect(result.previousMessages).toBeUndefined();
  });

  test("session metadata is persisted on disk", async () => {
    mockPiSession(async () => makeMockPiSessionResult());

    const result = await createSession(mockVault);

    const loaded = await loadSession(tempDir, result.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(result.sessionId);
    expect(loaded!.vaultId).toBe(mockVault.id);
    expect(loaded!.vaultPath).toBe(tempDir);
    expect(loaded!.messages).toEqual([]);
  });

  test("uses vault config model when present", async () => {
    configureRegistryForTesting({
      haiku: { provider: "anthropic", modelId: "claude-haiku-4-5" },
    });
    await writeFile(
      join(tempDir, ".memory-loop.json"),
      JSON.stringify({ discussionModel: "haiku" })
    );

    let capturedOpts: { model?: { provider: string; modelId: string } } = {};
    mockPiSession(async (opts) => {
      capturedOpts = opts;
      return makeMockPiSessionResult();
    });

    await createSession(mockVault);
    expect(capturedOpts.model).toEqual({ provider: "anthropic", modelId: "claude-haiku-4-5" });
  });

  test("passes no model when vault config has no discussionModel", async () => {
    let capturedOpts: { model?: { provider: string; modelId: string } } = {};
    mockPiSession(async (opts) => {
      capturedOpts = opts;
      return makeMockPiSessionResult();
    });

    await createSession(mockVault);
    expect(capturedOpts.model).toBeUndefined();
  });

  test("wraps factory errors in SessionError with SDK_ERROR code", async () => {
    mockPiSession(async () => {
      throw new Error("rate_limit exceeded");
    });

    const promise = createSession(mockVault);
    await expect(promise).rejects.toBeInstanceOf(SessionError);
    await expect(promise).rejects.toMatchObject({ code: "SDK_ERROR" });
  });
});

describe("resumeSession failure detection", () => {
  let cleanupPiSession: (() => void) | undefined;

  afterEach(() => {
    cleanupPiSession?.();
    cleanupPiSession = undefined;
  });

  function mockPiSession(factory: Parameters<typeof configurePiSessionForTesting>[0]): void {
    cleanupPiSession = configurePiSessionForTesting(factory);
  }

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
    await createTestSession("sess-no-path");

    const promise = resumeSession(tempDir, "sess-no-path");
    await expect(promise).rejects.toBeInstanceOf(SessionError);
    await expect(promise).rejects.toMatchObject({
      code: "RESUME_FAILED",
      message: expect.stringContaining("no pi-agent session path"),
    });
  });

  test("throws SESSION_NOT_FOUND when session metadata does not exist", async () => {
    const promise = resumeSession(tempDir, "nonexistent-session");
    await expect(promise).rejects.toBeInstanceOf(SessionError);
    await expect(promise).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  test("returns piSession and previousMessages on successful resume", async () => {
    await createTestSession("sess-with-path", "/tmp/pi-sessions/existing.jsonl");

    const fakeSession = makeMockAgentSession();
    mockPiSession(async () => ({
      session: fakeSession,
      jsonlPath: "/tmp/pi-sessions/existing.jsonl",
    }));

    const result = await resumeSession(tempDir, "sess-with-path");
    expect(result.sessionId).toBe("sess-with-path");
    expect(result.piSession).toBe(fakeSession);
    expect(result.previousMessages).toEqual([]);
  });

  test("wraps factory errors in SessionError with SDK_ERROR code", async () => {
    await createTestSession("sess-factory-error", "/tmp/pi-sessions/missing.jsonl");
    mockPiSession(async () => {
      throw new Error("ENOENT: file not found");
    });

    const promise = resumeSession(tempDir, "sess-factory-error");
    await expect(promise).rejects.toBeInstanceOf(SessionError);
    await expect(promise).rejects.toMatchObject({ code: "SDK_ERROR" });
  });

  test("SessionError thrown by factory propagates unchanged", async () => {
    await createTestSession("sess-session-error", "/tmp/pi-sessions/test.jsonl");
    mockPiSession(async () => {
      throw new SessionError("internal failure", "STORAGE_ERROR");
    });

    const promise = resumeSession(tempDir, "sess-session-error");
    await expect(promise).rejects.toBeInstanceOf(SessionError);
    await expect(promise).rejects.toMatchObject({ code: "STORAGE_ERROR" });
  });
});

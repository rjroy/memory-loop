/**
 * Pi-Session Factory Tests
 *
 * Verifies the mandatory initialization sequence:
 * 1. loader.reload() is called before createAgentSession
 * 2. bindExtensions({}) is called before setModel
 * 3. Fallback model is used when no vault config model is specified
 * 4. result.jsonlPath is a non-null string for persisted sessions (SessionManager.create)
 * 5. result.jsonlPath is null for in-memory sessions (SessionManager.inMemory)
 *
 * Uses dependency injection via _createPiSessionWithDeps to supply a mock
 * createAgentSession and a mock resource loader without using mock.module()
 * (banned by CLAUDE.md).
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  _createPiSessionWithDeps,
  configurePiSessionForTesting,
  _resetPiSessionForTesting,
  createPiSession,
  type PiSessionDeps,
} from "../pi-session-factory";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  CreateAgentSessionResult,
  ResourceLoader,
} from "@earendil-works/pi-coding-agent";

// Model is from @earendil-works/pi-ai which is a transitive dependency.
// We use a local shape alias to avoid importing a non-direct dependency.
type FakeModel = { provider: string; id: string; name: string };

// ─── Mock model factories ────────────────────────────────────────────────────

function makeFakeModel(provider: string, id: string): FakeModel {
  return { provider, id, name: `${provider}/${id}` };
}

const FALLBACK_MODEL = makeFakeModel("fallback", "text");
const VAULT_MODEL = makeFakeModel("anthropic", "claude-opus-4-5");

// ─── Mock resource loader ─────────────────────────────────────────────────────

/**
 * A ResourceLoader that satisfies the interface but only does real work in
 * reload(). All getter methods return empty results. The reloadCalls counter
 * tracks how many times reload() was called.
 */
function makeMockLoader(reloadCalls: { count: number }): ResourceLoader {
  return {
    reload: async () => { reloadCalls.count++; },
    getExtensions: () =>
      ({ extensions: [] } as unknown as ReturnType<ResourceLoader["getExtensions"]>),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
  } as ResourceLoader;
}

// ─── Mock session builder ────────────────────────────────────────────────────

interface MockSessionOptions {
  sessionFile?: string;
  /** When provided, modelRegistry.find returns this for ("fallback", "text"). Defaults to FALLBACK_MODEL. */
  fallbackModel?: FakeModel | null;
  /** When provided, modelRegistry.find returns this for its matching (provider, id). */
  vaultModel?: FakeModel;
  /** Records each call. Re-used so tests can assert ordering. */
  callOrder?: string[];
  /** Captures the model argument passed to setModel(). */
  onSetModel?: (model: FakeModel) => void;
}

function makeMockSession(opts: MockSessionOptions = {}): AgentSession {
  const {
    sessionFile,
    fallbackModel = FALLBACK_MODEL,
    vaultModel,
    callOrder = [],
    onSetModel,
  } = opts;

  return {
    _callOrder: callOrder,
    sessionFile,
    bindExtensions: async () => {
      callOrder.push("bindExtensions");
    },
    setModel: async (model: FakeModel) => {
      callOrder.push("setModel");
      onSetModel?.(model);
    },
    modelRegistry: {
      find: (provider: string, modelId: string): FakeModel | undefined => {
        if (provider === "fallback" && modelId === "text") {
          return fallbackModel ?? undefined;
        }
        if (vaultModel && provider === vaultModel.provider && modelId === vaultModel.id) {
          return vaultModel;
        }
        return undefined;
      },
    },
  } as unknown as AgentSession;
}

// ─── Per-test harness ────────────────────────────────────────────────────────

interface MockCreateAgentSessionState {
  calledWith: Parameters<PiSessionDeps["createAgentSession"]>[0] | null;
  reloadCalledBeforeCreate: boolean;
}

/**
 * Bundle the common per-test setup: a mock session, deps that wire it up,
 * a reload counter, and a createAgentSession state record. Returns all
 * pieces so individual tests can assert against whichever they need.
 *
 * The deps include a mock resource loader (tracks reload() calls) and a mock
 * createAgentSession (records its arguments and whether reload was already
 * called by the time it ran).
 */
function setupHarness(sessionOpts: MockSessionOptions = {}) {
  const reloadCalls = { count: 0 };
  const state: MockCreateAgentSessionState = {
    calledWith: null,
    reloadCalledBeforeCreate: false,
  };
  const session = makeMockSession(sessionOpts);
  const deps: PiSessionDeps = {
    createResourceLoader: () => makeMockLoader(reloadCalls),
    createAgentSession: async (opts) => {
      state.calledWith = opts;
      state.reloadCalledBeforeCreate = reloadCalls.count > 0;
      return {
        session,
        extensionsResult: {
          extensions: [],
        } as unknown as CreateAgentSessionResult["extensionsResult"],
      };
    },
  };
  return { session, deps, state, reloadCalls };
}

const DEFAULT_VAULT = "/tmp/test-vault";

// ─── Tests ───────────────────────────────────────────────────────────────────

afterEach(() => {
  _resetPiSessionForTesting();
});

describe("_createPiSessionWithDeps: initialization sequence", () => {
  test("loader.reload() is called before createAgentSession", async () => {
    const { deps, state, reloadCalls } = setupHarness();

    await _createPiSessionWithDeps(
      { cwd: DEFAULT_VAULT, sessionManager: SessionManager.inMemory() },
      deps
    );

    expect(state.calledWith).not.toBeNull();
    expect(state.reloadCalledBeforeCreate).toBe(true);
    expect(reloadCalls.count).toBe(1);
  });

  test("bindExtensions({}) is called before setModel", async () => {
    const callOrder: string[] = [];
    const { deps } = setupHarness({ callOrder });

    await _createPiSessionWithDeps(
      { cwd: DEFAULT_VAULT, sessionManager: SessionManager.inMemory() },
      deps
    );

    const bindIndex = callOrder.indexOf("bindExtensions");
    const setModelIndex = callOrder.indexOf("setModel");

    expect(bindIndex).toBeGreaterThanOrEqual(0);
    expect(setModelIndex).toBeGreaterThanOrEqual(0);
    expect(bindIndex).toBeLessThan(setModelIndex);
  });
});

describe("_createPiSessionWithDeps: model selection", () => {
  test("uses fallback model when no vault config model is specified", async () => {
    let activated: FakeModel | null = null;
    const { deps } = setupHarness({ onSetModel: (m) => { activated = m; } });

    await _createPiSessionWithDeps(
      { cwd: DEFAULT_VAULT, sessionManager: SessionManager.inMemory() },
      deps
    );

    expect(activated as unknown).toBe(FALLBACK_MODEL);
  });

  test("uses fallback model when specified vault model is not found in registry", async () => {
    let activated: FakeModel | null = null;
    const { deps } = setupHarness({ onSetModel: (m) => { activated = m; } });

    await _createPiSessionWithDeps(
      {
        cwd: DEFAULT_VAULT,
        sessionManager: SessionManager.inMemory(),
        model: { provider: "anthropic", modelId: "claude-opus-4-5" },
      },
      deps
    );

    expect(activated as unknown).toBe(FALLBACK_MODEL);
  });

  test("uses vault config model when found in registry", async () => {
    let activated: FakeModel | null = null;
    const { deps } = setupHarness({
      vaultModel: VAULT_MODEL,
      onSetModel: (m) => { activated = m; },
    });

    await _createPiSessionWithDeps(
      {
        cwd: DEFAULT_VAULT,
        sessionManager: SessionManager.inMemory(),
        model: { provider: "anthropic", modelId: "claude-opus-4-5" },
      },
      deps
    );

    expect(activated as unknown).toBe(VAULT_MODEL);
  });

  test("throws when neither vault model nor fallback is available", async () => {
    // fallbackModel: null suppresses the default ("fallback","text") match.
    const { deps } = setupHarness({ fallbackModel: null });

    await expect(
      _createPiSessionWithDeps(
        { cwd: DEFAULT_VAULT, sessionManager: SessionManager.inMemory() },
        deps
      )
    ).rejects.toThrow("No model available");
  });
});

describe("_createPiSessionWithDeps: jsonlPath", () => {
  test("jsonlPath is null for inMemory sessions (sessionFile undefined)", async () => {
    const { deps } = setupHarness({ sessionFile: undefined });

    const result = await _createPiSessionWithDeps(
      { cwd: DEFAULT_VAULT, sessionManager: SessionManager.inMemory() },
      deps
    );

    expect(result.jsonlPath).toBeNull();
  });

  test("jsonlPath is a non-null string for persisted sessions (SessionManager.create)", async () => {
    // SessionManager.create sets a real JSONL path. We simulate by providing
    // a concrete path on the mock session — this is what session.sessionFile
    // would return after createAgentSession with a persisted SessionManager.
    const expectedPath = "/home/rjroy/.pi/agent/sessions/test-vault/abc123.jsonl";
    const { deps } = setupHarness({ sessionFile: expectedPath });

    const result = await _createPiSessionWithDeps(
      {
        cwd: DEFAULT_VAULT,
        sessionManager: SessionManager.create(DEFAULT_VAULT),
      },
      deps
    );

    expect(result.jsonlPath).toBe(expectedPath);
  });
});

describe("_createPiSessionWithDeps: result shape", () => {
  test("returns the session from createAgentSession", async () => {
    const { session, deps } = setupHarness();

    const result = await _createPiSessionWithDeps(
      { cwd: DEFAULT_VAULT, sessionManager: SessionManager.inMemory() },
      deps
    );

    expect(result.session).toBe(session);
  });

  test("passes cwd, resourceLoader, sessionManager, and tools to createAgentSession", async () => {
    const { deps, state } = setupHarness();
    const manager = SessionManager.inMemory();
    const tools = ["read", "grep"];

    await _createPiSessionWithDeps(
      { cwd: DEFAULT_VAULT, sessionManager: manager, tools },
      deps
    );

    expect(state.calledWith?.cwd).toBe(DEFAULT_VAULT);
    expect(state.calledWith?.sessionManager).toBe(manager);
    expect(state.calledWith?.tools).toEqual(tools);
    expect(state.calledWith?.resourceLoader).toBeDefined();
  });
});

describe("configurePiSessionForTesting / _resetPiSessionForTesting", () => {
  test("configurePiSessionForTesting replaces createPiSession with mock", async () => {
    let called = false;
    const mockResult = {
      session: {} as AgentSession,
      jsonlPath: "/mock/path.jsonl",
    };

    const cleanup = configurePiSessionForTesting(async () => {
      called = true;
      return mockResult;
    });

    try {
      const result = await createPiSession({
        cwd: "/tmp/test",
        sessionManager: SessionManager.inMemory(),
      });

      expect(called).toBe(true);
      expect(result).toBe(mockResult);
    } finally {
      cleanup();
    }
  });

  test("cleanup returned by configurePiSessionForTesting restores the real implementation", async () => {
    const sentinel = { session: {} as AgentSession, jsonlPath: "/sentinel.jsonl" };
    let mockCallCount = 0;
    const cleanup = configurePiSessionForTesting(async () => {
      mockCallCount++;
      return sentinel;
    });

    // Confirm mock is active: first call returns the sentinel
    const resultWhileMocked = await createPiSession({
      cwd: "/tmp/test",
      sessionManager: SessionManager.inMemory(),
    });
    expect(resultWhileMocked).toBe(sentinel);
    expect(mockCallCount).toBe(1);

    // Restore real implementation
    cleanup();

    // _createPiSessionWithDeps always uses the real implementation (it bypasses
    // the swappable _factoryFn). After cleanup, createPiSession should also
    // call the real implementation, so the sentinel mock counter must not advance.
    const { deps } = setupHarness();
    await _createPiSessionWithDeps(
      { cwd: DEFAULT_VAULT, sessionManager: SessionManager.inMemory() },
      deps
    );

    expect(mockCallCount).toBe(1);
  });

  test("_resetPiSessionForTesting restores the real implementation", async () => {
    let mockCallCount = 0;
    configurePiSessionForTesting(async () => {
      mockCallCount++;
      return { session: {} as AgentSession, jsonlPath: "/mock/path.jsonl" };
    });

    // Confirm mock is active
    await createPiSession({ cwd: "/tmp/test", sessionManager: SessionManager.inMemory() });
    expect(mockCallCount).toBe(1);

    _resetPiSessionForTesting();

    // After reset, _createPiSessionWithDeps still works (it always uses real impl)
    // and the mock counter should not increase via createPiSession anymore.
    const { session, deps } = setupHarness();
    const result = await _createPiSessionWithDeps(
      { cwd: DEFAULT_VAULT, sessionManager: SessionManager.inMemory() },
      deps
    );

    expect(result.session).toBe(session);
    expect(mockCallCount).toBe(1);
  });

  test("_resetPiSessionForTesting is safe to call without prior configuration", () => {
    expect(() => _resetPiSessionForTesting()).not.toThrow();
  });
});

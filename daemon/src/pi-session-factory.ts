/**
 * Pi-Session Factory
 *
 * Centralized factory for creating pi-agent sessions. Owns the mandatory
 * initialization sequence that every caller must follow:
 *
 *   1. Construct DefaultResourceLoader with cwd/agentDir
 *   2. await loader.reload() — not optional
 *   3. createAgentSession() with the loader and caller-supplied session manager
 *   4. await session.bindExtensions({}) — so extension-registered models appear
 *   5. Model selection: vault config { provider, modelId } → fallback to ("fallback", "text")
 *   6. await session.setModel(model)
 *
 * This replaces the old sdk-provider.ts singleton pattern with a factory that
 * the caller invokes per session, passing the appropriate SessionManager strategy
 * (inMemory, create, open).
 *
 * Test injection is available via configurePiSessionForTesting /
 * _resetPiSessionForTesting, matching the naming convention of the old
 * configureSdkForTesting / _resetForTesting.
 */

import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  ExtensionFactory,
  ResourceLoader,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("PiSessionFactory");

/** Provider/modelId used when no vault model is configured or the configured one is missing. */
const FALLBACK_MODEL = { provider: "fallback", modelId: "text" } as const;

/** Format a model reference for log messages and error text. */
function formatModelRef(ref: { provider: string; modelId: string }): string {
  return `("${ref.provider}", "${ref.modelId}")`;
}

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface PiSessionOptions {
  cwd: string;
  /** For the fact extractor only. Omit for interactive discussion sessions. */
  systemPrompt?: string;
  /** Built-in tool allowlist (e.g. ["read", "bash", "grep"]). */
  tools?: string[];
  /** Custom tool definitions (e.g. AskUserQuestion, vault-transfer tools). */
  customTools?: ToolDefinition[];
  /** Extension factories (e.g. permission-gating extension). */
  extensionFactories?: ExtensionFactory[];
  /**
   * Caller-chosen session persistence strategy.
   * Use SessionManager.create(cwd) for new persisted sessions,
   * SessionManager.open(path) to resume, SessionManager.inMemory() for
   * ephemeral sessions (fact extractor).
   */
  sessionManager: SessionManager;
  /**
   * Optional vault-config model preference.
   * When provided, the factory attempts to resolve the named model.
   * Falls back to ("fallback", "text") if absent or not found.
   */
  model?: { provider: string; modelId: string };
}

export interface PiSessionResult {
  session: AgentSession;
  /**
   * Path to the JSONL session file, or null for inMemory sessions.
   * Store this in SessionMetadata.piSessionPath to enable resume via
   * SessionManager.open(path).
   */
  jsonlPath: string | null;
}

/**
 * Factory type for creating pi-agent sessions. Modules that accept an
 * injectable session factory (fact-extractor, card-generator, etc.) re-export
 * this type so tests can import it alongside the module's own exports.
 */
export type CreateSessionFn = typeof createPiSession;

// ─── Dependency type for test injection ──────────────────────────────────────

/**
 * Dependencies injectable for unit testing.
 * Production code uses the real pi-coding-agent functions.
 */
export interface PiSessionDeps {
  createAgentSession: (
    opts: CreateAgentSessionOptions
  ) => Promise<CreateAgentSessionResult>;
  /**
   * Factory that produces a resource loader for the given cwd.
   * Tests inject a factory that returns a mock loader with a trackable reload().
   * The returned loader is passed directly to createAgentSession, so it must
   * satisfy the ResourceLoader interface from @earendil-works/pi-coding-agent.
   */
  createResourceLoader: (opts: {
    cwd: string;
    systemPrompt?: string;
    extensionFactories?: ExtensionFactory[];
  }) => ResourceLoader;
}

/**
 * Strip keys whose values are `undefined`. Used so optional fields don't
 * appear at all when forwarding into APIs that reject `undefined` under
 * `exactOptionalPropertyTypes`.
 */
function omitUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

/** Production deps — use real pi-coding-agent functions. */
const REAL_DEPS: PiSessionDeps = {
  createAgentSession,
  createResourceLoader: ({ cwd, systemPrompt, extensionFactories }) =>
    new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      ...omitUndefined({ systemPrompt, extensionFactories }),
    }),
};

// ─── Test injection ───────────────────────────────────────────────────────────

/** Default implementation, used unless configurePiSessionForTesting overrides. */
const defaultImpl: typeof createPiSession = (opts) =>
  _createPiSessionWithDeps(opts, REAL_DEPS);

/**
 * The live factory function, swappable for tests.
 * Starts as defaultImpl; replaced by configurePiSessionForTesting.
 */
let _factoryFn: typeof createPiSession = defaultImpl;

/**
 * Replace the factory implementation for testing.
 * Returns a cleanup function suitable for afterEach().
 */
export function configurePiSessionForTesting(
  mockFn: typeof createPiSession
): () => void {
  _factoryFn = mockFn;
  return _resetPiSessionForTesting;
}

/**
 * Reset to the real implementation. Safe to call in afterEach even if not
 * configured (matches _resetForTesting behavior in sdk-provider.ts).
 */
export function _resetPiSessionForTesting(): void {
  _factoryFn = defaultImpl;
}

// ─── Public factory (delegates to injectable impl) ───────────────────────────

/**
 * Create a pi-agent session using the mandatory initialization sequence.
 *
 * @param opts - Session options including cwd, tools, and session manager
 * @returns AgentSession and the JSONL path (null for inMemory sessions)
 */
export async function createPiSession(
  opts: PiSessionOptions
): Promise<PiSessionResult> {
  return _factoryFn(opts);
}

/**
 * Testable form of the factory. Accepts injectable dependencies so tests can
 * supply a mock createAgentSession and a mock loader factory without using
 * mock.module().
 *
 * This is the authoritative implementation; the public createPiSession
 * delegates here via defaultImpl when no test override is installed.
 */
export async function _createPiSessionWithDeps(
  opts: PiSessionOptions,
  deps: PiSessionDeps
): Promise<PiSessionResult> {
  log.info(`Creating pi-agent session for cwd: ${opts.cwd}`);

  // Step 1: Construct resource loader via injectable factory
  const loader = deps.createResourceLoader({
    cwd: opts.cwd,
    systemPrompt: opts.systemPrompt,
    extensionFactories: opts.extensionFactories,
  });

  // Step 2: Reload — not optional even when no extensions are loaded.
  // Without this, project-level CLAUDE.md and settings are not picked up.
  await loader.reload();

  // Step 3: Create the agent session
  const { session } = await deps.createAgentSession({
    cwd: opts.cwd,
    resourceLoader: loader,
    sessionManager: opts.sessionManager,
    ...omitUndefined({ tools: opts.tools, customTools: opts.customTools }),
  });

  // Capture jsonlPath immediately after session creation.
  // session.sessionFile is undefined for inMemory sessions.
  const jsonlPath = session.sessionFile ?? null;

  // Step 4: Bind extensions — runs queued extension work so that
  // extension-registered models and tools appear in the registry.
  await session.bindExtensions({});

  // Step 5: Resolve model. Prefer vault config; fall back to pi-agent default.
  const model = resolveModel(session.modelRegistry, opts.model);

  log.info(`Using model: provider="${model.provider}" id="${model.id}"`);

  // Step 6: Activate the model on the session
  await session.setModel(model);

  log.info(`Pi-agent session ready. jsonlPath=${jsonlPath ?? "(inMemory)"}`);

  return { session, jsonlPath };
}

/**
 * Resolve the model to activate on the session. Prefers the configured model
 * and falls back to ("fallback", "text"). Throws when neither is available.
 */
function resolveModel(
  registry: AgentSession["modelRegistry"],
  configured: PiSessionOptions["model"]
): NonNullable<ReturnType<AgentSession["modelRegistry"]["find"]>> {
  if (configured) {
    const fromConfig = registry.find(configured.provider, configured.modelId);
    if (fromConfig) return fromConfig;
    log.warn(
      `Model not found: ${formatModelRef(configured)}. ` +
        `Falling back to ${formatModelRef(FALLBACK_MODEL)}.`
    );
  }

  const fallback = registry.find(FALLBACK_MODEL.provider, FALLBACK_MODEL.modelId);
  if (fallback) return fallback;

  const tried = configured
    ? `${formatModelRef(configured)} and fallback ${formatModelRef(FALLBACK_MODEL)}`
    : `fallback ${formatModelRef(FALLBACK_MODEL)}`;
  throw new Error(
    `No model available. Tried ${tried}. ` +
      `Ensure a model is configured in ${getAgentDir()}.`
  );
}

// Re-export SessionManager so callers can build strategies without an extra import.
export { SessionManager };

/**
 * Extract the final assistant text from a pi-agent message list.
 *
 * Scans in reverse for the last assistant message and concatenates all text
 * content blocks. Returns an empty string when no assistant message is found
 * (e.g. the agent was aborted before producing any output).
 */
export function extractFinalText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message?.role !== "assistant") continue;

    const content = message.content;
    if (!Array.isArray(content)) return "";

    return content
      .filter(
        (block): block is { type: "text"; text?: string } =>
          block != null &&
          typeof block === "object" &&
          (block as { type?: unknown }).type === "text"
      )
      .map((block) => block.text ?? "")
      .join("\n");
  }
  return "";
}

// Pi-agent session lifecycle: create, resume, persistence.
// Sessions are stored in `.memory-loop/sessions/<id>.json`.

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  defineTool,
  SessionManager,
  type AgentSession,
  type ExtensionFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  createLogger,
  formatDateForFilename,
  formatTimeForTimestamp,
  resolveRecentDiscussions,
  type ConversationMessage,
  type RecentDiscussionEntry,
  type SessionMetadata,
  type VaultInfo,
} from "@memory-loop/shared";
import { directoryExists, fileExists } from "@memory-loop/shared/server";
import { getVaultById } from "./vault/vault-manager";
import {
  appendToTranscript,
  formatAssistantMessage,
  formatUserMessage,
  initializeTranscript,
} from "./files/transcript-manager";
import { createVaultTransferTools } from "./vault-transfer";
import { loadVaultConfig } from "./vault/vault-config";
import { createPiSession } from "./pi-session-factory";
import { getRegistry } from "./global-config";

export type { SessionMetadata, ConversationMessage } from "@memory-loop/shared";

const log = createLogger("Session");

/**
 * Built-in tool allowlist for Discussion mode.
 *
 * Read-only operations plus bash. Task/subagent tools are excluded because they
 * inherit parent tools and could bypass permission checks. Web tools (WebFetch,
 * WebSearch) require the pi-web-access extension, which isn't wired in here.
 */
export const DISCUSSION_TOOLS = ["read", "grep", "bash"] as const;

type PiAgentModel = { provider: string; modelId: string };

export const SESSIONS_DIR = ".memory-loop/sessions";

type SessionErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_INVALID"
  | "SDK_ERROR"
  | "STORAGE_ERROR"
  | "RESUME_FAILED";

export class SessionError extends Error {
  constructor(message: string, public readonly code: SessionErrorCode) {
    super(message);
    this.name = "SessionError";
  }
}

// Substrings that identify known SDK error categories, paired with user-friendly
// explanations. First match wins; order matters only when patterns overlap.
const SDK_ERROR_PATTERNS: ReadonlyArray<readonly [needle: string, message: string]> = [
  ["ENOENT", "Claude Code executable not found. Please ensure Claude Code is installed."],
  ["EACCES", "Permission denied. Unable to access required resources."],
  ["authentication", "Authentication failed. Please check your Anthropic API key."],
  ["rate_limit", "Rate limit exceeded. Please try again later."],
  ["billing", "Billing error. Please check your Anthropic account."],
  ["invalid_request", "Invalid request. The session or prompt may be malformed."],
  ["server_error", "Server error. The Anthropic API is temporarily unavailable."],
];

export function mapSdkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "An unknown error occurred while communicating with Claude.";
  }
  const match = SDK_ERROR_PATTERNS.find(([needle]) => error.message.includes(needle));
  return match?.[1] ?? error.message;
}

export async function getSessionsDir(vaultPath: string): Promise<string> {
  const sessionsDir = join(vaultPath, SESSIONS_DIR);
  await mkdir(sessionsDir, { recursive: true });
  return sessionsDir;
}

/**
 * Throws SessionError if `sessionId` is unsafe to use as a filesystem path
 * segment. Returns true on success so callers can use it as a guard.
 */
export function validateSessionId(sessionId: string): boolean {
  // Session IDs from the SDK are typically UUIDs. Permit alphanumeric,
  // hyphen, underscore, and period (UUIDs use hyphens; periods seen in some IDs).
  // `/` and `\` cannot match this regex, so path traversal via separator is rejected here.
  const safePattern = /^[a-zA-Z0-9_.-]+$/;

  if (!sessionId || sessionId.length === 0) {
    throw new SessionError("Session ID cannot be empty", "SESSION_INVALID");
  }
  if (sessionId.length > 256) {
    throw new SessionError("Session ID is too long", "SESSION_INVALID");
  }
  if (!safePattern.test(sessionId)) {
    throw new SessionError("Session ID contains invalid characters", "SESSION_INVALID");
  }
  // The regex permits `.`, so `..` survives the character check; reject explicitly.
  if (sessionId.includes("..")) {
    throw new SessionError(
      "Session ID contains path traversal characters",
      "SESSION_INVALID"
    );
  }

  return true;
}

export async function getSessionFilePath(
  vaultPath: string,
  sessionId: string
): Promise<string> {
  validateSessionId(sessionId);
  const sessionsDir = await getSessionsDir(vaultPath);
  return join(sessionsDir, `${sessionId}.json`);
}

export async function saveSession(metadata: SessionMetadata): Promise<void> {
  try {
    const filePath = await getSessionFilePath(metadata.vaultPath, metadata.id);
    await writeFile(filePath, JSON.stringify(metadata, null, 2), "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SessionError(
      `Failed to save session metadata: ${message}`,
      "STORAGE_ERROR"
    );
  }
}

export async function loadSession(
  vaultPath: string,
  sessionId: string
): Promise<SessionMetadata | null> {
  try {
    const filePath = await getSessionFilePath(vaultPath, sessionId);

    if (!(await fileExists(filePath))) {
      return null;
    }

    const content = await readFile(filePath, "utf-8");
    const metadata = JSON.parse(content) as SessionMetadata;

    if (!metadata.id || !metadata.vaultId || !metadata.vaultPath) {
      throw new SessionError(`Session file is missing required fields`, "SESSION_INVALID");
    }

    // Older session files predate the `messages` array. Default it so callers don't crash.
    metadata.messages = metadata.messages ?? [];

    return metadata;
  } catch (error) {
    if (error instanceof SessionError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new SessionError(`Session file contains invalid JSON`, "SESSION_INVALID");
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new SessionError(
      `Failed to load session metadata: ${message}`,
      "STORAGE_ERROR"
    );
  }
}

export async function deleteSession(vaultPath: string, sessionId: string): Promise<boolean> {
  try {
    const filePath = await getSessionFilePath(vaultPath, sessionId);
    if (!(await fileExists(filePath))) {
      return false;
    }
    await unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the session IDs corresponding to JSON files in the given sessions dir.
 * Returns an empty array if the directory does not exist or cannot be read.
 */
async function readSessionIds(sessionsDir: string): Promise<string[]> {
  if (!(await directoryExists(sessionsDir))) {
    return [];
  }
  const files = await readdir(sessionsDir);
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5));
}

/**
 * Loads all sessions for a vault paired with their lastActive Date, sorted
 * most-recent first. Skips files that fail to load or have invalid timestamps.
 */
async function loadSessionsSortedByActivity(
  vaultPath: string
): Promise<Array<{ metadata: SessionMetadata; lastActive: Date }>> {
  try {
    const sessionsDir = await getSessionsDir(vaultPath);
    const sessionIds = await readSessionIds(sessionsDir);

    const entries: Array<{ metadata: SessionMetadata; lastActive: Date }> = [];
    for (const sessionId of sessionIds) {
      try {
        const metadata = await loadSession(vaultPath, sessionId);
        if (!metadata) continue;
        const lastActive = new Date(metadata.lastActiveAt);
        if (Number.isNaN(lastActive.getTime())) continue;
        entries.push({ metadata, lastActive });
      } catch {
        log.debug(`Skipping corrupted session file: ${sessionId}.json`);
      }
    }

    entries.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
    return entries;
  } catch {
    return [];
  }
}

export async function listSessionsByVault(vaultPath: string): Promise<string[]> {
  try {
    const sessionsDir = await getSessionsDir(vaultPath);
    return await readSessionIds(sessionsDir);
  } catch {
    return [];
  }
}

function truncatePreview(text: string, maxLength: number): string {
  const firstLine = text.split("\n")[0].trim();
  if (firstLine.length <= maxLength) {
    return firstLine;
  }
  return firstLine.slice(0, maxLength - 1) + "…";
}

export async function getRecentSessions(
  vaultPath: string,
  limit = 5
): Promise<RecentDiscussionEntry[]> {
  const entries = await loadSessionsSortedByActivity(vaultPath);

  return entries
    .filter(({ metadata }) => metadata.messages.length > 0)
    .slice(0, limit)
    .map(({ metadata, lastActive }) => {
      const firstUserMessage = metadata.messages.find((m) => m.role === "user");
      const preview = firstUserMessage
        ? truncatePreview(firstUserMessage.content, 100)
        : "Discussion";

      return {
        sessionId: metadata.id,
        preview,
        time: formatTimeForTimestamp(lastActive),
        date: formatDateForFilename(lastActive),
        messageCount: metadata.messages.length,
      };
    });
}

export async function pruneOldSessions(
  vaultPath: string,
  keepCount = 5
): Promise<void> {
  try {
    const sessionsDir = await getSessionsDir(vaultPath);
    const entries = await loadSessionsSortedByActivity(vaultPath);

    for (const { metadata } of entries.slice(keepCount)) {
      const filePath = join(sessionsDir, `${metadata.id}.json`);
      try {
        await unlink(filePath);
        log.info(`Pruned old session: ${metadata.id}`);
      } catch {
        log.warn(`Failed to delete session file: ${filePath}`);
      }
    }
  } catch (error) {
    log.warn("Failed to prune old sessions", error);
  }
}

export async function touchSession(vaultPath: string, sessionId: string): Promise<void> {
  const metadata = await loadSession(vaultPath, sessionId);
  if (metadata) {
    metadata.lastActiveAt = new Date().toISOString();
    await saveSession(metadata);
  }
}

export async function getSessionForVault(vaultPath: string): Promise<string | null> {
  const entries = await loadSessionsSortedByActivity(vaultPath);
  return entries[0]?.metadata.id ?? null;
}

export async function appendMessage(
  vaultPath: string,
  sessionId: string,
  message: ConversationMessage
): Promise<void> {
  const metadata = await loadSession(vaultPath, sessionId);
  if (!metadata) {
    const filePath = await getSessionFilePath(vaultPath, sessionId);
    log.error(`Session file not found at: ${filePath}`);
    throw new SessionError(`Session "${sessionId}" not found`, "SESSION_NOT_FOUND");
  }

  metadata.messages.push(message);
  metadata.lastActiveAt = new Date().toISOString();

  // Initialize transcript on the first user message of a session.
  if (message.role === "user" && !metadata.transcriptPath) {
    try {
      const vault = await getVaultById(metadata.vaultId);
      if (vault) {
        const timestamp = new Date(message.timestamp);
        metadata.transcriptPath = await initializeTranscript(
          vault,
          sessionId,
          message.content,
          timestamp
        );
        log.info(`Created transcript: ${metadata.transcriptPath}`);
      } else {
        log.warn(`Vault "${metadata.vaultId}" not found, skipping transcript`);
      }
    } catch (error) {
      // Transcript is best-effort; never block message append on it.
      log.warn("Failed to initialize transcript:", error);
    }
  }

  await saveSession(metadata);

  if (metadata.transcriptPath) {
    try {
      const timestamp = new Date(message.timestamp);
      const formatted =
        message.role === "user"
          ? formatUserMessage(message.content, timestamp)
          : formatAssistantMessage(message.content, message.toolInvocations, timestamp);
      await appendToTranscript(metadata.transcriptPath, formatted);
    } catch (error) {
      log.warn("Failed to append to transcript:", error);
    }
  }

  log.info(`Appended ${message.role} message to session ${sessionId.slice(0, 8)}...`);
}

export interface SessionQueryResult {
  sessionId: string;
  piSession: AgentSession;
  /** Conversation history from prior turns (populated on resume). */
  previousMessages?: ConversationMessage[];
}

/** Returns true to allow the tool, false to block it. */
export type ToolPermissionCallback = (
  toolUseId: string,
  toolName: string,
  input: unknown
) => Promise<boolean>;

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

/** Receives questions and returns a map of question text to selected answer(s). */
export type AskUserQuestionCallback = (
  toolUseId: string,
  questions: AskUserQuestionItem[]
) => Promise<Record<string, string>>;

function createPermissionExtension(callback: ToolPermissionCallback): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      try {
        const allowed = await callback(event.toolCallId, event.toolName, event.input ?? {});
        if (!allowed) {
          return { block: true, reason: `User denied permission for ${event.toolName}` };
        }
        return undefined;
      } catch (err) {
        log.error(`Permission callback threw for ${event.toolName} — blocking tool call`, err);
        return { block: true, reason: `Permission check failed for ${event.toolName}` };
      }
    });
  };
}

function createAskUserQuestionTool(callback: AskUserQuestionCallback): ToolDefinition {
  return defineTool({
    name: "AskUserQuestion",
    label: "Ask User Question",
    description: "Ask the user a set of questions and receive their answers",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String({ description: "The question text" }),
          header: Type.String({ description: "Short header label for the question" }),
          options: Type.Array(
            Type.Object({
              label: Type.String({ description: "Option label" }),
              description: Type.String({ description: "Option description" }),
            }),
            { description: "Available options (2-4)" }
          ),
          multiSelect: Type.Boolean({
            description: "Whether multiple options can be selected",
          }),
        }),
        { description: "List of questions to ask the user" }
      ),
    }),
    async execute(toolCallId, args) {
      const answers = await callback(toolCallId, args.questions as AskUserQuestionItem[]);
      return {
        content: [{ type: "text", text: JSON.stringify({ answers }) }],
        details: { answers },
      };
    },
  });
}

function resolveModelForPiAgent(
  vaultPath: string,
  config: Awaited<ReturnType<typeof loadVaultConfig>>
): PiAgentModel | undefined {
  const modelName = config.discussionModel;
  if (!modelName) return undefined;

  const entry = getRegistry()[modelName];
  if (!entry) {
    log.warn(
      `Unknown discussion model "${modelName}" for vault at ${vaultPath}, using pi-agent fallback`
    );
    return undefined;
  }
  return entry;
}

function buildSessionExtensions(
  requestToolPermission: ToolPermissionCallback | undefined,
  askUserQuestion: AskUserQuestionCallback | undefined
): { extensionFactories: ExtensionFactory[]; customTools: ToolDefinition[] } {
  const extensionFactories: ExtensionFactory[] = [];
  if (requestToolPermission) {
    log.info("Tool permission callback configured");
    extensionFactories.push(createPermissionExtension(requestToolPermission));
  }

  const customTools: ToolDefinition[] = [...createVaultTransferTools()];
  if (askUserQuestion) {
    log.info("AskUserQuestion callback configured");
    customTools.push(createAskUserQuestionTool(askUserQuestion));
  }

  return { extensionFactories, customTools };
}

/**
 * Opens a pi-agent session for the given vault. Used by createSession() (with a
 * fresh SessionManager) and resumeSession() (with an open one) so the wiring stays
 * in one place. Returns the loaded vault config alongside the result so callers
 * don't need a second loadVaultConfig() call.
 */
async function openPiSessionForVault(
  vaultPath: string,
  sessionManager: ReturnType<typeof SessionManager.create>,
  requestToolPermission: ToolPermissionCallback | undefined,
  askUserQuestion: AskUserQuestionCallback | undefined
): Promise<{
  result: Awaited<ReturnType<typeof createPiSession>>;
  config: Awaited<ReturnType<typeof loadVaultConfig>>;
}> {
  const config = await loadVaultConfig(vaultPath);
  const model = resolveModelForPiAgent(vaultPath, config);
  const { extensionFactories, customTools } = buildSessionExtensions(
    requestToolPermission,
    askUserQuestion
  );

  log.info(`Using discussion tools: ${DISCUSSION_TOOLS.join(", ")}`);
  if (model) {
    log.info(`Using vault model: provider="${model.provider}" modelId="${model.modelId}"`);
  } else {
    log.info("No vault model configured, using pi-agent fallback");
  }

  const result = await createPiSession({
    cwd: vaultPath,
    tools: [...DISCUSSION_TOOLS],
    customTools,
    extensionFactories,
    sessionManager,
    model,
  });

  return { result, config };
}

/**
 * Wraps non-SessionError exceptions in a SessionError(SDK_ERROR). Re-throws
 * existing SessionError instances unchanged so codes like RESUME_FAILED survive.
 */
function wrapSdkFailure(operation: string, error: unknown): never {
  log.error(`Failed to ${operation}`, error);
  if (error instanceof SessionError) {
    throw error;
  }
  throw new SessionError(mapSdkError(error), "SDK_ERROR");
}

/**
 * Creates a new persisted pi-agent session for the vault.
 *
 * The session id can be client-minted (passed via `sessionId`) or, when omitted,
 * generated here. The keyed live-session-controller always supplies an id up
 * front; the omitted-id path is retained for callers/tests that let the manager
 * mint the id.
 *
 * When an id IS supplied it is validated and collision-checked: a "create" call
 * for an id whose session file already exists is a caller error (the caller is
 * expected to decide create-vs-resume before calling), so we reject rather than
 * clobber existing metadata.
 */
export async function createSession(
  vault: VaultInfo,
  requestToolPermission?: ToolPermissionCallback,
  askUserQuestion?: AskUserQuestionCallback,
  sessionId?: string
): Promise<SessionQueryResult> {
  log.info(`Creating session for vault: ${vault.id}`);
  log.info(`Vault path: ${vault.path}`);

  // Validate and collision-check a client-minted id before opening the pi
  // session, so we fail fast without leaving a dangling pi-agent process.
  if (sessionId !== undefined) {
    validateSessionId(sessionId);
    const existing = await loadSession(vault.path, sessionId);
    if (existing) {
      throw new SessionError(
        `Session "${sessionId}" already exists; cannot create`,
        "SESSION_INVALID"
      );
    }
  }

  try {
    const { result, config } = await openPiSessionForVault(
      vault.path,
      SessionManager.create(vault.path),
      requestToolPermission,
      askUserQuestion
    );

    const resolvedSessionId = sessionId ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const metadata: SessionMetadata = {
      id: resolvedSessionId,
      vaultId: vault.id,
      vaultPath: vault.path,
      createdAt: now,
      lastActiveAt: now,
      messages: [],
      piSessionPath: result.jsonlPath ?? undefined,
    };
    await saveSession(metadata);
    log.info(
      `Session created: ${resolvedSessionId}, piSessionPath=${result.jsonlPath ?? "(none)"}`
    );

    // Prune in background; errors are logged inside pruneOldSessions.
    void pruneOldSessions(vault.path, resolveRecentDiscussions(config));

    return {
      sessionId: resolvedSessionId,
      piSession: result.session,
    };
  } catch (error) {
    wrapSdkFailure("create session", error);
  }
}

export async function resumeSession(
  vaultPath: string,
  sessionId: string,
  requestToolPermission?: ToolPermissionCallback,
  askUserQuestion?: AskUserQuestionCallback
): Promise<SessionQueryResult> {
  log.info(`Resuming session: ${sessionId}`);

  const metadata = await loadSession(vaultPath, sessionId);

  if (!metadata) {
    log.warn(`Session not found: ${sessionId}`);
    throw new SessionError(`Session "${sessionId}" not found`, "SESSION_NOT_FOUND");
  }

  log.info(`Session metadata loaded: vault=${metadata.vaultId}`);

  if (!metadata.piSessionPath) {
    log.error(`Session ${sessionId} has no piSessionPath — cannot resume via pi-agent`);
    throw new SessionError(
      "Cannot resume: no pi-agent session path stored",
      "RESUME_FAILED"
    );
  }

  try {
    log.info(`Resuming pi-agent session from: ${metadata.piSessionPath}`);
    const { result } = await openPiSessionForVault(
      vaultPath,
      SessionManager.open(metadata.piSessionPath),
      requestToolPermission,
      askUserQuestion
    );

    metadata.lastActiveAt = new Date().toISOString();
    await saveSession(metadata);

    return {
      sessionId,
      piSession: result.session,
      previousMessages: metadata.messages,
    };
  } catch (error) {
    wrapSdkFailure("resume session", error);
  }
}

/**
 * Session Manager
 *
 * Manages pi-agent session lifecycle: create, resume, and persistence.
 * Sessions are stored in `.memory-loop/sessions/` as JSON files.
 */

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
  resolveDiscussionModel,
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

// Re-export types from shared for convenience
export type { SessionMetadata, ConversationMessage } from "@memory-loop/shared";

const log = createLogger("Session");

/**
 * Built-in tool allowlist for Discussion mode.
 *
 * Restricts to read-only operations and bash. Task/subagent tools are excluded
 * because they inherit parent tools and could bypass permission checks.
 * Web tools (WebFetch, WebSearch) are excluded because they require the
 * pi-web-access extension which is not available to daemon sessions.
 */
export const DISCUSSION_TOOLS = ["read", "grep", "bash"] as const;

/**
 * Pi-agent model coordinates. Matches the `model` field accepted by createPiSession.
 */
type PiAgentModel = { provider: string; modelId: string };

/**
 * Maps vault config discussion model names to pi-agent { provider, modelId } pairs.
 * Used by createSession() and resumeSession() when building the createPiSession call.
 */
const DISCUSSION_MODEL_MAP: Record<string, PiAgentModel> = {
  opus: { provider: "anthropic", modelId: "claude-opus-4-5" },
  sonnet: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
  haiku: { provider: "anthropic", modelId: "claude-haiku-4-5" },
};

/**
 * Relative path within vault for storing session metadata.
 */
export const SESSIONS_DIR = ".memory-loop/sessions";

/**
 * Error thrown when session operations fail.
 */
export class SessionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "SESSION_NOT_FOUND"
      | "SESSION_INVALID"
      | "SDK_ERROR"
      | "STORAGE_ERROR"
      | "RESUME_FAILED"
  ) {
    super(message);
    this.name = "SessionError";
  }
}

/**
 * Substrings that identify known SDK error categories, paired with a user-friendly
 * explanation. First match wins; order matters only if patterns overlap.
 */
const SDK_ERROR_PATTERNS: ReadonlyArray<readonly [needle: string, message: string]> = [
  ["ENOENT", "Claude Code executable not found. Please ensure Claude Code is installed."],
  ["EACCES", "Permission denied. Unable to access required resources."],
  ["authentication", "Authentication failed. Please check your Anthropic API key."],
  ["rate_limit", "Rate limit exceeded. Please try again later."],
  ["billing", "Billing error. Please check your Anthropic account."],
  ["invalid_request", "Invalid request. The session or prompt may be malformed."],
  ["server_error", "Server error. The Anthropic API is temporarily unavailable."],
];

/**
 * Maps SDK errors to user-friendly error messages.
 *
 * @param error - The error from the SDK
 * @returns User-friendly error message
 */
export function mapSdkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "An unknown error occurred while communicating with Claude.";
  }
  const match = SDK_ERROR_PATTERNS.find(([needle]) => error.message.includes(needle));
  return match?.[1] ?? error.message;
}

/**
 * Gets the absolute path to the sessions directory for a vault.
 * Creates the directory if it doesn't exist.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @returns Absolute path to sessions directory within the vault
 */
export async function getSessionsDir(vaultPath: string): Promise<string> {
  const sessionsDir = join(vaultPath, SESSIONS_DIR);

  // Ensure directory exists
  await mkdir(sessionsDir, { recursive: true });

  return sessionsDir;
}

/**
 * Validates a session ID to prevent path traversal attacks.
 * Session IDs must contain only alphanumeric characters, hyphens, and underscores.
 *
 * @param sessionId - The session ID to validate
 * @returns true if valid
 * @throws SessionError if invalid
 */
export function validateSessionId(sessionId: string): boolean {
  // Session IDs from SDK are typically UUIDs or similar safe formats.
  // Allow alphanumeric, hyphens, underscores, and periods (for UUIDs).
  // `/` and `\` cannot match this regex, so path traversal via separator is rejected here.
  const safePattern = /^[a-zA-Z0-9_.-]+$/;

  if (!sessionId || sessionId.length === 0) {
    throw new SessionError("Session ID cannot be empty", "SESSION_INVALID");
  }

  if (sessionId.length > 256) {
    throw new SessionError("Session ID is too long", "SESSION_INVALID");
  }

  if (!safePattern.test(sessionId)) {
    throw new SessionError(
      "Session ID contains invalid characters",
      "SESSION_INVALID"
    );
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

/**
 * Gets the absolute path to a session file.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param sessionId - The session ID
 * @returns Absolute path to session JSON file
 * @throws SessionError if session ID is invalid
 */
export async function getSessionFilePath(vaultPath: string, sessionId: string): Promise<string> {
  validateSessionId(sessionId);
  const sessionsDir = await getSessionsDir(vaultPath);
  return join(sessionsDir, `${sessionId}.json`);
}

/**
 * Saves session metadata to disk.
 * Uses metadata.vaultPath to determine storage location.
 *
 * @param metadata - The session metadata to save
 * @throws SessionError if storage fails
 */
export async function saveSession(metadata: SessionMetadata): Promise<void> {
  try {
    const filePath = await getSessionFilePath(metadata.vaultPath, metadata.id);
    const content = JSON.stringify(metadata, null, 2);
    await writeFile(filePath, content, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SessionError(
      `Failed to save session metadata: ${message}`,
      "STORAGE_ERROR"
    );
  }
}

/**
 * Loads session metadata from disk.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param sessionId - The session ID to load
 * @returns SessionMetadata or null if not found
 * @throws SessionError if the file exists but is invalid
 */
export async function loadSession(
  vaultPath: string,
  sessionId: string
): Promise<SessionMetadata | null> {
  try {
    const filePath = await getSessionFilePath(vaultPath, sessionId);

    // Check if file exists
    if (!(await fileExists(filePath))) {
      return null;
    }

    const content = await readFile(filePath, "utf-8");
    const metadata = JSON.parse(content) as SessionMetadata;

    // Validate required fields
    if (!metadata.id || !metadata.vaultId || !metadata.vaultPath) {
      throw new SessionError(
        `Session file is missing required fields`,
        "SESSION_INVALID"
      );
    }

    // Migration: default messages to empty array for old session files
    metadata.messages = metadata.messages ?? [];

    return metadata;
  } catch (error) {
    if (error instanceof SessionError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new SessionError(
        `Session file contains invalid JSON`,
        "SESSION_INVALID"
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new SessionError(
      `Failed to load session metadata: ${message}`,
      "STORAGE_ERROR"
    );
  }
}

/**
 * Deletes session metadata from disk.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param sessionId - The session ID to delete
 * @returns true if deleted, false if not found
 */
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
 * Returns an empty array if anything fails (e.g. sessions dir cannot be read).
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
        // Skip corrupted session files
        log.debug(`Skipping corrupted session file: ${sessionId}.json`);
      }
    }

    entries.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
    return entries;
  } catch {
    return [];
  }
}

/**
 * Lists all session IDs for a given vault.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @returns Array of session IDs
 */
export async function listSessionsByVault(vaultPath: string): Promise<string[]> {
  try {
    const sessionsDir = await getSessionsDir(vaultPath);
    return await readSessionIds(sessionsDir);
  } catch {
    return [];
  }
}

/**
 * Gets recent discussion sessions for a vault, sorted by last activity.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param limit - Maximum number of discussions to return (default 5)
 * @returns Array of RecentDiscussionEntry objects, sorted by most recent first
 */
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

/**
 * Prunes old sessions for a vault, keeping only the most recent ones.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param keepCount - Number of sessions to keep (default: 5)
 */
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

/**
 * Truncates a string to a maximum length, adding ellipsis if truncated.
 */
function truncatePreview(text: string, maxLength: number): string {
  // Take first line only
  const firstLine = text.split("\n")[0].trim();
  if (firstLine.length <= maxLength) {
    return firstLine;
  }
  return firstLine.slice(0, maxLength - 1) + "…";
}

/**
 * Updates the lastActiveAt timestamp for a session.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param sessionId - The session ID to update
 */
export async function touchSession(vaultPath: string, sessionId: string): Promise<void> {
  const metadata = await loadSession(vaultPath, sessionId);
  if (metadata) {
    metadata.lastActiveAt = new Date().toISOString();
    await saveSession(metadata);
  }
}

/**
 * Gets the most recent session ID for a vault, if one exists.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @returns The most recent session ID, or null if no session exists for this vault
 */
export async function getSessionForVault(
  vaultPath: string
): Promise<string | null> {
  const entries = await loadSessionsSortedByActivity(vaultPath);
  return entries[0]?.metadata.id ?? null;
}

/**
 * Appends a message to a session's conversation history.
 * Also writes to the transcript file for Obsidian searchability.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param sessionId - The session ID
 * @param message - The message to append
 * @throws SessionError if session not found
 */
export async function appendMessage(
  vaultPath: string,
  sessionId: string,
  message: ConversationMessage
): Promise<void> {
  const metadata = await loadSession(vaultPath, sessionId);
  if (!metadata) {
    const filePath = await getSessionFilePath(vaultPath, sessionId);
    log.error(`Session file not found at: ${filePath}`);
    throw new SessionError(
      `Session "${sessionId}" not found`,
      "SESSION_NOT_FOUND"
    );
  }

  metadata.messages.push(message);
  metadata.lastActiveAt = new Date().toISOString();

  // Initialize transcript on first user message
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
      // Log error but don't fail the message append
      log.warn("Failed to initialize transcript:", error);
    }
  }

  await saveSession(metadata);

  // Append to transcript if path exists
  if (metadata.transcriptPath) {
    try {
      const timestamp = new Date(message.timestamp);
      const formatted =
        message.role === "user"
          ? formatUserMessage(message.content, timestamp)
          : formatAssistantMessage(message.content, message.toolInvocations, timestamp);
      await appendToTranscript(metadata.transcriptPath, formatted);
    } catch (error) {
      // Log error but don't fail the message append
      log.warn("Failed to append to transcript:", error);
    }
  }

  log.info(`Appended ${message.role} message to session ${sessionId.slice(0, 8)}...`);
}

/**
 * Result of a session creation or resume, wrapping the pi-agent session.
 */
export interface SessionQueryResult {
  /** The session ID (locally generated UUID) */
  sessionId: string;
  /** The live pi-agent session for streaming and control */
  piSession: AgentSession;
  /** Conversation history from prior turns (populated on resume) */
  previousMessages?: ConversationMessage[];
}

/**
 * Callback to request tool permission from the user.
 * Returns true if the user allows the tool, false otherwise.
 */
export type ToolPermissionCallback = (
  toolUseId: string,
  toolName: string,
  input: unknown
) => Promise<boolean>;

/**
 * Schema for a single question in an AskUserQuestion request.
 * Matches the AskUserQuestionItemSchema from the shared protocol.
 */
export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

/**
 * Callback to handle AskUserQuestion tool.
 * Receives questions and returns a map of question text to selected answer(s).
 */
export type AskUserQuestionCallback = (
  toolUseId: string,
  questions: AskUserQuestionItem[]
) => Promise<Record<string, string>>;

/**
 * Builds a pi-agent ExtensionFactory that gates every tool call through
 * the provided ToolPermissionCallback. When the user denies permission,
 * the factory returns a block result so the tool is not executed.
 */
function createPermissionExtension(callback: ToolPermissionCallback): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      try {
        const allowed = await callback(event.toolCallId, event.toolName, event.input ?? {});
        if (!allowed) {
          return { block: true, reason: `User denied permission for ${event.toolName}` };
        }
        // Returning undefined allows the tool to proceed
        return undefined;
      } catch (err) {
        log.error(`Permission callback threw for ${event.toolName} — blocking tool call`, err);
        return { block: true, reason: `Permission check failed for ${event.toolName}` };
      }
    });
  };
}

/**
 * Builds the AskUserQuestion custom tool definition, wiring the provided
 * callback so the agent can ask the user structured questions during a turn.
 */
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
          multiSelect: Type.Boolean({ description: "Whether multiple options can be selected" }),
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

/**
 * Maps a vault config discussion model name to a pi-agent { provider, modelId } pair.
 * Returns undefined if the model name is not recognised (triggers fallback in the factory).
 */
function resolveModelForPiAgent(
  vaultPath: string,
  config: Awaited<ReturnType<typeof loadVaultConfig>>
): PiAgentModel | undefined {
  const modelName = resolveDiscussionModel(config);
  const mapped = DISCUSSION_MODEL_MAP[modelName];
  if (!mapped) {
    log.warn(`Unknown discussion model "${modelName}" for vault at ${vaultPath}, using pi-agent fallback`);
  }
  return mapped;
}

/**
 * Builds the discussion extension factories and custom tools shared by
 * createSession() and resumeSession(). Both flows wire the same callbacks
 * (tool permission gating, AskUserQuestion) and the same vault-transfer tools.
 */
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
 * Opens a pi-agent session for the given vault using either a fresh `create`
 * or a `resume` SessionManager. Loads vault config, resolves the discussion
 * model, wires extensions, and logs the chosen tooling. Used by both
 * createSession() and resumeSession() so the setup stays in one place.
 *
 * Returns the loaded config alongside the pi-session result so callers don't
 * need a second loadVaultConfig() call (e.g. createSession uses it for pruning).
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
 * Wraps non-SessionError exceptions in a SessionError(SDK_ERROR). Logs context
 * via the supplied `operation` label. Re-throws SessionError instances as-is so
 * their original codes (e.g. RESUME_FAILED) survive.
 */
function wrapSdkFailure(operation: string, error: unknown): never {
  log.error(`Failed to ${operation}`, error);
  if (error instanceof SessionError) {
    throw error;
  }
  throw new SessionError(mapSdkError(error), "SDK_ERROR");
}

/**
 * Creates a new pi-agent session for a vault.
 *
 * @param vault - The vault to create a session for
 * @param requestToolPermission - Optional callback to request tool permission from user
 * @param askUserQuestion - Optional callback to handle AskUserQuestion tool
 * @returns SessionQueryResult with session ID and pi-agent session
 */
export async function createSession(
  vault: VaultInfo,
  requestToolPermission?: ToolPermissionCallback,
  askUserQuestion?: AskUserQuestionCallback
): Promise<SessionQueryResult> {
  log.info(`Creating session for vault: ${vault.id}`);
  log.info(`Vault path: ${vault.path}`);

  try {
    const { result, config } = await openPiSessionForVault(
      vault.path,
      SessionManager.create(vault.path),
      requestToolPermission,
      askUserQuestion
    );

    // Generate a locally-owned UUID — no longer extracted from the first event.
    const sessionId = crypto.randomUUID();

    // Persist session metadata, including the JSONL path for future resume.
    const now = new Date().toISOString();
    const metadata: SessionMetadata = {
      id: sessionId,
      vaultId: vault.id,
      vaultPath: vault.path,
      createdAt: now,
      lastActiveAt: now,
      messages: [],
      piSessionPath: result.jsonlPath ?? undefined,
    };
    await saveSession(metadata);
    log.info(`Session created: ${sessionId}, piSessionPath=${result.jsonlPath ?? "(none)"}`);

    // Prune old sessions in background (non-blocking, errors logged internally)
    void pruneOldSessions(vault.path, resolveRecentDiscussions(config));

    return {
      sessionId,
      piSession: result.session,
    };
  } catch (error) {
    wrapSdkFailure("create session", error);
  }
}

/**
 * Resumes an existing pi-agent session.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param sessionId - The session ID to resume
 * @param requestToolPermission - Optional callback to request tool permission from user
 * @param askUserQuestion - Optional callback to handle AskUserQuestion tool
 * @returns SessionQueryResult with session ID and pi-agent session
 */
export async function resumeSession(
  vaultPath: string,
  sessionId: string,
  requestToolPermission?: ToolPermissionCallback,
  askUserQuestion?: AskUserQuestionCallback
): Promise<SessionQueryResult> {
  log.info(`Resuming session: ${sessionId}`);

  // Load existing session metadata
  const metadata = await loadSession(vaultPath, sessionId);

  if (!metadata) {
    log.warn(`Session not found: ${sessionId}`);
    throw new SessionError(
      `Session "${sessionId}" not found`,
      "SESSION_NOT_FOUND"
    );
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

    // Update last-active timestamp
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

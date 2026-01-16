/**
 * Session Manager
 *
 * Manages Claude Agent SDK session lifecycle: create, resume, and persistence.
 * Sessions are stored in `.memory-loop/sessions/` as JSON files.
 */

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  query,
  type Query,
  type SDKMessage,
  type Options,
  type SlashCommand as SDKSlashCommand,
} from "@anthropic-ai/claude-agent-sdk";

// Re-export the SDK's SlashCommand type for use by other modules
export type { SDKSlashCommand };
import type { SessionMetadata, VaultInfo, RecentDiscussionEntry, ConversationMessage } from "@memory-loop/shared";
import { directoryExists, fileExists, getVaultById } from "./vault-manager";
import {
  initializeTranscript,
  appendToTranscript,
  formatUserMessage,
  formatAssistantMessage,
} from "./transcript-manager";
import { formatDateForFilename, formatTimeForTimestamp } from "./note-capture";
import { sessionLog as log } from "./logger";
import { createVaultTransferServer } from "./vault-transfer";
import { loadVaultConfig, resolveRecentDiscussions, resolveDiscussionModel } from "./vault-config";

/**
 * Default SDK options for Discussion mode.
 *
 * These options configure Claude for interactive vault exploration:
 * - allowedTools: Auto-allow read operations without user prompts
 * - permissionMode: Accept file edits in the vault automatically
 * - maxBudgetUsd: Hard cost cap as safety net
 * - includePartialMessages: Enable streaming for real-time responses
 *
 * Note: The model is configured per-vault via .memory-loop.json and
 * is set dynamically in createSession/resumeSession.
 *
 * Note: Task tool is intentionally excluded from allowedTools because
 * subagents inherit parent tools by default, which could bypass permission
 * checks for dangerous operations.
 */
export const DISCUSSION_MODE_OPTIONS: Partial<Options> = {
  // Auto-allow read-only operations without prompting user
  // Task is excluded: subagents inherit tools and could bypass permissions
  allowedTools: [
    "Read",
    "Glob",
    "Grep",
    "AskUserQuestion",
    "WebFetch",
    "WebSearch",
    "Task",
    "TodoWrite",
    "TodoRead",
  ],
  // Model is set dynamically from vault config (default: "opus")
  // Auto-accept file edits - the user is working in their own vault
  permissionMode: "acceptEdits",
  // Hard cost cap as safety net ($2 is generous for a single conversation)
  maxBudgetUsd: 2.0,
  // Enable streaming for real-time response display
  includePartialMessages: true,
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
  ) {
    super(message);
    this.name = "SessionError";
  }
}

/**
 * Maps SDK errors to user-friendly error messages.
 *
 * @param error - The error from the SDK
 * @returns User-friendly error message
 */
export function mapSdkError(error: unknown): string {
  if (error instanceof Error) {
    // Handle known SDK error patterns
    if (error.message.includes("ENOENT")) {
      return "Claude Code executable not found. Please ensure Claude Code is installed.";
    }
    if (error.message.includes("EACCES")) {
      return "Permission denied. Unable to access required resources.";
    }
    if (error.message.includes("authentication")) {
      return "Authentication failed. Please check your Anthropic API key.";
    }
    if (error.message.includes("rate_limit")) {
      return "Rate limit exceeded. Please try again later.";
    }
    if (error.message.includes("billing")) {
      return "Billing error. Please check your Anthropic account.";
    }
    if (error.message.includes("invalid_request")) {
      return "Invalid request. The session or prompt may be malformed.";
    }
    if (error.message.includes("server_error")) {
      return "Server error. The Anthropic API is temporarily unavailable.";
    }
    // Return original message if no pattern matches
    return error.message;
  }
  return "An unknown error occurred while communicating with Claude.";
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
  // Session IDs from SDK are typically UUIDs or similar safe formats
  // Allow alphanumeric, hyphens, underscores, and periods (for UUIDs)
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

  // Explicitly reject path traversal attempts
  if (sessionId.includes("..") || sessionId.includes("/") || sessionId.includes("\\")) {
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
 * Lists all session IDs for a given vault.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @returns Array of session IDs
 */
export async function listSessionsByVault(vaultPath: string): Promise<string[]> {
  try {
    const sessionsDir = await getSessionsDir(vaultPath);

    if (!(await directoryExists(sessionsDir))) {
      return [];
    }

    const files = await readdir(sessionsDir);
    const sessionIds: string[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const sessionId = file.slice(0, -5); // Remove .json extension
      sessionIds.push(sessionId);
    }

    return sessionIds;
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
  try {
    const sessionsDir = await getSessionsDir(vaultPath);

    if (!(await directoryExists(sessionsDir))) {
      return [];
    }

    const files = await readdir(sessionsDir);
    const sessions: { metadata: SessionMetadata; lastActive: Date }[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const sessionId = file.slice(0, -5);
      try {
        const metadata = await loadSession(vaultPath, sessionId);

        if (metadata && metadata.messages.length > 0) {
          sessions.push({
            metadata,
            lastActive: new Date(metadata.lastActiveAt),
          });
        }
      } catch {
        // Skip corrupted session files
        log.debug(`Skipping corrupted session file: ${file}`);
      }
    }

    // Sort by last activity, most recent first
    sessions.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());

    // Take the top N sessions
    const topSessions = sessions.slice(0, limit);

    // Format for UI
    return topSessions.map(({ metadata }) => {
      const lastActive = new Date(metadata.lastActiveAt);
      // Find first user message for preview
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
  } catch {
    return [];
  }
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

    if (!(await directoryExists(sessionsDir))) {
      return;
    }

    const files = await readdir(sessionsDir);
    const sessions: { sessionId: string; lastActive: Date; filePath: string }[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const sessionId = file.slice(0, -5);
      try {
        const metadata = await loadSession(vaultPath, sessionId);

        if (metadata) {
          sessions.push({
            sessionId,
            lastActive: new Date(metadata.lastActiveAt),
            filePath: join(sessionsDir, file),
          });
        }
      } catch {
        // Skip corrupted session files
      }
    }

    // Sort by last activity, most recent first
    sessions.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());

    // Delete sessions beyond the keep count
    const sessionsToDelete = sessions.slice(keepCount);
    for (const session of sessionsToDelete) {
      try {
        await unlink(session.filePath);
        log.info(`Pruned old session: ${session.sessionId}`);
      } catch {
        log.warn(`Failed to delete session file: ${session.filePath}`);
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
  try {
    const sessionsDir = await getSessionsDir(vaultPath);

    if (!(await directoryExists(sessionsDir))) {
      return null;
    }

    const files = await readdir(sessionsDir);

    let mostRecentSession: { id: string; lastActiveAt: Date } | null = null;

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const sessionId = file.slice(0, -5); // Remove .json extension

      let metadata;
      try {
        metadata = await loadSession(vaultPath, sessionId);
      } catch {
        // Skip corrupted session files
        continue;
      }

      if (metadata) {
        const lastActiveAt = new Date(metadata.lastActiveAt);
        if (Number.isNaN(lastActiveAt.getTime())) {
          // Skip sessions with invalid timestamps
          continue;
        }
        if (!mostRecentSession || lastActiveAt > mostRecentSession.lastActiveAt) {
          mostRecentSession = { id: sessionId, lastActiveAt };
        }
      }
    }

    return mostRecentSession?.id ?? null;
  } catch {
    return null;
  }
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
        log.info(`[Session] Created transcript: ${metadata.transcriptPath}`);
      }
    } catch (error) {
      // Log error but don't fail the message append
      log.warn(`[Session] Failed to initialize transcript:`, error);
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
      log.warn(`[Session] Failed to append to transcript:`, error);
    }
  }

  log.info(`[Session] Appended ${message.role} message to session ${sessionId.slice(0, 8)}...`);
}

/**
 * Result of a session query, wrapping the async generator.
 */
export interface SessionQueryResult {
  /** The session ID */
  sessionId: string;
  /** Async generator for streaming SDK events */
  events: AsyncGenerator<SDKMessage, void>;
  /** Function to interrupt the query */
  interrupt: () => Promise<void>;
  /** Function to fetch supported slash commands */
  supportedCommands: () => Promise<SDKSlashCommand[]>;
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
 * Extracts the session ID from the first event.
 * The session ID is available in every SDKMessage.
 *
 * @param generator - The query generator
 * @returns Promise that resolves to the session ID when first event arrives
 */
async function extractSessionId(
  generator: Query
): Promise<{ sessionId: string; firstEvent: SDKMessage }> {
  const result = await generator.next();

  if (result.done) {
    throw new SessionError(
      "Query ended without producing any events",
      "SDK_ERROR"
    );
  }

  const firstEvent = result.value;
  const sessionId = firstEvent.session_id;

  if (!sessionId) {
    throw new SessionError(
      "First event did not contain session_id",
      "SDK_ERROR"
    );
  }

  return { sessionId, firstEvent };
}

/**
 * Creates a wrapper generator that yields the first event and then all subsequent events.
 */
async function* wrapGenerator(
  firstEvent: SDKMessage,
  generator: Query
): AsyncGenerator<SDKMessage, void> {
  yield firstEvent;
  for await (const event of generator) {
    yield event;
  }
}

/**
 * Creates the canUseTool callback for the SDK based on permission and question callbacks.
 * This wraps the simpler callbacks into the SDK's expected format.
 *
 * Special handling for AskUserQuestion tool:
 * - Uses askUserQuestion callback to get user answers
 * - Populates the answers field in updatedInput before allowing
 *
 * @param requestPermission - Callback to request permission from the user
 * @param askUserQuestion - Optional callback to handle AskUserQuestion tool
 * @returns A canUseTool function for the SDK options
 */
function createCanUseTool(
  requestPermission: ToolPermissionCallback,
  askUserQuestion?: AskUserQuestionCallback
): (toolName: string, input: Record<string, unknown>) => Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }> {
  return async (toolName: string, input: Record<string, unknown>) => {
    // Generate a unique ID for this tool use request
    const toolUseId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    log.info(`Tool permission requested: ${toolName} (${toolUseId})`);

    // Special handling for AskUserQuestion tool
    if (toolName === "AskUserQuestion" && askUserQuestion) {
      log.info(`AskUserQuestion tool detected, routing to question handler`);

      // Extract questions from input
      const questions = input.questions as AskUserQuestionItem[] | undefined;
      if (!questions || !Array.isArray(questions)) {
        log.warn(`AskUserQuestion called without valid questions array`);
        return {
          behavior: "deny" as const,
          message: "AskUserQuestion requires a valid questions array",
        };
      }

      try {
        // Get answers from user via callback
        const answers = await askUserQuestion(toolUseId, questions);

        log.info(`AskUserQuestion answers received for ${toolUseId}`);

        // Return with answers populated in input
        return {
          behavior: "allow" as const,
          updatedInput: { ...input, answers },
        };
      } catch (err) {
        log.warn(`AskUserQuestion failed for ${toolUseId}:`, err);
        return {
          behavior: "deny" as const,
          message: "User cancelled or failed to answer questions",
        };
      }
    }

    // Standard permission flow for other tools
    const allowed = await requestPermission(toolUseId, toolName, input);

    if (allowed) {
      log.info(`Tool permission granted: ${toolName} (${toolUseId})`);
      return { behavior: "allow" as const, updatedInput: input };
    } else {
      log.info(`Tool permission denied: ${toolName} (${toolUseId})`);
      return {
        behavior: "deny" as const,
        message: `User denied permission for ${toolName}`,
      };
    }
  };
}

/**
 * Creates a new Claude Agent SDK session for a vault.
 *
 * @param vault - The vault to create a session for
 * @param prompt - The initial prompt to send
 * @param options - Additional SDK options
 * @param requestToolPermission - Optional callback to request tool permission from user
 * @param askUserQuestion - Optional callback to handle AskUserQuestion tool
 * @returns SessionQueryResult with session ID and event stream
 */
export async function createSession(
  vault: VaultInfo,
  prompt: string,
  options?: Partial<Options>,
  requestToolPermission?: ToolPermissionCallback,
  askUserQuestion?: AskUserQuestionCallback
): Promise<SessionQueryResult> {
  log.info(`Creating session for vault: ${vault.id}`);
  log.info(`Vault path: ${vault.path}`);
  log.debug(`Prompt: ${prompt.slice(0, 100)}...`);

  try {
    // Create SDK query with vault's cwd, project settings, and discussion mode defaults
    log.info("Calling Claude Agent SDK query()...");

    // Load vault config to get discussion model
    const config = await loadVaultConfig(vault.path);
    const model = resolveDiscussionModel(config);
    log.info(`Using discussion model: ${model}`);

    // Create vault transfer MCP server for this session
    const vaultTransferServer = createVaultTransferServer();

    const mergedOptions: Partial<Options> = {
      ...DISCUSSION_MODE_OPTIONS,
      model, // Set model from vault config
      ...options, // Merge defaults then caller options, then force specific fields below
      cwd: vault.path,
      settingSources: ["local", "project", "user"],
      mcpServers: {
        ...options?.mcpServers,
        "vault-transfer": vaultTransferServer, // Always include vault-transfer
      },
    };

    // Add canUseTool callback if permission callback is provided
    if (requestToolPermission) {
      mergedOptions.canUseTool = createCanUseTool(requestToolPermission, askUserQuestion);
      log.info("Tool permission callback configured");
      if (askUserQuestion) {
        log.info("AskUserQuestion callback configured");
      }
    }

    log.debug("SDK options:", {
      model: mergedOptions.model,
      allowedTools: mergedOptions.allowedTools,
      permissionMode: mergedOptions.permissionMode,
      hasCanUseTool: !!mergedOptions.canUseTool,
    });
    const queryResult = query({
      prompt,
      options: mergedOptions,
    });

    // Extract session ID from first event
    log.info("Waiting for first SDK event...");
    const { sessionId, firstEvent } = await extractSessionId(queryResult);
    log.info(`Session created: ${sessionId}`);
    log.debug("First event type:", firstEvent.type);

    // Create and save session metadata
    const now = new Date().toISOString();
    const metadata: SessionMetadata = {
      id: sessionId,
      vaultId: vault.id,
      vaultPath: vault.path,
      createdAt: now,
      lastActiveAt: now,
      messages: [],
    };
    await saveSession(metadata);
    log.info("Session metadata saved");

    // Prune old sessions in background (non-blocking, errors logged internally)
    void (async () => {
      const config = await loadVaultConfig(vault.path);
      const keepCount = resolveRecentDiscussions(config);
      await pruneOldSessions(vault.path, keepCount);
    })();

    // Return wrapped result
    return {
      sessionId,
      events: wrapGenerator(firstEvent, queryResult),
      interrupt: () => queryResult.interrupt(),
      supportedCommands: () => queryResult.supportedCommands(),
    };
  } catch (error) {
    log.error("Failed to create session", error);
    if (error instanceof SessionError) {
      throw error;
    }
    throw new SessionError(mapSdkError(error), "SDK_ERROR");
  }
}

/**
 * Resumes an existing Claude Agent SDK session.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param sessionId - The session ID to resume
 * @param prompt - The prompt to send
 * @param options - Additional SDK options
 * @param requestToolPermission - Optional callback to request tool permission from user
 * @param askUserQuestion - Optional callback to handle AskUserQuestion tool
 * @returns SessionQueryResult with session ID and event stream
 */
export async function resumeSession(
  vaultPath: string,
  sessionId: string,
  prompt: string,
  options?: Partial<Options>,
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

  try {
    // Create SDK query with resume option and discussion mode defaults
    log.info("Calling Claude Agent SDK query() with resume...");

    // Load vault config to get discussion model
    const config = await loadVaultConfig(vaultPath);
    const model = resolveDiscussionModel(config);
    log.info(`Using discussion model: ${model}`);

    // Create vault transfer MCP server for this session
    const vaultTransferServer = createVaultTransferServer();

    const mergedOptions: Partial<Options> = {
      ...DISCUSSION_MODE_OPTIONS,
      model, // Set model from vault config
      ...options, // Merge defaults then caller options, then force specific fields below
      resume: sessionId,
      cwd: metadata.vaultPath,
      settingSources: ["local", "project", "user"],
      mcpServers: {
        ...options?.mcpServers,
        "vault-transfer": vaultTransferServer, // Always include vault-transfer
      },
    };

    // Add canUseTool callback if permission callback is provided
    if (requestToolPermission) {
      mergedOptions.canUseTool = createCanUseTool(requestToolPermission, askUserQuestion);
      log.info("Tool permission callback configured");
      if (askUserQuestion) {
        log.info("AskUserQuestion callback configured");
      }
    }

    log.debug("SDK options:", {
      model: mergedOptions.model,
      allowedTools: mergedOptions.allowedTools,
      permissionMode: mergedOptions.permissionMode,
      hasCanUseTool: !!mergedOptions.canUseTool,
    });
    const queryResult = query({
      prompt,
      options: mergedOptions,
    });

    // Extract session ID from first event (should match)
    log.info("Waiting for first SDK event...");
    const { sessionId: resumedId, firstEvent } =
      await extractSessionId(queryResult);
    log.info(`Session resumed: ${resumedId}`);

    // Update lastActiveAt
    metadata.lastActiveAt = new Date().toISOString();
    await saveSession(metadata);

    // Return wrapped result
    return {
      sessionId: resumedId,
      events: wrapGenerator(firstEvent, queryResult),
      interrupt: () => queryResult.interrupt(),
      supportedCommands: () => queryResult.supportedCommands(),
    };
  } catch (error) {
    log.error("Failed to resume session", error);
    if (error instanceof SessionError) {
      throw error;
    }
    throw new SessionError(mapSdkError(error), "SDK_ERROR");
  }
}

/**
 * Creates or resumes a session based on whether a session ID is provided.
 *
 * @param vault - The vault info
 * @param prompt - The prompt to send
 * @param sessionId - Optional session ID to resume
 * @param options - Additional SDK options
 * @param requestToolPermission - Optional callback to request tool permission from user
 * @returns SessionQueryResult
 */
export async function querySession(
  vault: VaultInfo,
  prompt: string,
  sessionId?: string,
  options?: Partial<Options>,
  requestToolPermission?: ToolPermissionCallback
): Promise<SessionQueryResult> {
  if (sessionId) {
    return resumeSession(vault.path, sessionId, prompt, options, requestToolPermission);
  }
  return createSession(vault, prompt, options, requestToolPermission);
}

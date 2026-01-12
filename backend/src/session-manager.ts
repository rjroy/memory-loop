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
import { directoryExists, fileExists } from "./vault-manager";
import { formatDateForFilename, formatTimeForTimestamp } from "./note-capture";
import { sessionLog as log } from "./logger";
import { createVaultTransferServer } from "./vault-transfer";

/** Model to use for strategic discussions (reasoning) */
export const DISCUSSION_MODEL = "opus";
/**
 * Default SDK options for Discussion mode.
 *
 * These options configure Claude for interactive vault exploration:
 * - allowedTools: Auto-allow read operations without user prompts
 * - permissionMode: Accept file edits in the vault automatically
 * - maxTurns: Prevent runaway conversations (50 turns = ~100 messages)
 * - maxBudgetUsd: Hard cost cap as safety net
 * - includePartialMessages: Enable streaming for real-time responses
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
    "WebFetch",
    "WebSearch",
    "TodoRead",
  ],
  model: DISCUSSION_MODEL,
  // Auto-accept file edits - the user is working in their own vault
  permissionMode: "acceptEdits",
  // Prevent runaway conversations (100 turns = ~200 messages)
  maxTurns: 100,
  // Hard cost cap as safety net ($2 is generous for a single conversation)
  maxBudgetUsd: 2.0,
  // Enable streaming for real-time response display
  includePartialMessages: true,
};

/**
 * Base directory for storing session metadata.
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
 * Gets the absolute path to the sessions directory.
 * Creates the directory if it doesn't exist.
 *
 * @returns Absolute path to sessions directory
 */
export async function getSessionsDir(): Promise<string> {
  // Use HOME directory as base, falling back to current directory
  const homeDir = process.env.HOME ?? process.cwd();
  const sessionsDir = join(homeDir, SESSIONS_DIR);

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
 * @param sessionId - The session ID
 * @returns Absolute path to session JSON file
 * @throws SessionError if session ID is invalid
 */
export async function getSessionFilePath(sessionId: string): Promise<string> {
  validateSessionId(sessionId);
  const sessionsDir = await getSessionsDir();
  return join(sessionsDir, `${sessionId}.json`);
}

/**
 * Saves session metadata to disk.
 *
 * @param metadata - The session metadata to save
 * @throws SessionError if storage fails
 */
export async function saveSession(metadata: SessionMetadata): Promise<void> {
  try {
    const filePath = await getSessionFilePath(metadata.id);
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
 * @param sessionId - The session ID to load
 * @returns SessionMetadata or null if not found
 * @throws SessionError if the file exists but is invalid
 */
export async function loadSession(
  sessionId: string
): Promise<SessionMetadata | null> {
  try {
    const filePath = await getSessionFilePath(sessionId);

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
 * @param sessionId - The session ID to delete
 * @returns true if deleted, false if not found
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    const filePath = await getSessionFilePath(sessionId);

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
 * @param vaultId - The vault ID to filter by
 * @returns Array of session IDs
 */
export async function listSessionsByVault(vaultId: string): Promise<string[]> {
  try {
    const sessionsDir = await getSessionsDir();

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
      const metadata = await loadSession(sessionId);

      if (metadata && metadata.vaultId === vaultId) {
        sessionIds.push(sessionId);
      }
    }

    return sessionIds;
  } catch {
    return [];
  }
}

/**
 * Gets recent discussion sessions for a vault, sorted by last activity.
 *
 * @param vaultId - The vault ID to filter by
 * @param limit - Maximum number of discussions to return (default 5)
 * @returns Array of RecentDiscussionEntry objects, sorted by most recent first
 */
export async function getRecentSessions(
  vaultId: string,
  limit = 5
): Promise<RecentDiscussionEntry[]> {
  try {
    const sessionsDir = await getSessionsDir();

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
        const metadata = await loadSession(sessionId);

        if (metadata && metadata.vaultId === vaultId && metadata.messages.length > 0) {
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
 * @param vaultId - The vault ID to prune sessions for
 * @param keepCount - Number of sessions to keep (default: 5)
 */
export async function pruneOldSessions(
  vaultId: string,
  keepCount = 5
): Promise<void> {
  try {
    const sessionsDir = await getSessionsDir();

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
        const metadata = await loadSession(sessionId);

        if (metadata && metadata.vaultId === vaultId) {
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
 * @param sessionId - The session ID to update
 */
export async function touchSession(sessionId: string): Promise<void> {
  const metadata = await loadSession(sessionId);
  if (metadata) {
    metadata.lastActiveAt = new Date().toISOString();
    await saveSession(metadata);
  }
}

/**
 * Gets the most recent session ID for a vault, if one exists.
 *
 * @param vaultId - The vault ID to look up
 * @returns The most recent session ID, or null if no session exists for this vault
 */
export async function getSessionForVault(
  vaultId: string
): Promise<string | null> {
  try {
    const sessionsDir = await getSessionsDir();

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
        metadata = await loadSession(sessionId);
      } catch {
        // Skip corrupted session files
        continue;
      }

      if (metadata && metadata.vaultId === vaultId) {
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
 *
 * @param sessionId - The session ID
 * @param message - The message to append
 * @throws SessionError if session not found
 */
export async function appendMessage(
  sessionId: string,
  message: ConversationMessage
): Promise<void> {
  const metadata = await loadSession(sessionId);
  if (!metadata) {
    throw new SessionError(
      `Session "${sessionId}" not found`,
      "SESSION_NOT_FOUND"
    );
  }

  metadata.messages.push(message);
  metadata.lastActiveAt = new Date().toISOString();
  await saveSession(metadata);
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
 * Creates the canUseTool callback for the SDK based on a permission callback.
 * This wraps the simpler ToolPermissionCallback into the SDK's expected format.
 *
 * @param requestPermission - Callback to request permission from the user
 * @returns A canUseTool function for the SDK options
 */
function createCanUseTool(
  requestPermission: ToolPermissionCallback
): (toolName: string, input: Record<string, unknown>) => Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }> {
  return async (toolName: string, input: Record<string, unknown>) => {
    // Generate a unique ID for this tool use request
    const toolUseId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    log.info(`Tool permission requested: ${toolName} (${toolUseId})`);

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
 * @returns SessionQueryResult with session ID and event stream
 */
export async function createSession(
  vault: VaultInfo,
  prompt: string,
  options?: Partial<Options>,
  requestToolPermission?: ToolPermissionCallback
): Promise<SessionQueryResult> {
  log.info(`Creating session for vault: ${vault.id}`);
  log.info(`Vault path: ${vault.path}`);
  log.debug(`Prompt: ${prompt.slice(0, 100)}...`);

  try {
    // Create SDK query with vault's cwd, project settings, and discussion mode defaults
    log.info("Calling Claude Agent SDK query()...");

    // Create vault transfer MCP server for this session
    const vaultTransferServer = createVaultTransferServer();

    const mergedOptions: Partial<Options> = {
      ...DISCUSSION_MODE_OPTIONS,
      ...options, // Merge defaults then caller options, then force specific fields below
      cwd: vault.path,
      settingSources: ["project", "user"],
      mcpServers: {
        ...options?.mcpServers,
        "vault-transfer": vaultTransferServer, // Always include vault-transfer
      },
    };

    // Add canUseTool callback if permission callback is provided
    if (requestToolPermission) {
      mergedOptions.canUseTool = createCanUseTool(requestToolPermission);
      log.info("Tool permission callback configured");
    }

    log.debug("SDK options:", {
      allowedTools: mergedOptions.allowedTools,
      permissionMode: mergedOptions.permissionMode,
      maxTurns: mergedOptions.maxTurns,
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
    void pruneOldSessions(vault.id);

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
 * @param sessionId - The session ID to resume
 * @param prompt - The prompt to send
 * @param options - Additional SDK options
 * @param requestToolPermission - Optional callback to request tool permission from user
 * @returns SessionQueryResult with session ID and event stream
 */
export async function resumeSession(
  sessionId: string,
  prompt: string,
  options?: Partial<Options>,
  requestToolPermission?: ToolPermissionCallback
): Promise<SessionQueryResult> {
  log.info(`Resuming session: ${sessionId}`);

  // Load existing session metadata
  const metadata = await loadSession(sessionId);

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

    // Create vault transfer MCP server for this session
    const vaultTransferServer = createVaultTransferServer();

    const mergedOptions: Partial<Options> = {
      ...DISCUSSION_MODE_OPTIONS,
      ...options, // Merge defaults then caller options, then force specific fields below
      resume: sessionId,
      cwd: metadata.vaultPath,
      settingSources: ["project", "user"],
      mcpServers: {
        ...options?.mcpServers,
        "vault-transfer": vaultTransferServer, // Always include vault-transfer
      },
    };

    // Add canUseTool callback if permission callback is provided
    if (requestToolPermission) {
      mergedOptions.canUseTool = createCanUseTool(requestToolPermission);
      log.info("Tool permission callback configured");
    }

    log.debug("SDK options:", {
      allowedTools: mergedOptions.allowedTools,
      permissionMode: mergedOptions.permissionMode,
      maxTurns: mergedOptions.maxTurns,
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
    return resumeSession(sessionId, prompt, options, requestToolPermission);
  }
  return createSession(vault, prompt, options, requestToolPermission);
}

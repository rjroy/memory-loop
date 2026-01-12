/**
 * WebSocket Message Handler
 *
 * Manages WebSocket connection state and routes incoming messages
 * to appropriate handlers. Streams Claude Agent SDK responses to clients.
 */

import type {
  ServerMessage,
  ClientMessage,
  ErrorCode,
  StoredToolInvocation,
  SlashCommand,
} from "@memory-loop/shared";
import type {
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
  SDKSystemMessage,
  ModelUsage,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Type alias for raw stream events from the SDK.
 * Not directly exported, so we extract it from the parent message type.
 */
type RawStreamEvent = SDKPartialAssistantMessage["event"];

/**
 * Stream events that have content (excludes error events).
 * Used after error check to avoid ESLint unsafe-* errors.
 */
type ContentStreamEvent = Exclude<RawStreamEvent, { type: "error" }>;

import { safeParseClientMessage } from "@memory-loop/shared";
import { discoverVaults, getVaultById } from "./vault-manager.js";
import { SearchIndexManager } from "./search/search-index.js";
import {
  createSession,
  resumeSession,
  loadSession,
  appendMessage,
  deleteSession,
  SessionError,
  type SessionQueryResult,
  type ToolPermissionCallback,
} from "./session-manager.js";
import { isMockMode, generateMockResponse, createMockSession } from "./mock-sdk.js";
import { wsLog as log } from "./logger.js";
import {
  loadVaultConfig,
  saveSlashCommands,
  slashCommandsEqual,
} from "./vault-config.js";
import { runVaultSetup } from "./vault-setup.js";
import { createWidgetEngine, createFileWatcher } from "./widgets/index.js";

// Import extracted handlers
import {
  type WebSocketLike,
  type ConnectionState,
  type HandlerContext,
  createConnectionState,
  generateMessageId,
} from "./handlers/types.js";

import {
  handleListDirectory,
  handleReadFile,
  handleWriteFile,
  handleDeleteFile,
} from "./handlers/browser-handlers.js";

import {
  handleSearchFiles,
  handleSearchContent,
  handleGetSnippets,
} from "./handlers/search-handlers.js";

import {
  handleGetGroundWidgets,
  handleGetRecallWidgets,
  handleWidgetEdit,
  handleWidgetFileChanges,
} from "./handlers/widget-handlers.js";

import {
  handleCaptureNote,
  handleGetRecentNotes,
  handleGetRecentActivity,
  handleGetGoals,
  handleGetInspiration,
  handleGetTasks,
  handleToggleTask,
} from "./handlers/home-handlers.js";

// Re-export types for external consumers
export type { WebSocketLike, ConnectionState };
export { createConnectionState, generateMessageId };

/**
 * Result from streaming SDK events.
 * Contains accumulated response text, tool invocations, and usage stats for persistence.
 */
interface StreamingResult {
  content: string;
  toolInvocations: StoredToolInvocation[];
  contextUsage?: number;
}

/**
 * Tracks state for a content block during streaming.
 * Used to accumulate tool input JSON across multiple delta events.
 */
interface ContentBlockState {
  type: "text" | "tool_use";
  toolUseId?: string;
  toolName?: string;
  inputJsonChunks?: string[];
}

/**
 * Maps SessionError codes to protocol ErrorCodes.
 * STORAGE_ERROR is mapped to INTERNAL_ERROR since it's not in the protocol.
 */
function mapSessionErrorCode(
  code: "SESSION_NOT_FOUND" | "SESSION_INVALID" | "SDK_ERROR" | "STORAGE_ERROR"
): ErrorCode {
  if (code === "STORAGE_ERROR") {
    return "INTERNAL_ERROR";
  }
  return code;
}

/**
 * Sanitizes slash commands to ensure argumentHint is either a valid string or omitted.
 * This prevents Zod validation errors on the client when argumentHint is null/undefined.
 */
function sanitizeSlashCommands(commands: SlashCommand[] | undefined): SlashCommand[] | undefined {
  if (!commands || commands.length === 0) {
    return undefined;
  }
  return commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    ...(typeof cmd.argumentHint === "string" && cmd.argumentHint
      ? { argumentHint: cmd.argumentHint }
      : {}),
  }));
}

/**
 * WebSocket handler class that manages connection state and message routing.
 */
export class WebSocketHandler {
  private state: ConnectionState;

  constructor() {
    this.state = createConnectionState();
  }

  /**
   * Gets the current connection state (for testing).
   */
  getState(): Readonly<ConnectionState> {
    return this.state;
  }

  /**
   * Sends a server message to the client.
   */
  private send(ws: WebSocketLike, message: ServerMessage): void {
    log.debug(`-> ${message.type}`, message);
    ws.send(JSON.stringify(message));
  }

  /**
   * Sends an error message to the client.
   */
  private sendError(
    ws: WebSocketLike,
    code: ErrorCode,
    message: string
  ): void {
    log.error(`Sending error: ${code} - ${message}`);
    this.send(ws, { type: "error", code, message });
  }

  /**
   * Creates a handler context for extracted handlers.
   */
  private createContext(ws: WebSocketLike): HandlerContext {
    return {
      state: this.state,
      send: (message: ServerMessage) => this.send(ws, message),
      sendError: (code: ErrorCode, message: string) => this.sendError(ws, code, message),
    };
  }

  /**
   * Fetches slash commands from a session with graceful error handling.
   * Returns empty array if the SDK call fails or returns empty.
   */
  private async fetchSlashCommands(
    queryResult: SessionQueryResult
  ): Promise<SlashCommand[]> {
    try {
      log.info("Fetching slash commands from SDK...");
      const sdkCommands = await queryResult.supportedCommands();

      if (sdkCommands.length === 0) {
        log.info("SDK returned no slash commands");
        return [];
      }

      const commands: SlashCommand[] = sdkCommands.map((cmd) => ({
        name: cmd.name.startsWith("/") ? cmd.name : `/${cmd.name}`,
        description: cmd.description,
        argumentHint: cmd.argumentHint || undefined,
      }));

      log.info(`Fetched ${commands.length} slash commands`);

      // Update cache if commands changed
      if (this.state.currentVault) {
        try {
          const vaultConfig = await loadVaultConfig(this.state.currentVault.path);
          if (!slashCommandsEqual(vaultConfig.slashCommands, commands)) {
            log.info("Slash commands changed, updating cache");
            await saveSlashCommands(this.state.currentVault.path, commands);
          }
        } catch (cacheError) {
          log.warn("Failed to update slash commands cache, continuing", cacheError);
        }
      }

      return commands;
    } catch (error) {
      log.warn("Failed to fetch slash commands from SDK, continuing without commands", error);
      return [];
    }
  }

  /**
   * Creates a tool permission callback that sends requests to the frontend
   * and waits for user response.
   */
  private createToolPermissionCallback(ws: WebSocketLike): ToolPermissionCallback {
    return async (toolUseId: string, toolName: string, input: unknown): Promise<boolean> => {
      log.info(`Requesting tool permission: ${toolName} (${toolUseId})`);

      if (ws.readyState !== 1) {
        log.warn("Connection closed, denying tool permission");
        return false;
      }

      return new Promise((resolve, reject) => {
        this.state.pendingPermissions.set(toolUseId, { resolve, reject });

        this.send(ws, {
          type: "tool_permission_request",
          toolUseId,
          toolName,
          input,
        });

        const timeout = setTimeout(() => {
          if (this.state.pendingPermissions.has(toolUseId)) {
            this.state.pendingPermissions.delete(toolUseId);
            log.warn(`Tool permission request timed out: ${toolUseId}`);
            resolve(false);
          }
        }, 60000);

        const originalResolve = resolve;
        this.state.pendingPermissions.set(toolUseId, {
          resolve: (allowed: boolean) => {
            clearTimeout(timeout);
            originalResolve(allowed);
          },
          reject: (error: Error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
      });
    };
  }

  /**
   * Handles a tool permission response from the frontend.
   */
  private handleToolPermissionResponse(toolUseId: string, allowed: boolean): void {
    const pending = this.state.pendingPermissions.get(toolUseId);
    if (pending) {
      log.info(`Tool permission response received: ${toolUseId} -> ${allowed ? "allowed" : "denied"}`);
      this.state.pendingPermissions.delete(toolUseId);
      pending.resolve(allowed);
    } else {
      log.warn(`Received permission response for unknown request: ${toolUseId}`);
    }
  }

  /**
   * Handles the connection open event.
   * Sends the vault list to the client.
   */
  async onOpen(ws: WebSocketLike): Promise<void> {
    log.info("Connection opened, discovering vaults...");
    try {
      const vaults = await discoverVaults();
      log.info(`Found ${vaults.length} vault(s)`, vaults.map((v) => v.id));
      this.send(ws, { type: "vault_list", vaults });
    } catch (error) {
      log.error("Failed to discover vaults", error);
      const message =
        error instanceof Error ? error.message : "Failed to discover vaults";
      this.sendError(ws, "INTERNAL_ERROR", message);
    }
  }

  /**
   * Handles the connection close event.
   * Cleans up any active queries and widget resources.
   */
  async onClose(): Promise<void> {
    log.info("Connection closed, cleaning up...");

    if (this.state.activeQuery) {
      log.info("Interrupting active query");
      try {
        await this.state.activeQuery.interrupt();
      } catch {
        // Ignore interrupt errors on close
      }
      this.state.activeQuery = null;
    }

    if (this.state.widgetWatcher) {
      log.info("Stopping widget file watcher");
      try {
        await this.state.widgetWatcher.stop();
      } catch {
        // Ignore stop errors on close
      }
      this.state.widgetWatcher = null;
    }

    if (this.state.widgetEngine) {
      log.info("Shutting down widget engine");
      this.state.widgetEngine.shutdown();
      this.state.widgetEngine = null;
    }

    this.state = createConnectionState();
    log.info("Cleanup complete");
  }

  /**
   * Main message handler that routes incoming messages.
   */
  async onMessage(
    ws: WebSocketLike,
    data: string | ArrayBuffer
  ): Promise<void> {
    const rawMessage =
      typeof data === "string" ? data : new TextDecoder().decode(data);

    let json: unknown;
    try {
      json = JSON.parse(rawMessage);
    } catch {
      log.warn("Received invalid JSON", rawMessage.slice(0, 100));
      this.sendError(ws, "VALIDATION_ERROR", "Invalid JSON");
      return;
    }

    const result = safeParseClientMessage(json);
    if (!result.success) {
      const errorMessage =
        result.error.issues[0]?.message ?? "Invalid message format";
      log.warn("Message validation failed", { json, errors: result.error.issues });
      this.sendError(ws, "VALIDATION_ERROR", errorMessage);
      return;
    }

    const message = result.data;
    log.info(`<- ${message.type}`, message);
    await this.routeMessage(ws, message);
  }

  /**
   * Routes a validated message to the appropriate handler.
   */
  private async routeMessage(
    ws: WebSocketLike,
    message: ClientMessage
  ): Promise<void> {
    const ctx = this.createContext(ws);

    switch (message.type) {
      // Vault and session management (kept in main handler due to tight coupling)
      case "select_vault":
        await this.handleSelectVault(ws, message.vaultId);
        break;
      case "resume_session":
        await this.handleResumeSession(ws, message.sessionId);
        break;
      case "new_session":
        await this.handleNewSession(ws);
        break;
      case "delete_session":
        await this.handleDeleteSession(ws, message.sessionId);
        break;
      case "discussion_message":
        await this.handleDiscussionMessage(ws, message.text);
        break;
      case "abort":
        await this.handleAbort(ws);
        break;
      case "tool_permission_response":
        this.handleToolPermissionResponse(message.toolUseId, message.allowed);
        break;
      case "setup_vault":
        await this.handleSetupVault(ws, message.vaultId);
        break;

      // Simple handlers
      case "ping":
        this.send(ws, { type: "pong" });
        break;

      // Browser handlers (extracted)
      case "list_directory":
        await handleListDirectory(ctx, message.path);
        break;
      case "read_file":
        await handleReadFile(ctx, message.path);
        break;
      case "write_file":
        await handleWriteFile(ctx, message.path, message.content);
        break;
      case "delete_file":
        await handleDeleteFile(ctx, message.path);
        break;

      // Search handlers (extracted)
      case "search_files":
        await handleSearchFiles(ctx, message.query, message.limit);
        break;
      case "search_content":
        await handleSearchContent(ctx, message.query, message.limit);
        break;
      case "get_snippets":
        await handleGetSnippets(ctx, message.path, message.query);
        break;

      // Widget handlers (extracted)
      case "get_ground_widgets":
        await handleGetGroundWidgets(ctx);
        break;
      case "get_recall_widgets":
        await handleGetRecallWidgets(ctx, message.path);
        break;
      case "widget_edit":
        await handleWidgetEdit(ctx, message.path, message.field, message.value);
        break;

      // Home/dashboard handlers (extracted)
      case "capture_note":
        await handleCaptureNote(ctx, message.text);
        break;
      case "get_recent_notes":
        await handleGetRecentNotes(ctx);
        break;
      case "get_recent_activity":
        await handleGetRecentActivity(ctx);
        break;
      case "get_goals":
        await handleGetGoals(ctx);
        break;
      case "get_inspiration":
        await handleGetInspiration(ctx);
        break;
      case "get_tasks":
        await handleGetTasks(ctx);
        break;
      case "toggle_task":
        await handleToggleTask(ctx, message.filePath, message.lineNumber, message.newState);
        break;
    }
  }

  // ===========================================================================
  // Vault and Session Handlers (kept in main file due to tight state coupling)
  // ===========================================================================

  /**
   * Handles select_vault message.
   * Initializes session for the selected vault.
   */
  private async handleSelectVault(
    ws: WebSocketLike,
    vaultId: string
  ): Promise<void> {
    log.info(`Selecting vault: ${vaultId}`);
    try {
      const vault = await getVaultById(vaultId);

      if (!vault) {
        log.warn(`Vault not found: ${vaultId}`);
        this.sendError(ws, "VAULT_NOT_FOUND", `Vault "${vaultId}" not found`);
        return;
      }

      log.info(`Vault found: ${vault.name} at ${vault.path}`);

      // Clean up existing widget resources
      if (this.state.widgetWatcher) {
        await this.state.widgetWatcher.stop();
        this.state.widgetWatcher = null;
      }
      if (this.state.widgetEngine) {
        this.state.widgetEngine.shutdown();
        this.state.widgetEngine = null;
      }

      // Update state
      this.state.currentVault = vault;
      this.state.currentSessionId = null;
      this.state.activeQuery = null;
      this.state.searchIndex = new SearchIndexManager(vault.contentRoot);

      // Initialize widget engine
      try {
        const { engine, loaderResult } = await createWidgetEngine(vault.contentRoot, vault.id);
        this.state.widgetEngine = engine;

        if (loaderResult.errors.length > 0) {
          log.warn(`Widget config errors for vault ${vault.id}:`, loaderResult.errors);
          for (const err of loaderResult.errors) {
            this.send(ws, {
              type: "widget_error",
              widgetId: err.id || undefined,
              error: `Config error in ${err.filePath}: ${err.error}`,
              filePath: err.filePath,
            });
          }
        }

        if (loaderResult.widgets.length > 0) {
          log.info(`Loaded widgets: ${loaderResult.widgets.map(w => `${w.id} (${w.config.location}, pattern: ${w.config.source.pattern})`).join(", ")}`);
        } else if (loaderResult.hasWidgetsDir) {
          log.info("Widgets directory exists but no valid widgets were loaded");
        }

        const widgets = engine.getWidgets();
        if (widgets.length > 0) {
          const patterns = [...new Set(widgets.map((w) => w.config.source.pattern))];
          this.state.widgetWatcher = createFileWatcher(
            vault.contentRoot,
            (changedPaths) => {
              handleWidgetFileChanges(this.createContext(ws), ws, changedPaths);
            }
          );
          await this.state.widgetWatcher.start(patterns);
          log.info(`Widget watcher started with ${patterns.length} pattern(s)`);
        }

        log.info(`Widget engine initialized: ${widgets.length} widget(s)`);
      } catch (widgetError) {
        log.error("Failed to initialize widget engine (continuing without widgets)", widgetError);
        this.send(ws, {
          type: "widget_error",
          error: widgetError instanceof Error ? widgetError.message : "Widget initialization failed",
        });
      }

      const vaultConfig = await loadVaultConfig(vault.path);
      const cachedCommands = vaultConfig.slashCommands;

      log.info("Sending session_ready");
      this.send(ws, {
        type: "session_ready",
        sessionId: "",
        vaultId: vault.id,
        slashCommands: sanitizeSlashCommands(cachedCommands),
      });
      log.info(`Vault selection complete (${cachedCommands?.length ?? 0} cached commands)`);
    } catch (error) {
      log.error("Failed to select vault", error);
      const message =
        error instanceof Error ? error.message : "Failed to select vault";
      this.sendError(ws, "INTERNAL_ERROR", message);
    }
  }

  /**
   * Handles discussion_message.
   * Queries the Claude Agent SDK and streams responses to the client.
   */
  private async handleDiscussionMessage(
    ws: WebSocketLike,
    text: string
  ): Promise<void> {
    log.info(`Discussion message (${text.length} chars)`);
    if (!this.state.currentVault) {
      log.warn("No vault selected for discussion");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    if (isMockMode()) {
      log.info("Using mock SDK mode");
      await this.handleMockDiscussion(ws, text);
      return;
    }

    if (this.state.activeQuery) {
      log.info("Aborting previous query");
      try {
        await this.state.activeQuery.interrupt();
      } catch {
        // Ignore interrupt errors
      }
      this.state.activeQuery = null;
    }

    const messageId = generateMessageId();
    log.info(`Starting query with messageId: ${messageId}`);

    try {
      let queryResult: SessionQueryResult;
      let isNewSession = false;
      const requestToolPermission = this.createToolPermissionCallback(ws);

      if (this.state.currentSessionId) {
        log.info(`Resuming session: ${this.state.currentSessionId}`);
        queryResult = await resumeSession(
          this.state.currentSessionId,
          text,
          undefined,
          requestToolPermission
        );
      } else {
        log.info("Creating new session");
        queryResult = await createSession(
          this.state.currentVault,
          text,
          undefined,
          requestToolPermission
        );
        isNewSession = true;
      }

      log.info(`Session ${isNewSession ? "created" : "resumed"}: ${queryResult.sessionId}`);

      this.state.activeQuery = queryResult;
      this.state.currentSessionId = queryResult.sessionId;

      if (isNewSession) {
        log.info(`Sending session_ready with new sessionId: ${queryResult.sessionId}`);
        const slashCommands = await this.fetchSlashCommands(queryResult);
        this.send(ws, {
          type: "session_ready",
          sessionId: queryResult.sessionId,
          vaultId: this.state.currentVault.id,
          createdAt: new Date().toISOString(),
          slashCommands: sanitizeSlashCommands(slashCommands),
        });
      }

      const userMessageId = generateMessageId();
      await appendMessage(queryResult.sessionId, {
        id: userMessageId,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      });

      this.send(ws, { type: "response_start", messageId });

      log.info("Streaming SDK events...");
      const streamResult = await this.streamEvents(ws, messageId, queryResult);

      this.send(ws, {
        type: "response_end",
        messageId,
        contextUsage: streamResult.contextUsage,
      });

      if (streamResult.content.length > 0 || streamResult.toolInvocations.length > 0) {
        await appendMessage(queryResult.sessionId, {
          id: messageId,
          role: "assistant",
          content: streamResult.content,
          timestamp: new Date().toISOString(),
          toolInvocations: streamResult.toolInvocations.length > 0 ? streamResult.toolInvocations : undefined,
          contextUsage: streamResult.contextUsage,
        });
      }

      log.info("Discussion complete");
      this.state.activeQuery = null;
    } catch (error) {
      log.error("Discussion failed", error);
      this.state.activeQuery = null;

      if (error instanceof SessionError) {
        this.sendError(ws, mapSessionErrorCode(error.code), error.message);
      } else {
        const message =
          error instanceof Error ? error.message : "SDK query failed";
        this.sendError(ws, "SDK_ERROR", message);
      }
    }
  }

  /**
   * Handles discussion message in mock mode.
   */
  private async handleMockDiscussion(
    ws: WebSocketLike,
    text: string
  ): Promise<void> {
    if (!this.state.currentSessionId && this.state.currentVault) {
      const newSessionId = createMockSession(this.state.currentVault.id);
      this.state.currentSessionId = newSessionId;
      log.info(`Mock session created: ${newSessionId}`);

      this.send(ws, {
        type: "session_ready",
        sessionId: newSessionId,
        vaultId: this.state.currentVault.id,
      });
    }

    for await (const event of generateMockResponse(text)) {
      if (ws.readyState !== 1) break;
      this.send(ws, event);
    }
  }

  /**
   * Handles resume_session message.
   */
  private async handleResumeSession(
    ws: WebSocketLike,
    sessionId: string
  ): Promise<void> {
    try {
      const metadata = await loadSession(sessionId);

      if (!metadata) {
        log.warn(`Session not found: ${sessionId}`);
        this.sendError(ws, "SESSION_NOT_FOUND", "Session not found");
        return;
      }

      if (this.state.currentVault && metadata.vaultId !== this.state.currentVault.id) {
        log.warn(
          `Session ${sessionId} belongs to vault ${metadata.vaultId}, not ${this.state.currentVault.id}`
        );
        this.sendError(ws, "SESSION_INVALID", "Session belongs to a different vault");
        return;
      }

      if (!this.state.currentVault) {
        const vault = await getVaultById(metadata.vaultId);
        if (!vault) {
          log.warn(`Vault ${metadata.vaultId} from session not found`);
          this.sendError(ws, "VAULT_NOT_FOUND", "Session's vault no longer exists");
          return;
        }
        this.state.currentVault = vault;
        log.info(`Set vault from session: ${vault.name}`);
      }

      this.state.currentSessionId = sessionId;
      log.info(`Resuming session ${sessionId} with ${metadata.messages.length} messages`);

      const vaultConfig = await loadVaultConfig(this.state.currentVault.path);
      const cachedCommands = vaultConfig.slashCommands;

      this.send(ws, {
        type: "session_ready",
        sessionId,
        vaultId: this.state.currentVault.id,
        messages: metadata.messages,
        createdAt: metadata.createdAt,
        slashCommands: sanitizeSlashCommands(cachedCommands),
      });
    } catch (error) {
      log.error("Failed to load session for validation", error);
      this.sendError(ws, "SESSION_NOT_FOUND", "Failed to load session");
    }
  }

  /**
   * Handles new_session message.
   */
  private async handleNewSession(ws: WebSocketLike): Promise<void> {
    if (!this.state.currentVault) {
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    if (this.state.activeQuery) {
      try {
        await this.state.activeQuery.interrupt();
      } catch {
        // Ignore interrupt errors
      }
      this.state.activeQuery = null;
    }

    this.state.currentSessionId = null;

    const vaultConfig = await loadVaultConfig(this.state.currentVault.path);
    const cachedCommands = vaultConfig.slashCommands;

    this.send(ws, {
      type: "session_ready",
      sessionId: "",
      vaultId: this.state.currentVault.id,
      slashCommands: sanitizeSlashCommands(cachedCommands),
    });
  }

  /**
   * Handles delete_session message.
   */
  private async handleDeleteSession(
    ws: WebSocketLike,
    sessionId: string
  ): Promise<void> {
    log.info(`Deleting session: ${sessionId.slice(0, 8)}...`);

    if (this.state.currentSessionId === sessionId) {
      log.warn("Attempted to delete active session");
      this.sendError(ws, "SESSION_INVALID", "Cannot delete the currently active session");
      return;
    }

    try {
      const deleted = await deleteSession(sessionId);
      if (deleted) {
        log.info(`Session deleted: ${sessionId.slice(0, 8)}...`);
        this.send(ws, { type: "session_deleted", sessionId });
      } else {
        log.warn(`Session not found: ${sessionId.slice(0, 8)}...`);
        this.sendError(ws, "SESSION_NOT_FOUND", `Session "${sessionId}" not found`);
      }
    } catch (error) {
      log.error("Failed to delete session", error);
      if (error instanceof SessionError) {
        this.sendError(ws, mapSessionErrorCode(error.code), error.message);
      } else {
        const message = error instanceof Error ? error.message : "Failed to delete session";
        this.sendError(ws, "INTERNAL_ERROR", message);
      }
    }
  }

  /**
   * Handles setup_vault message.
   */
  private async handleSetupVault(
    ws: WebSocketLike,
    vaultId: string
  ): Promise<void> {
    log.info(`Setting up vault: ${vaultId}`);

    const vault = await getVaultById(vaultId);
    if (!vault) {
      log.warn(`Vault not found for setup: ${vaultId}`);
      this.sendError(ws, "VAULT_NOT_FOUND", `Vault "${vaultId}" not found`);
      return;
    }

    if (!vault.hasClaudeMd) {
      log.warn(`Vault missing CLAUDE.md: ${vaultId}`);
      this.sendError(
        ws,
        "VALIDATION_ERROR",
        `Vault "${vault.name}" is missing CLAUDE.md at root`
      );
      return;
    }

    try {
      const result = await runVaultSetup(vaultId);

      log.info(
        `Setup complete for ${vaultId}: success=${result.success}, ` +
          `summary=${result.summary.length} items`
      );

      this.send(ws, {
        type: "setup_complete",
        vaultId,
        success: result.success,
        summary: result.summary,
        errors: result.errors,
      });
    } catch (error) {
      log.error(`Setup failed for ${vaultId}:`, error);
      const message =
        error instanceof Error ? error.message : "Setup failed unexpectedly";
      this.sendError(ws, "INTERNAL_ERROR", message);
    }
  }

  /**
   * Handles abort message.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async handleAbort(ws: WebSocketLike): Promise<void> {
    if (this.state.activeQuery) {
      try {
        await this.state.activeQuery.interrupt();
      } catch (error) {
        console.warn("Failed to abort query:", error);
      }
      this.state.activeQuery = null;
    }
  }

  // ===========================================================================
  // SDK Streaming (kept in main file due to complexity and tight coupling)
  // ===========================================================================

  /**
   * Streams SDK events to the client.
   * Maps SDK event types to WebSocket protocol messages.
   */
  private async streamEvents(
    ws: WebSocketLike,
    messageId: string,
    queryResult: SessionQueryResult
  ): Promise<StreamingResult> {
    const responseChunks: string[] = [];
    const toolsMap = new Map<string, StoredToolInvocation>();
    const contentBlocks = new Map<number, ContentBlockState>();
    let contextUsage: number | undefined;

    for await (const event of queryResult.events) {
      if (ws.readyState !== 1) {
        log.debug("Connection closed during streaming, stopping");
        for (const tool of toolsMap.values()) {
          if (tool.status === "running") {
            tool.status = "complete";
            tool.output = "[Connection closed before tool completed]";
          }
        }
        break;
      }

      log.debug(`SDK event: ${event.type}`, this.summarizeEvent(event));

      switch (event.type) {
        case "stream_event": {
          const text = this.handleStreamEvent(ws, messageId, event, toolsMap, contentBlocks);
          if (text) {
            responseChunks.push(text);
          }
          break;
        }
        case "result": {
          const usage = this.handleResultEvent(ws, event, toolsMap);
          if (usage !== undefined) {
            contextUsage = usage;
          }
          break;
        }
        case "user": {
          this.handleUserEvent(ws, event, toolsMap);
          break;
        }
        case "system": {
          const systemEvent = event as SDKSystemMessage;
          if (systemEvent.subtype === "init" && systemEvent.model) {
            this.state.activeModel = systemEvent.model;
            log.info(`Active model: ${systemEvent.model}`);
          }
          break;
        }
      }
    }

    return {
      content: responseChunks.join(""),
      toolInvocations: Array.from(toolsMap.values()),
      contextUsage,
    };
  }

  /**
   * Creates a summary of an SDK event for logging.
   */
  /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
  private summarizeEvent(event: SDKMessage): Record<string, unknown> {
    const summary: Record<string, unknown> = { type: event.type };

    if (event.type === "stream_event") {
      const rawStreamEvent = event.event;

      if (rawStreamEvent.type === "error") {
        summary.streamType = "error";
        return summary;
      }

      const streamEvent = rawStreamEvent as ContentStreamEvent;
      summary.streamType = streamEvent.type;

      if ("index" in streamEvent && typeof streamEvent.index === "number") {
        summary.index = streamEvent.index;
      }

      if (streamEvent.type === "content_block_start") {
        const cb = streamEvent.content_block;
        summary.contentBlock = {
          type: cb.type,
          id: "id" in cb ? cb.id : undefined,
          name: "name" in cb ? cb.name : undefined,
        };
      }

      if (streamEvent.type === "content_block_delta") {
        summary.deltaType = streamEvent.delta.type;
      }
    }

    return summary;
  }
  /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

  /**
   * Handles streaming events containing deltas and content block lifecycle.
   */
  /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
  private handleStreamEvent(
    ws: WebSocketLike,
    messageId: string,
    event: SDKPartialAssistantMessage,
    toolsMap: Map<string, StoredToolInvocation>,
    contentBlocks: Map<number, ContentBlockState>
  ): string {
    const rawStreamEvent = event.event;

    if (rawStreamEvent.type === "error") {
      log.warn("Stream error event received", { error: rawStreamEvent.error });
      return "";
    }

    const streamEvent = rawStreamEvent as ContentStreamEvent;

    if (streamEvent.type === "content_block_start") {
      const { index: blockIndex, content_block: contentBlock } = streamEvent;

      if (contentBlock.type === "tool_use") {
        const { id: toolUseId, name: toolName } = contentBlock;

        log.info(`Tool started: ${toolName} (${toolUseId})`);

        contentBlocks.set(blockIndex, {
          type: "tool_use",
          toolUseId,
          toolName,
          inputJsonChunks: [],
        });

        this.send(ws, {
          type: "tool_start",
          toolName,
          toolUseId,
        });

        toolsMap.set(toolUseId, {
          toolUseId,
          toolName,
          status: "running",
        });
      } else if (contentBlock.type === "text") {
        contentBlocks.set(blockIndex, { type: "text" });
      }

      return "";
    }

    if (streamEvent.type === "content_block_delta") {
      const { index: blockIndex, delta } = streamEvent;

      if (delta.type === "text_delta") {
        const { text } = delta;
        this.send(ws, {
          type: "response_chunk",
          messageId,
          content: text,
        });
        return text;
      }

      if (delta.type === "input_json_delta") {
        const { partial_json: partialJson } = delta;
        const block = contentBlocks.get(blockIndex);
        if (partialJson && block?.type === "tool_use" && block.inputJsonChunks) {
          block.inputJsonChunks.push(partialJson);
        }
      }

      return "";
    }

    if (streamEvent.type === "content_block_stop") {
      const { index: blockIndex } = streamEvent;
      const block = contentBlocks.get(blockIndex);

      if (block?.type === "tool_use" && block.toolUseId && block.inputJsonChunks) {
        const jsonStr = block.inputJsonChunks.join("");
        try {
          const input: unknown = jsonStr ? JSON.parse(jsonStr) : {};

          log.debug(`Tool input complete for ${block.toolName}`, { inputLength: jsonStr.length });

          this.send(ws, {
            type: "tool_input",
            toolUseId: block.toolUseId,
            input,
          });

          const tracked = toolsMap.get(block.toolUseId);
          if (tracked) {
            tracked.input = input;
          }
        } catch (err) {
          log.warn(`Failed to parse tool input JSON for ${block.toolUseId}`, { jsonStr, err });
        }
      }

      contentBlocks.delete(blockIndex);
      return "";
    }

    return "";
  }
  /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */

  /**
   * Handles result events containing tool usage and context statistics.
   */
  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  private handleResultEvent(
    ws: WebSocketLike,
    event: SDKResultMessage,
    toolsMap: Map<string, StoredToolInvocation>
  ): number | undefined {
    const { usage, modelUsage } = event;

    let contextUsage: number | undefined;
    if (usage && modelUsage) {
      const inputTokens = usage.input_tokens ?? 0;
      const outputTokens = usage.output_tokens ?? 0;
      const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
      const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
      const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

      const modelNames = Object.keys(modelUsage);
      const modelName = this.state.activeModel ?? modelNames[0];
      if (modelName && modelUsage[modelName]) {
        const modelStats: ModelUsage = modelUsage[modelName];
        const contextWindow = modelStats.contextWindow;
        if (contextWindow && contextWindow > 0) {
          contextUsage = Math.round((100 * totalTokens) / contextWindow);
          contextUsage = Math.max(0, Math.min(100, contextUsage));
          log.debug(`Context usage: ${totalTokens}/${contextWindow} = ${contextUsage}% (model: ${modelName})`);
        }
      }
    }

    const rawEvent = event as unknown as { result?: { content?: unknown[] } };
    const result = rawEvent.result;
    if (!result || !Array.isArray(result.content)) return contextUsage;

    for (const block of result.content) {
      if (typeof block !== "object" || block === null || !("type" in block)) continue;
      const typedBlock = block as {
        type: string;
        name?: string;
        id?: string;
        input?: unknown;
        tool_use_id?: string;
        content?: unknown;
      };

      if (typedBlock.type === "tool_use" && typedBlock.name && typedBlock.id) {
        const existing = toolsMap.get(typedBlock.id);
        if (!existing) {
          log.debug(`Tool ${typedBlock.name} (${typedBlock.id}) tracked from result event (fallback)`);
          toolsMap.set(typedBlock.id, {
            toolUseId: typedBlock.id,
            toolName: typedBlock.name,
            status: "running",
            input: typedBlock.input,
          });
          this.send(ws, {
            type: "tool_start",
            toolName: typedBlock.name,
            toolUseId: typedBlock.id,
          });
          if (typedBlock.input !== undefined) {
            this.send(ws, {
              type: "tool_input",
              toolUseId: typedBlock.id,
              input: typedBlock.input,
            });
          }
        } else if (!existing.input && typedBlock.input !== undefined) {
          existing.input = typedBlock.input;
        }
      } else if (typedBlock.type === "tool_result" && typedBlock.tool_use_id) {
        log.info(`Tool completed: ${typedBlock.tool_use_id}`);
        this.send(ws, {
          type: "tool_end",
          toolUseId: typedBlock.tool_use_id,
          output: typedBlock.content ?? null,
        });
        const tracked = toolsMap.get(typedBlock.tool_use_id);
        if (tracked) {
          tracked.output = typedBlock.content ?? null;
          tracked.status = "complete";
        }
      }
    }

    return contextUsage;
  }
  /* eslint-enable @typescript-eslint/no-unsafe-assignment */

  /**
   * Handles user events containing tool results.
   */
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
  private handleUserEvent(
    ws: WebSocketLike,
    event: SDKUserMessage,
    toolsMap: Map<string, StoredToolInvocation>
  ): void {
    const { message } = event;
    const content = message.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (typeof block !== "object" || block === null || !("type" in block)) continue;

      if (block.type === "tool_result" && "tool_use_id" in block) {
        const toolUseId = block.tool_use_id as string;
        const output = "content" in block ? block.content : null;

        log.info(`Tool completed (from user event): ${toolUseId}`);
        this.send(ws, {
          type: "tool_end",
          toolUseId,
          output: output ?? null,
        });

        const tracked = toolsMap.get(toolUseId);
        if (tracked) {
          tracked.output = output ?? null;
          tracked.status = "complete";
        }
      }
    }
  }
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
}

/**
 * Creates a new WebSocketHandler instance.
 * Factory function for creating handlers per connection.
 */
export function createWebSocketHandler(): WebSocketHandler {
  return new WebSocketHandler();
}

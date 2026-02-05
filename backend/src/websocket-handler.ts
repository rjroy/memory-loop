/**
 * WebSocket Message Handler
 *
 * Manages WebSocket connection state and routes incoming messages
 * to appropriate handlers. Delegates AI streaming to ActiveSessionController.
 */

import type {
  ServerMessage,
  ClientMessage,
  ErrorCode,
  SlashCommand,
  VaultInfo,
} from "@memory-loop/shared";
import type { SessionEvent, PendingPrompt } from "./streaming/types.js";
import { getActiveSessionController } from "./streaming/active-session-controller.js";

import { safeParseClientMessage } from "@memory-loop/shared";
import {
  discoverVaults as defaultDiscoverVaults,
  getVaultById as defaultGetVaultById,
  createVault as defaultCreateVault,
  VaultCreationError,
} from "./vault-manager.js";
import {
  loadSession as defaultLoadSession,
  type SessionMetadata,
} from "./session-manager.js";
import { isMockMode, generateMockResponse, createMockSession } from "./mock-sdk.js";
import { wsLog as log } from "./logger.js";
import {
  loadSlashCommands as defaultLoadSlashCommands,
} from "./vault-config.js";
import { runVaultSetup as defaultRunVaultSetup, type SetupResult } from "./vault-setup.js";
import { createHealthCollector, type HealthCollector } from "./health-collector.js";
import type { ActiveMeeting } from "./meeting-capture.js";

// Import handler types and utilities
import {
  type WebSocketLike,
  type HandlerContext,
} from "./handlers/types.js";

// =============================================================================
// Dependency Injection Types
// =============================================================================

/**
 * Dependencies for WebSocketHandler (injectable for testing).
 * All functions default to their real implementations.
 *
 * After REST API migration and ActiveSessionController integration, this interface
 * only contains dependencies needed for:
 * - Vault discovery and creation (for WebSocket session establishment)
 * - Session metadata loading (for resume_session validation)
 * - Slash commands caching
 */
export interface WebSocketHandlerDependencies {
  // Vault manager (for session establishment)
  discoverVaults?: () => Promise<VaultInfo[]>;
  getVaultById?: (id: string) => Promise<VaultInfo | null>;
  createVault?: (title: string) => Promise<VaultInfo>;

  // Session manager (for session validation on resume)
  loadSession?: (vaultPath: string, sessionId: string) => Promise<SessionMetadata | null>;

  // Slash commands (cached for session_ready responses)
  loadSlashCommands?: (vaultPath: string) => Promise<SlashCommand[] | undefined>;

  // Vault setup (called during create_vault)
  runVaultSetup?: (vaultId: string) => Promise<SetupResult>;
}

// Extraction prompt handlers (not yet migrated to REST)
import {
  handleGetExtractionPrompt,
  handleSaveExtractionPrompt,
  handleResetExtractionPrompt,
  handleTriggerExtraction,
} from "./handlers/memory-handlers.js";

// Pair writing handlers (require WebSocket for streaming)
import {
  handleQuickAction,
  handleAdvisoryAction,
} from "./handlers/pair-writing-handlers.js";

// Card generator handlers
import {
  handleGetCardGeneratorConfig,
  handleSaveCardGeneratorRequirements,
  handleSaveCardGeneratorConfig,
  handleResetCardGeneratorRequirements,
  handleTriggerCardGeneration,
  handleGetCardGenerationStatus,
} from "./handlers/card-generator-handlers.js";

// =============================================================================
// Simplified Connection State
// =============================================================================

/**
 * Connection state for a WebSocket client.
 * Simplified after ActiveSessionController integration - streaming state now lives in controller.
 */
export interface ConnectionState {
  /** Currently selected vault (null if none selected) */
  currentVault: VaultInfo | null;
  /** Current session ID (null if no session active) */
  currentSessionId: string | null;
  /** Health collector for tracking backend issues (null if no vault selected) */
  healthCollector: HealthCollector | null;
  /** Active meeting session (null if no meeting in progress) */
  activeMeeting: ActiveMeeting | null;
}

/**
 * Creates initial connection state for a new WebSocket connection.
 */
export function createConnectionState(): ConnectionState {
  return {
    currentVault: null,
    currentSessionId: null,
    healthCollector: null,
    activeMeeting: null,
  };
}

/**
 * Generates a unique message ID for response streaming.
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// Re-export types for external consumers
export type { WebSocketLike };

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
 *
 * After REST API migration, this handler focuses on:
 * - Vault discovery and session establishment (select_vault, create_vault)
 * - AI conversation streaming (discussion_message, abort)
 * - Interactive prompts (tool_permission, ask_user_question)
 * - Extraction prompt management (not yet migrated to REST)
 * - Pair writing (requires WebSocket for streaming)
 */
export class WebSocketHandler {
  private state: ConnectionState;
  private readonly deps: Required<WebSocketHandlerDependencies>;
  /** Unsubscribe function for controller events (null if not subscribed) */
  private controllerUnsubscribe: (() => void) | null = null;
  /** WebSocket reference for sending controller events (set during subscription) */
  private activeWs: WebSocketLike | null = null;

  constructor(deps: WebSocketHandlerDependencies = {}) {
    this.state = createConnectionState();
    this.deps = {
      discoverVaults: deps.discoverVaults ?? defaultDiscoverVaults,
      getVaultById: deps.getVaultById ?? defaultGetVaultById,
      createVault: deps.createVault ?? defaultCreateVault,
      loadSession: deps.loadSession ?? defaultLoadSession,
      loadSlashCommands: deps.loadSlashCommands ?? defaultLoadSlashCommands,
      runVaultSetup: deps.runVaultSetup ?? defaultRunVaultSetup,
    };
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
   *
   * After REST API migration and ActiveSessionController integration, only
   * extraction prompt and pair writing handlers use this context.
   * All deps are stubs that throw errors (the handlers that used them have
   * been migrated to REST or the controller).
   */
  private createContext(ws: WebSocketLike): HandlerContext {
    const notImplemented = () => {
      throw new Error("Handler migrated to REST API or ActiveSessionController");
    };

    // All deps are stubs - real functionality is in REST API or controller
    const minimalDeps = {
      createSession: notImplemented,
      resumeSession: notImplemented,
      appendMessage: notImplemented,
      captureToDaily: notImplemented,
      getRecentNotes: notImplemented,
      listDirectory: notImplemented,
      readMarkdownFile: notImplemented,
      writeMarkdownFile: notImplemented,
      deleteFile: notImplemented,
      getDirectoryContents: notImplemented,
      deleteDirectory: notImplemented,
      archiveFile: notImplemented,
      createDirectory: notImplemented,
      createFile: notImplemented,
      renameFile: notImplemented,
      moveFile: notImplemented,
      updateReferences: notImplemented,
      getInspiration: notImplemented,
      getAllTasks: notImplemented,
      toggleTask: notImplemented,
      getRecentSessions: notImplemented,
      loadVaultConfig: notImplemented,
    };

    return {
      state: this.state as unknown as import("./handlers/types.js").ConnectionState,
      send: (message: ServerMessage) => this.send(ws, message),
      sendError: (code: ErrorCode, message: string) => this.sendError(ws, code, message),
      // Cast to expected type - stubs throw if called (indicates bug)
      deps: minimalDeps as HandlerContext["deps"],
    };
  }

  /**
   * Subscribes to controller events and maps them to WebSocket messages.
   * Called when starting a discussion message.
   */
  private subscribeToController(ws: WebSocketLike): void {
    // Clean up any existing subscription
    if (this.controllerUnsubscribe) {
      this.controllerUnsubscribe();
    }

    this.activeWs = ws;
    const controller = getActiveSessionController();
    this.controllerUnsubscribe = controller.subscribe((event: SessionEvent) => {
      this.handleControllerEvent(event);
    });
  }

  /**
   * Unsubscribes from controller events.
   */
  private unsubscribeFromController(): void {
    if (this.controllerUnsubscribe) {
      this.controllerUnsubscribe();
      this.controllerUnsubscribe = null;
    }
    this.activeWs = null;
  }

  /**
   * Maps controller events to WebSocket messages.
   * This is the core of the transport layer - controller owns state,
   * this handler just translates events to the WebSocket protocol.
   */
  private handleControllerEvent(event: SessionEvent): void {
    const ws = this.activeWs;
    if (!ws || ws.readyState !== 1) {
      log.debug("WebSocket closed, ignoring controller event", { type: event.type });
      return;
    }

    switch (event.type) {
      // Direct passthrough - types match ServerMessage
      case "session_ready":
        // Update local state when controller emits session_ready
        this.state.currentSessionId = event.sessionId;
        this.send(ws, {
          type: "session_ready",
          sessionId: event.sessionId,
          vaultId: event.vaultId,
          createdAt: event.createdAt,
          // Note: slashCommands are fetched by controller but not exposed yet
        });
        break;

      case "response_start":
      case "response_chunk":
      case "response_end":
      case "tool_start":
      case "tool_input":
      case "tool_end":
      case "error":
        // These event types match ServerMessage directly
        this.send(ws, event as ServerMessage);
        break;

      case "prompt_pending":
        // Map prompt_pending to specific request types
        this.handlePromptPending(ws, event.prompt);
        break;

      // Internal events - no WebSocket message needed
      case "prompt_resolved":
      case "prompt_response_rejected":
      case "session_cleared":
        log.debug(`Internal controller event: ${event.type}`);
        break;
    }
  }

  /**
   * Maps a pending prompt to the appropriate WebSocket request message.
   */
  private handlePromptPending(ws: WebSocketLike, prompt: PendingPrompt): void {
    if (prompt.type === "tool_permission") {
      this.send(ws, {
        type: "tool_permission_request",
        toolUseId: prompt.id,
        toolName: prompt.toolName!,
        input: prompt.input,
      });
    } else if (prompt.type === "ask_user_question") {
      this.send(ws, {
        type: "ask_user_question_request",
        toolUseId: prompt.id,
        questions: prompt.questions!,
      });
    }
  }

  /**
   * Handles a tool permission response from the frontend.
   * Forwards to the controller which manages pending prompts.
   */
  private handleToolPermissionResponse(toolUseId: string, allowed: boolean): void {
    log.info(`Tool permission response: ${toolUseId} -> ${allowed ? "allowed" : "denied"}`);
    const controller = getActiveSessionController();
    controller.respondToPrompt(toolUseId, {
      type: "tool_permission",
      allowed,
    });
  }

  /**
   * Handles an AskUserQuestion response from the frontend.
   * Forwards to the controller which manages pending prompts.
   */
  private handleAskUserQuestionResponse(toolUseId: string, answers: Record<string, string>): void {
    log.info(`AskUserQuestion response: ${toolUseId}`);
    const controller = getActiveSessionController();
    controller.respondToPrompt(toolUseId, {
      type: "ask_user_question",
      answers,
    });
  }

  /**
   * Handles the connection open event.
   * Sends the vault list to the client.
   */
  async onOpen(ws: WebSocketLike): Promise<void> {
    log.info("Connection opened, discovering vaults...");
    try {
      const vaults = await this.deps.discoverVaults();
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
   * Cleans up subscriptions and session state.
   */
  async onClose(): Promise<void> {
    log.info("Connection closed, cleaning up...");

    // Unsubscribe from controller events
    this.unsubscribeFromController();

    // Clear the active session in the controller
    const controller = getActiveSessionController();
    if (controller.isStreaming()) {
      log.info("Clearing active session in controller");
      await controller.clearSession();
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
      // Vault and session management (kept for WebSocket session establishment)
      case "select_vault":
        await this.handleSelectVault(ws, message.vaultId);
        break;
      case "resume_session":
        await this.handleResumeSession(ws, message.sessionId);
        break;
      case "new_session":
        await this.handleNewSession(ws);
        break;
      case "create_vault":
        await this.handleCreateVault(ws, message.title);
        break;

      // AI conversation streaming (requires WebSocket for real-time updates)
      case "discussion_message":
        await this.handleDiscussionMessage(ws, message.text);
        break;
      case "abort":
        await this.handleAbort(ws);
        break;

      // Interactive prompts (require WebSocket for bidirectional communication)
      case "tool_permission_response":
        this.handleToolPermissionResponse(message.toolUseId, message.allowed);
        break;
      case "ask_user_question_response":
        this.handleAskUserQuestionResponse(message.toolUseId, message.answers);
        break;

      // Simple handlers
      case "ping":
        this.send(ws, { type: "pong" });
        break;

      // Health issue dismiss (kept for WebSocket-based health reporting)
      case "dismiss_health_issue":
        this.state.healthCollector?.dismiss(message.issueId);
        break;

      // Extraction prompt handlers (not yet migrated to REST)
      case "get_extraction_prompt":
        await handleGetExtractionPrompt(ctx);
        break;

      case "save_extraction_prompt":
        await handleSaveExtractionPrompt(ctx, message.content);
        break;

      case "reset_extraction_prompt":
        await handleResetExtractionPrompt(ctx);
        break;

      case "trigger_extraction":
        await handleTriggerExtraction(ctx);
        break;

      // Pair Writing handlers
      case "quick_action_request":
        await handleQuickAction(ctx, message);
        break;

      case "advisory_action_request":
        await handleAdvisoryAction(ctx, message);
        break;

      // Card Generator handlers
      case "get_card_generator_config":
        await handleGetCardGeneratorConfig(ctx);
        break;

      case "save_card_generator_requirements":
        await handleSaveCardGeneratorRequirements(ctx, message.content);
        break;

      case "save_card_generator_config":
        await handleSaveCardGeneratorConfig(ctx, message.weeklyByteLimit);
        break;

      case "reset_card_generator_requirements":
        await handleResetCardGeneratorRequirements(ctx);
        break;

      case "trigger_card_generation":
        await handleTriggerCardGeneration(ctx);
        break;

      case "get_card_generation_status":
        handleGetCardGenerationStatus(ctx);
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
      const vault = await this.deps.getVaultById(vaultId);

      if (!vault) {
        log.warn(`Vault not found: ${vaultId}`);
        this.sendError(ws, "VAULT_NOT_FOUND", `Vault "${vaultId}" not found`);
        return;
      }

      log.info(`Vault found: ${vault.name} at ${vault.path}`);

      // Clear health collector (will be recreated below)
      if (this.state.healthCollector) {
        this.state.healthCollector.clear();
        this.state.healthCollector = null;
      }
      // Clear active meeting (vault switch ends any in-progress meeting)
      this.state.activeMeeting = null;

      // Update state
      this.state.currentVault = vault;
      this.state.currentSessionId = null;
      // Note: searchIndex is now managed by REST API routes, not WebSocket

      // Create health collector and subscribe to changes
      this.state.healthCollector = createHealthCollector();
      this.state.healthCollector.subscribe((issues) => {
        this.send(ws, { type: "health_report", issues });
      });

      const cachedCommands = await this.deps.loadSlashCommands(vault.path);

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
   * Delegates to ActiveSessionController for SDK streaming.
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

    const controller = getActiveSessionController();

    // Clear any existing session if controller is streaming
    if (controller.isStreaming()) {
      log.info("Clearing previous streaming session");
      await controller.clearSession();
    }

    // Subscribe to controller events
    this.subscribeToController(ws);

    try {
      if (this.state.currentSessionId) {
        log.info(`Resuming session via controller: ${this.state.currentSessionId}`);
        await controller.resumeSession(
          this.state.currentVault.path,
          this.state.currentSessionId,
          text
        );
      } else {
        log.info("Creating new session via controller");
        await controller.startSession(this.state.currentVault, text);
        // session_ready will be emitted by controller, which updates state.currentSessionId
      }

      log.info("Discussion complete");
    } catch (error) {
      log.error("Discussion failed", error);
      const message =
        error instanceof Error ? error.message : "SDK query failed";
      this.sendError(ws, "SDK_ERROR", message);
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
      // Vault must be selected to find session (sessions stored per-vault)
      if (!this.state.currentVault) {
        log.warn("Cannot resume session: no vault selected");
        this.sendError(ws, "VAULT_NOT_FOUND", "Please select a vault first");
        return;
      }

      const metadata = await this.deps.loadSession(this.state.currentVault.path, sessionId);

      if (!metadata) {
        log.warn(`Session not found: ${sessionId}`);
        this.sendError(ws, "SESSION_NOT_FOUND", "Session not found");
        return;
      }

      if (metadata.vaultId !== this.state.currentVault.id) {
        log.warn(
          `Session ${sessionId} belongs to vault ${metadata.vaultId}, not ${this.state.currentVault.id}`
        );
        this.sendError(ws, "SESSION_INVALID", "Session belongs to a different vault");
        return;
      }

      this.state.currentSessionId = sessionId;
      log.info(`Resuming session ${sessionId} with ${metadata.messages.length} messages`);

      const cachedCommands = await this.deps.loadSlashCommands(this.state.currentVault.path);

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

    // Clear any active session in the controller
    const controller = getActiveSessionController();
    if (controller.isStreaming()) {
      await controller.clearSession();
    }

    this.state.currentSessionId = null;

    const cachedCommands = await this.deps.loadSlashCommands(this.state.currentVault.path);

    this.send(ws, {
      type: "session_ready",
      sessionId: "",
      vaultId: this.state.currentVault.id,
      slashCommands: sanitizeSlashCommands(cachedCommands),
    });
  }

  /**
   * Handles create_vault message.
   * Creates a new vault directory with CLAUDE.md and runs setup.
   */
  private async handleCreateVault(
    ws: WebSocketLike,
    title: string
  ): Promise<void> {
    log.info(`Creating vault with title: "${title}"`);

    try {
      // Create the vault directory and CLAUDE.md
      const vault = await this.deps.createVault(title);

      // Run vault setup to configure the new vault
      try {
        await this.deps.runVaultSetup(vault.id);
        log.info(`Vault setup completed for: ${vault.id}`);
      } catch (setupError) {
        // Log setup error but don't fail - vault was created successfully
        log.warn(`Vault setup had issues for ${vault.id}:`, setupError);
      }

      // Re-fetch vault info to get updated setupComplete status
      const updatedVault = await this.deps.getVaultById(vault.id);

      // Send success response with the new vault
      this.send(ws, {
        type: "vault_created",
        vault: updatedVault ?? vault,
      });

      log.info(`Vault created successfully: ${vault.id} (${vault.name})`);
    } catch (error) {
      log.error("Failed to create vault:", error);

      if (error instanceof VaultCreationError) {
        this.sendError(ws, "VALIDATION_ERROR", error.message);
      } else {
        const message =
          error instanceof Error ? error.message : "Failed to create vault";
        this.sendError(ws, "INTERNAL_ERROR", message);
      }
    }
  }

  /**
   * Handles abort message.
   * Delegates to the controller to clear the active session.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async handleAbort(ws: WebSocketLike): Promise<void> {
    const controller = getActiveSessionController();
    if (controller.isStreaming()) {
      log.info("Aborting active session");
      await controller.clearSession();
    }
  }

}

/**
 * Creates a new WebSocketHandler instance.
 * Factory function for creating handlers per connection.
 *
 * @param deps - Optional dependencies for testing
 */
export function createWebSocketHandler(
  deps?: WebSocketHandlerDependencies
): WebSocketHandler {
  return new WebSocketHandler(deps);
}

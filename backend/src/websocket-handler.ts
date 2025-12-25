/**
 * WebSocket Message Handler
 *
 * Manages WebSocket connection state and routes incoming messages
 * to appropriate handlers. Streams Claude Agent SDK responses to clients.
 */

import type {
  VaultInfo,
  ServerMessage,
  ClientMessage,
  ErrorCode,
} from "@memory-loop/shared";
import { safeParseClientMessage } from "@memory-loop/shared";
import { discoverVaults, getVaultById } from "./vault-manager";
import {
  createSession,
  resumeSession,
  loadSession,
  appendMessage,
  SessionError,
  type SessionQueryResult,
} from "./session-manager";
import { captureToDaily, getRecentNotes } from "./note-capture";
import {
  listDirectory,
  readMarkdownFile,
  FileBrowserError,
} from "./file-browser";
import { isMockMode, generateMockResponse, createMockSession } from "./mock-sdk";
import { wsLog as log } from "./logger";

/**
 * WebSocket interface for sending messages.
 * Abstracts over different WebSocket implementations.
 */
export interface WebSocketLike {
  send(data: string): void;
  readyState: number;
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
 * Connection state for a WebSocket client.
 * Each connection tracks its selected vault and active session.
 */
export interface ConnectionState {
  /** Currently selected vault (null if none selected) */
  currentVault: VaultInfo | null;
  /** Current session ID (null if no session active) */
  currentSessionId: string | null;
  /** Active query result with interrupt function (null if no query running) */
  activeQuery: SessionQueryResult | null;
}

/**
 * Creates initial connection state for a new WebSocket connection.
 */
export function createConnectionState(): ConnectionState {
  return {
    currentVault: null,
    currentSessionId: null,
    activeQuery: null,
  };
}

/**
 * Generates a unique message ID for response streaming.
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
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
   * Cleans up any active queries.
   */
  async onClose(): Promise<void> {
    log.info("Connection closed, cleaning up...");
    // Interrupt any active query
    if (this.state.activeQuery) {
      log.info("Interrupting active query");
      try {
        await this.state.activeQuery.interrupt();
      } catch {
        // Ignore interrupt errors on close
      }
      this.state.activeQuery = null;
    }

    // Reset state
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
    // Parse raw data to string
    const rawMessage =
      typeof data === "string" ? data : new TextDecoder().decode(data);

    // Parse JSON
    let json: unknown;
    try {
      json = JSON.parse(rawMessage);
    } catch {
      log.warn("Received invalid JSON", rawMessage.slice(0, 100));
      this.sendError(ws, "VALIDATION_ERROR", "Invalid JSON");
      return;
    }

    // Validate with Zod schema
    const result = safeParseClientMessage(json);
    if (!result.success) {
      const errorMessage =
        result.error.errors[0]?.message ?? "Invalid message format";
      log.warn("Message validation failed", { json, errors: result.error.errors });
      this.sendError(ws, "VALIDATION_ERROR", errorMessage);
      return;
    }

    // Route to appropriate handler
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
    switch (message.type) {
      case "select_vault":
        await this.handleSelectVault(ws, message.vaultId);
        break;
      case "capture_note":
        await this.handleCaptureNote(ws, message.text);
        break;
      case "discussion_message":
        await this.handleDiscussionMessage(ws, message.text);
        break;
      case "resume_session":
        await this.handleResumeSession(ws, message.sessionId);
        break;
      case "new_session":
        await this.handleNewSession(ws);
        break;
      case "abort":
        await this.handleAbort(ws);
        break;
      case "ping":
        this.handlePing(ws);
        break;
      case "list_directory":
        await this.handleListDirectory(ws, message.path);
        break;
      case "read_file":
        await this.handleReadFile(ws, message.path);
        break;
      case "get_recent_notes":
        await this.handleGetRecentNotes(ws);
        break;
    }
  }

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

      // Update state with selected vault
      this.state.currentVault = vault;
      this.state.currentSessionId = null;
      this.state.activeQuery = null;

      log.info("Sending session_ready");
      // Send session_ready with empty session (will be created on first message)
      // For now, we signal readiness without a session ID - the session will be
      // created lazily on the first discussion_message
      this.send(ws, {
        type: "session_ready",
        sessionId: "", // Will be populated after first query
        vaultId: vault.id,
      });
      log.info("Vault selection complete");
    } catch (error) {
      log.error("Failed to select vault", error);
      const message =
        error instanceof Error ? error.message : "Failed to select vault";
      this.sendError(ws, "INTERNAL_ERROR", message);
    }
  }

  /**
   * Handles capture_note message.
   * Captures text to the daily note in the selected vault.
   */
  private async handleCaptureNote(
    ws: WebSocketLike,
    text: string
  ): Promise<void> {
    log.info(`Capturing note (${text.length} chars)`);
    if (!this.state.currentVault) {
      log.warn("No vault selected for note capture");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    try {
      const result = await captureToDaily(this.state.currentVault, text);

      if (!result.success) {
        log.error("Note capture failed", result.error);
        this.sendError(
          ws,
          "NOTE_CAPTURE_FAILED",
          result.error ?? "Failed to capture note"
        );
        return;
      }

      log.info(`Note captured at ${result.timestamp}`);
      this.send(ws, {
        type: "note_captured",
        timestamp: result.timestamp,
      });
    } catch (error) {
      log.error("Note capture threw", error);
      const message =
        error instanceof Error ? error.message : "Failed to capture note";
      this.sendError(ws, "NOTE_CAPTURE_FAILED", message);
    }
  }

  /**
   * Handles discussion_message.
   * Queries the Claude Agent SDK and streams responses to the client.
   * Uses mock responses when MOCK_SDK=true.
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

    // Use mock mode for testing
    if (isMockMode()) {
      log.info("Using mock SDK mode");
      await this.handleMockDiscussion(ws, text);
      return;
    }

    // Abort any existing query before starting a new one
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
      // Create or resume session
      let queryResult: SessionQueryResult;
      let isNewSession = false;

      if (this.state.currentSessionId) {
        // Resume existing session
        log.info(`Resuming session: ${this.state.currentSessionId}`);
        queryResult = await resumeSession(this.state.currentSessionId, text);
      } else {
        // Create new session
        log.info("Creating new session");
        queryResult = await createSession(this.state.currentVault, text);
        isNewSession = true;
      }

      log.info(`Session ${isNewSession ? "created" : "resumed"}: ${queryResult.sessionId}`);

      // Store active query for potential abort
      this.state.activeQuery = queryResult;
      this.state.currentSessionId = queryResult.sessionId;

      // Notify client of new session ID so it can persist for resume
      if (isNewSession) {
        log.info(`Sending session_ready with new sessionId: ${queryResult.sessionId}`);
        this.send(ws, {
          type: "session_ready",
          sessionId: queryResult.sessionId,
          vaultId: this.state.currentVault.id,
        });
      }

      // Save user message to session before streaming response
      const userMessageId = generateMessageId();
      await appendMessage(queryResult.sessionId, {
        id: userMessageId,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      });

      // Send response_start
      this.send(ws, { type: "response_start", messageId });

      // Stream events from SDK and accumulate response
      log.info("Streaming SDK events...");
      const responseContent = await this.streamEvents(ws, messageId, queryResult);

      // Send response_end
      this.send(ws, { type: "response_end", messageId });

      // Save assistant message to session after streaming completes
      if (responseContent.length > 0) {
        await appendMessage(queryResult.sessionId, {
          id: messageId,
          role: "assistant",
          content: responseContent,
          timestamp: new Date().toISOString(),
        });
      }

      log.info("Discussion complete");

      // Clear active query after completion
      this.state.activeQuery = null;
    } catch (error) {
      log.error("Discussion failed", error);
      // Clear active query on error
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
   * Streams pre-defined mock responses for testing.
   */
  private async handleMockDiscussion(
    ws: WebSocketLike,
    text: string
  ): Promise<void> {
    // Create mock session if needed
    if (!this.state.currentSessionId && this.state.currentVault) {
      const newSessionId = createMockSession(this.state.currentVault.id);
      this.state.currentSessionId = newSessionId;
      log.info(`Mock session created: ${newSessionId}`);

      // Notify client of new session ID so it can persist for resume
      this.send(ws, {
        type: "session_ready",
        sessionId: newSessionId,
        vaultId: this.state.currentVault.id,
      });
    }

    // Stream mock response events
    for await (const event of generateMockResponse(text)) {
      if (ws.readyState !== 1) break;
      this.send(ws, event);
    }
  }

  /**
   * Streams SDK events to the client.
   * Maps SDK event types to WebSocket protocol messages.
   * Returns the accumulated response text for persistence.
   *
   * The SDK emits various event types. We handle the ones relevant to our protocol:
   * - assistant: Contains message with content blocks
   * - stream_event: May contain content_block_delta with text deltas
   * - result: Contains tool_use and tool_result information
   */
  private async streamEvents(
    ws: WebSocketLike,
    messageId: string,
    queryResult: SessionQueryResult
  ): Promise<string> {
    const responseChunks: string[] = [];

    for await (const event of queryResult.events) {
      // Check if connection is still open (readyState === 1)
      if (ws.readyState !== 1) {
        // Connection closed, stop streaming
        break;
      }

      // Cast to unknown for flexible property checking
      // The SDK types are more constrained than runtime events
      const rawEvent = event as unknown as Record<string, unknown>;
      const eventType = rawEvent.type as string;

      // Handle different event types
      if (eventType === "assistant") {
        // Text content from assistant message
        const text = this.handleAssistantEvent(ws, messageId, rawEvent);
        if (text) {
          responseChunks.push(text);
        }
      } else if (eventType === "stream_event") {
        // Streaming events (deltas, tool progress, etc.)
        const text = this.handleStreamEvent(ws, messageId, rawEvent);
        if (text) {
          responseChunks.push(text);
        }
      } else if (eventType === "result") {
        // Result events contain tool usage info
        this.handleResultEvent(ws, rawEvent);
      }
      // Ignore other event types (system, user, auth_status, etc.)
    }

    return responseChunks.join("");
  }

  /**
   * Handles assistant events containing message content.
   * Returns extracted text content for accumulation.
   */
  private handleAssistantEvent(
    ws: WebSocketLike,
    messageId: string,
    event: Record<string, unknown>
  ): string {
    const message = event.message as
      | { content?: Array<{ type: string; text?: string }> }
      | undefined;

    const textParts: string[] = [];

    if (message?.content) {
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          this.send(ws, {
            type: "response_chunk",
            messageId,
            content: block.text,
          });
          textParts.push(block.text);
        }
      }
    }

    return textParts.join("");
  }

  /**
   * Handles streaming events containing deltas.
   * Returns extracted text content for accumulation.
   */
  private handleStreamEvent(
    ws: WebSocketLike,
    messageId: string,
    event: Record<string, unknown>
  ): string {
    const streamEvent = event.event as Record<string, unknown> | undefined;
    if (!streamEvent) return "";

    const streamType = streamEvent.type as string | undefined;

    if (streamType === "content_block_delta") {
      const delta = streamEvent.delta as
        | { type?: string; text?: string }
        | undefined;
      if (delta?.type === "text_delta" && delta.text) {
        this.send(ws, {
          type: "response_chunk",
          messageId,
          content: delta.text,
        });
        return delta.text;
      }
    }

    return "";
  }

  /**
   * Handles result events containing tool usage.
   */
  private handleResultEvent(
    ws: WebSocketLike,
    event: Record<string, unknown>
  ): void {
    const result = event.result as Record<string, unknown> | undefined;
    if (!result) return;

    // Check for tool_use blocks in the result
    const content = result.content as
      | Array<{
          type: string;
          name?: string;
          id?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: unknown;
        }>
      | undefined;

    if (content) {
      for (const block of content) {
        if (block.type === "tool_use" && block.name && block.id) {
          this.send(ws, {
            type: "tool_start",
            toolName: block.name,
            toolUseId: block.id,
          });
          if (block.input !== undefined) {
            this.send(ws, {
              type: "tool_input",
              toolUseId: block.id,
              input: block.input,
            });
          }
        } else if (block.type === "tool_result" && block.tool_use_id) {
          this.send(ws, {
            type: "tool_end",
            toolUseId: block.tool_use_id,
            output: block.content ?? null,
          });
        }
      }
    }
  }

  /**
   * Handles resume_session message.
   * Loads an existing session and sets up the vault from session metadata.
   * This allows resume_session to work without a prior select_vault call.
   */
  private async handleResumeSession(
    ws: WebSocketLike,
    sessionId: string
  ): Promise<void> {
    // Load session metadata first
    try {
      const metadata = await loadSession(sessionId);

      if (!metadata) {
        log.warn(`Session not found: ${sessionId}`);
        this.sendError(ws, "SESSION_NOT_FOUND", "Session not found");
        return;
      }

      // If vault is already set, validate it matches the session
      if (this.state.currentVault && metadata.vaultId !== this.state.currentVault.id) {
        log.warn(
          `Session ${sessionId} belongs to vault ${metadata.vaultId}, not ${this.state.currentVault.id}`
        );
        this.sendError(
          ws,
          "SESSION_INVALID",
          "Session belongs to a different vault"
        );
        return;
      }

      // If no vault set, look up the vault from the session's vaultId
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

      // Store the session ID - actual SDK resume happens on next discussion_message
      this.state.currentSessionId = sessionId;

      log.info(`Resuming session ${sessionId} with ${metadata.messages.length} messages`);

      // Send session_ready with conversation history for frontend to display
      this.send(ws, {
        type: "session_ready",
        sessionId,
        vaultId: this.state.currentVault.id,
        messages: metadata.messages,
      });
    } catch (error) {
      log.error("Failed to load session for validation", error);
      this.sendError(ws, "SESSION_NOT_FOUND", "Failed to load session");
    }
  }

  /**
   * Handles new_session message.
   * Clears the current session to start fresh.
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

    // Abort any active query
    if (this.state.activeQuery) {
      try {
        await this.state.activeQuery.interrupt();
      } catch {
        // Ignore interrupt errors
      }
      this.state.activeQuery = null;
    }

    // Clear session ID - next discussion_message will create a new session
    this.state.currentSessionId = null;

    this.send(ws, {
      type: "session_ready",
      sessionId: "", // Empty indicates new session will be created
      vaultId: this.state.currentVault.id,
    });
  }

  /**
   * Handles abort message.
   * Cancels any in-flight SDK request.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async handleAbort(ws: WebSocketLike): Promise<void> {
    if (this.state.activeQuery) {
      try {
        await this.state.activeQuery.interrupt();
      } catch (error) {
        // Log but don't send error - abort is best-effort
        console.warn("Failed to abort query:", error);
      }
      this.state.activeQuery = null;
    }

    // Send acknowledgment - we don't have a specific ack message type,
    // so the client can infer abort success from subsequent messages
  }

  /**
   * Handles ping message.
   * Sends pong response for keep-alive.
   */
  private handlePing(ws: WebSocketLike): void {
    this.send(ws, { type: "pong" });
  }

  /**
   * Handles list_directory message.
   * Lists contents of a directory within the selected vault.
   */
  private async handleListDirectory(
    ws: WebSocketLike,
    path: string
  ): Promise<void> {
    log.info(`Listing directory: ${path || "/"}`);
    if (!this.state.currentVault) {
      log.warn("No vault selected for directory listing");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    try {
      const entries = await listDirectory(this.state.currentVault.path, path);
      log.info(`Found ${entries.length} entries in ${path || "/"}`);
      this.send(ws, {
        type: "directory_listing",
        path,
        entries,
      });
    } catch (error) {
      log.error("Directory listing failed", error);
      if (error instanceof FileBrowserError) {
        this.sendError(ws, error.code, error.message);
      } else {
        const message =
          error instanceof Error ? error.message : "Failed to list directory";
        this.sendError(ws, "INTERNAL_ERROR", message);
      }
    }
  }

  /**
   * Handles read_file message.
   * Reads a markdown file from the selected vault.
   */
  private async handleReadFile(
    ws: WebSocketLike,
    path: string
  ): Promise<void> {
    log.info(`Reading file: ${path}`);
    if (!this.state.currentVault) {
      log.warn("No vault selected for file reading");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    try {
      const result = await readMarkdownFile(this.state.currentVault.path, path);
      log.info(`File read: ${path} (truncated: ${result.truncated})`);
      this.send(ws, {
        type: "file_content",
        path,
        content: result.content,
        truncated: result.truncated,
      });
    } catch (error) {
      log.error("File reading failed", error);
      if (error instanceof FileBrowserError) {
        this.sendError(ws, error.code, error.message);
      } else {
        const message =
          error instanceof Error ? error.message : "Failed to read file";
        this.sendError(ws, "INTERNAL_ERROR", message);
      }
    }
  }

  /**
   * Handles get_recent_notes message.
   * Returns recent captured notes from the vault inbox.
   */
  private async handleGetRecentNotes(ws: WebSocketLike): Promise<void> {
    log.info("Getting recent notes");
    if (!this.state.currentVault) {
      log.warn("No vault selected for recent notes");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    try {
      const notes = await getRecentNotes(this.state.currentVault, 5);
      log.info(`Found ${notes.length} recent notes`);
      this.send(ws, {
        type: "recent_notes",
        notes,
      });
    } catch (error) {
      log.error("Failed to get recent notes", error);
      const message =
        error instanceof Error ? error.message : "Failed to get recent notes";
      this.sendError(ws, "INTERNAL_ERROR", message);
    }
  }
}

/**
 * Creates a new WebSocketHandler instance.
 * Factory function for creating handlers per connection.
 */
export function createWebSocketHandler(): WebSocketHandler {
  return new WebSocketHandler();
}

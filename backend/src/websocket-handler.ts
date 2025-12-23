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
  SessionError,
  type SessionQueryResult,
} from "./session-manager";
import { captureToDaily } from "./note-capture";

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
    this.send(ws, { type: "error", code, message });
  }

  /**
   * Handles the connection open event.
   * Sends the vault list to the client.
   */
  async onOpen(ws: WebSocketLike): Promise<void> {
    try {
      const vaults = await discoverVaults();
      this.send(ws, { type: "vault_list", vaults });
    } catch (error) {
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
    // Interrupt any active query
    if (this.state.activeQuery) {
      try {
        await this.state.activeQuery.interrupt();
      } catch {
        // Ignore interrupt errors on close
      }
      this.state.activeQuery = null;
    }

    // Reset state
    this.state = createConnectionState();
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
      this.sendError(ws, "VALIDATION_ERROR", "Invalid JSON");
      return;
    }

    // Validate with Zod schema
    const result = safeParseClientMessage(json);
    if (!result.success) {
      const errorMessage =
        result.error.errors[0]?.message ?? "Invalid message format";
      this.sendError(ws, "VALIDATION_ERROR", errorMessage);
      return;
    }

    // Route to appropriate handler
    const message = result.data;
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
        this.handleResumeSession(ws, message.sessionId);
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
    try {
      const vault = await getVaultById(vaultId);

      if (!vault) {
        this.sendError(ws, "VAULT_NOT_FOUND", `Vault "${vaultId}" not found`);
        return;
      }

      // Update state with selected vault
      this.state.currentVault = vault;
      this.state.currentSessionId = null;
      this.state.activeQuery = null;

      // Send session_ready with empty session (will be created on first message)
      // For now, we signal readiness without a session ID - the session will be
      // created lazily on the first discussion_message
      this.send(ws, {
        type: "session_ready",
        sessionId: "", // Will be populated after first query
        vaultId: vault.id,
      });
    } catch (error) {
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
    if (!this.state.currentVault) {
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
        this.sendError(
          ws,
          "NOTE_CAPTURE_FAILED",
          result.error ?? "Failed to capture note"
        );
        return;
      }

      this.send(ws, {
        type: "note_captured",
        timestamp: result.timestamp,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to capture note";
      this.sendError(ws, "NOTE_CAPTURE_FAILED", message);
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
    if (!this.state.currentVault) {
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    // Abort any existing query before starting a new one
    if (this.state.activeQuery) {
      try {
        await this.state.activeQuery.interrupt();
      } catch {
        // Ignore interrupt errors
      }
      this.state.activeQuery = null;
    }

    const messageId = generateMessageId();

    try {
      // Create or resume session
      let queryResult: SessionQueryResult;

      if (this.state.currentSessionId) {
        // Resume existing session
        queryResult = await resumeSession(this.state.currentSessionId, text);
      } else {
        // Create new session
        queryResult = await createSession(this.state.currentVault, text);
      }

      // Store active query for potential abort
      this.state.activeQuery = queryResult;
      this.state.currentSessionId = queryResult.sessionId;

      // Send response_start
      this.send(ws, { type: "response_start", messageId });

      // Stream events from SDK
      await this.streamEvents(ws, messageId, queryResult);

      // Send response_end
      this.send(ws, { type: "response_end", messageId });

      // Clear active query after completion
      this.state.activeQuery = null;
    } catch (error) {
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
   * Streams SDK events to the client.
   * Maps SDK event types to WebSocket protocol messages.
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
  ): Promise<void> {
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
        this.handleAssistantEvent(ws, messageId, rawEvent);
      } else if (eventType === "stream_event") {
        // Streaming events (deltas, tool progress, etc.)
        this.handleStreamEvent(ws, messageId, rawEvent);
      } else if (eventType === "result") {
        // Result events contain tool usage info
        this.handleResultEvent(ws, rawEvent);
      }
      // Ignore other event types (system, user, auth_status, etc.)
    }
  }

  /**
   * Handles assistant events containing message content.
   */
  private handleAssistantEvent(
    ws: WebSocketLike,
    messageId: string,
    event: Record<string, unknown>
  ): void {
    const message = event.message as
      | { content?: Array<{ type: string; text?: string }> }
      | undefined;

    if (message?.content) {
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          this.send(ws, {
            type: "response_chunk",
            messageId,
            content: block.text,
          });
        }
      }
    }
  }

  /**
   * Handles streaming events containing deltas.
   */
  private handleStreamEvent(
    ws: WebSocketLike,
    messageId: string,
    event: Record<string, unknown>
  ): void {
    const streamEvent = event.event as Record<string, unknown> | undefined;
    if (!streamEvent) return;

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
      }
    }
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
   * Loads an existing session for the current vault.
   */
  private handleResumeSession(
    ws: WebSocketLike,
    sessionId: string
  ): void {
    if (!this.state.currentVault) {
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    // Store the session ID - actual SDK resume happens on next discussion_message
    this.state.currentSessionId = sessionId;

    this.send(ws, {
      type: "session_ready",
      sessionId,
      vaultId: this.state.currentVault.id,
    });
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
}

/**
 * Creates a new WebSocketHandler instance.
 * Factory function for creating handlers per connection.
 */
export function createWebSocketHandler(): WebSocketHandler {
  return new WebSocketHandler();
}

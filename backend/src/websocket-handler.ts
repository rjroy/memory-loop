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
  StoredToolInvocation,
} from "@memory-loop/shared";
import { safeParseClientMessage } from "@memory-loop/shared";
import { discoverVaults, getVaultById, getVaultGoals } from "./vault-manager";
import {
  createSession,
  resumeSession,
  loadSession,
  appendMessage,
  getRecentSessions,
  SessionError,
  type SessionQueryResult,
} from "./session-manager";
import { captureToDaily, getRecentNotes } from "./note-capture";
import {
  listDirectory,
  readMarkdownFile,
  writeMarkdownFile,
  FileBrowserError,
} from "./file-browser";
import { isMockMode, generateMockResponse, createMockSession } from "./mock-sdk";
import { getInspiration } from "./inspiration-manager";
import { wsLog as log } from "./logger";
import { getAllTasks, toggleTask } from "./task-manager";
import { loadVaultConfig } from "./vault-config";

/**
 * WebSocket interface for sending messages.
 * Abstracts over different WebSocket implementations.
 */
export interface WebSocketLike {
  send(data: string): void;
  readyState: number;
}

/**
 * Result from streaming SDK events.
 * Contains accumulated response text and tool invocations for persistence.
 */
interface StreamingResult {
  content: string;
  toolInvocations: StoredToolInvocation[];
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
      case "write_file":
        await this.handleWriteFile(ws, message.path, message.content);
        break;
      case "get_recent_notes":
        await this.handleGetRecentNotes(ws);
        break;
      case "get_recent_activity":
        await this.handleGetRecentActivity(ws);
        break;
      case "get_goals":
        await this.handleGetGoals(ws);
        break;
      case "get_inspiration":
        await this.handleGetInspiration(ws);
        break;
      case "get_tasks":
        await this.handleGetTasks(ws);
        break;
      case "toggle_task":
        await this.handleToggleTask(ws, message.filePath, message.lineNumber);
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
          createdAt: new Date().toISOString(), // Session was just created
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

      // Stream events from SDK and accumulate response + tools
      log.info("Streaming SDK events...");
      const streamResult = await this.streamEvents(ws, messageId, queryResult);

      // Send response_end
      this.send(ws, { type: "response_end", messageId });

      // Save assistant message to session after streaming completes
      if (streamResult.content.length > 0 || streamResult.toolInvocations.length > 0) {
        await appendMessage(queryResult.sessionId, {
          id: messageId,
          role: "assistant",
          content: streamResult.content,
          timestamp: new Date().toISOString(),
          toolInvocations: streamResult.toolInvocations.length > 0 ? streamResult.toolInvocations : undefined,
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
   * Returns the accumulated response text and tool invocations for persistence.
   *
   * The SDK emits various event types when includePartialMessages is true:
   * - stream_event: Contains RawMessageStreamEvent with:
   *   - content_block_start: New content block (text or tool_use)
   *   - content_block_delta: Incremental content (text_delta or input_json_delta)
   *   - content_block_stop: Content block complete
   * - result: Final result with complete tool_use and tool_result blocks
   * - assistant: Complete message (we skip to avoid duplicating streamed content)
   */
  private async streamEvents(
    ws: WebSocketLike,
    messageId: string,
    queryResult: SessionQueryResult
  ): Promise<StreamingResult> {
    const responseChunks: string[] = [];
    // Track tools by ID for efficient lookup during streaming
    const toolsMap = new Map<string, StoredToolInvocation>();
    // Track content blocks by index for accumulating tool input JSON
    const contentBlocks = new Map<number, ContentBlockState>();

    for await (const event of queryResult.events) {
      // Check if connection is still open (readyState === 1)
      if (ws.readyState !== 1) {
        log.debug("Connection closed during streaming, stopping");
        // Mark all running tools as complete to prevent spinner on resume.
        // Without this, tools saved with status "running" would show spinners
        // forever when the session is resumed.
        for (const tool of toolsMap.values()) {
          if (tool.status === "running") {
            tool.status = "complete";
            tool.output = "[Connection closed before tool completed]";
          }
        }
        break;
      }

      // Cast to unknown for flexible property checking
      // The SDK types are more constrained than runtime events
      const rawEvent = event as unknown as Record<string, unknown>;
      const eventType = rawEvent.type as string;

      // Log all SDK events for diagnostics (debug level)
      log.debug(`SDK event: ${eventType}`, this.summarizeEvent(rawEvent));

      // Handle different event types
      // NOTE: We skip "assistant" events for text accumulation. The SDK emits
      // stream_event deltas for incremental text, then an assistant event with
      // the full content. Processing both would cause duplicate text.
      if (eventType === "stream_event") {
        // Streaming events (deltas, tool progress, etc.)
        const text = this.handleStreamEvent(ws, messageId, rawEvent, toolsMap, contentBlocks);
        if (text) {
          responseChunks.push(text);
        }
      } else if (eventType === "result") {
        // Result events contain tool usage info - track for persistence
        // These come at the end of a turn with complete tool info
        this.handleResultEvent(ws, rawEvent, toolsMap);
      } else if (eventType === "user") {
        // User events contain tool results (SDK creates these after tool execution)
        this.handleUserEvent(ws, rawEvent, toolsMap);
      }
      // Ignore other event types (system, auth_status, etc.)
    }

    return {
      content: responseChunks.join(""),
      toolInvocations: Array.from(toolsMap.values()),
    };
  }

  /**
   * Creates a summary of an SDK event for logging.
   * Truncates large payloads to avoid log bloat.
   */
  private summarizeEvent(event: Record<string, unknown>): Record<string, unknown> {
    const summary: Record<string, unknown> = { type: event.type };

    if (event.type === "stream_event" && event.event) {
      const streamEvent = event.event as Record<string, unknown>;
      summary.streamType = streamEvent.type;
      if (streamEvent.index !== undefined) {
        summary.index = streamEvent.index;
      }
      // Include content_block info for starts
      if (streamEvent.content_block) {
        const cb = streamEvent.content_block as Record<string, unknown>;
        summary.contentBlock = { type: cb.type, id: cb.id, name: cb.name };
      }
      // Include delta type for deltas
      if (streamEvent.delta) {
        const delta = streamEvent.delta as Record<string, unknown>;
        summary.deltaType = delta.type;
      }
    }

    return summary;
  }

  /**
   * Handles streaming events containing deltas and content block lifecycle.
   * Returns extracted text content for accumulation.
   *
   * Handles three types of stream events:
   * - content_block_start: Signals a new content block (text or tool_use)
   * - content_block_delta: Contains incremental content (text_delta or input_json_delta)
   * - content_block_stop: Signals content block is complete
   */
  private handleStreamEvent(
    ws: WebSocketLike,
    messageId: string,
    event: Record<string, unknown>,
    toolsMap: Map<string, StoredToolInvocation>,
    contentBlocks: Map<number, ContentBlockState>
  ): string {
    const streamEvent = event.event as Record<string, unknown> | undefined;
    if (!streamEvent) return "";

    const streamType = streamEvent.type as string | undefined;
    const blockIndex = streamEvent.index as number | undefined;

    // Handle content_block_start - new content block beginning
    if (streamType === "content_block_start" && blockIndex !== undefined) {
      const contentBlock = streamEvent.content_block as Record<string, unknown> | undefined;
      if (!contentBlock) return "";

      const blockType = contentBlock.type as string;

      if (blockType === "tool_use") {
        const toolUseId = contentBlock.id as string;
        const toolName = contentBlock.name as string;

        log.info(`Tool started: ${toolName} (${toolUseId})`);

        // Track this content block for accumulating input JSON
        contentBlocks.set(blockIndex, {
          type: "tool_use",
          toolUseId,
          toolName,
          inputJsonChunks: [],
        });

        // Send tool_start to client
        this.send(ws, {
          type: "tool_start",
          toolName,
          toolUseId,
        });

        // Track tool for persistence
        toolsMap.set(toolUseId, {
          toolUseId,
          toolName,
          status: "running",
        });
      } else if (blockType === "text") {
        contentBlocks.set(blockIndex, { type: "text" });
      }

      return "";
    }

    // Handle content_block_delta - incremental content
    if (streamType === "content_block_delta") {
      const delta = streamEvent.delta as Record<string, unknown> | undefined;
      if (!delta) return "";

      const deltaType = delta.type as string;

      // Text delta - stream to client (doesn't require index tracking)
      if (deltaType === "text_delta") {
        const text = delta.text as string | undefined;
        if (text) {
          this.send(ws, {
            type: "response_chunk",
            messageId,
            content: text,
          });
          return text;
        }
      }

      // Input JSON delta - accumulate for tool input (requires index to track which tool)
      if (deltaType === "input_json_delta" && blockIndex !== undefined) {
        const partialJson = delta.partial_json as string | undefined;
        const block = contentBlocks.get(blockIndex);
        if (partialJson && block?.type === "tool_use" && block.inputJsonChunks) {
          block.inputJsonChunks.push(partialJson);
        }
      }

      return "";
    }

    // Handle content_block_stop - content block complete
    if (streamType === "content_block_stop" && blockIndex !== undefined) {
      const block = contentBlocks.get(blockIndex);

      if (block?.type === "tool_use" && block.toolUseId && block.inputJsonChunks) {
        // Parse accumulated JSON and send tool_input
        const jsonStr = block.inputJsonChunks.join("");
        try {
          const input: unknown = jsonStr ? JSON.parse(jsonStr) : {};

          log.debug(`Tool input complete for ${block.toolName}`, { inputLength: jsonStr.length });

          this.send(ws, {
            type: "tool_input",
            toolUseId: block.toolUseId,
            input,
          });

          // Update tracked tool with input
          const tracked = toolsMap.get(block.toolUseId);
          if (tracked) {
            tracked.input = input;
          }
        } catch (err) {
          log.warn(`Failed to parse tool input JSON for ${block.toolUseId}`, { jsonStr, err });
        }
      }

      // Clean up block state
      contentBlocks.delete(blockIndex);
      return "";
    }

    return "";
  }

  /**
   * Handles result events containing tool usage.
   * Sends tool_end events and ensures tools are tracked for persistence.
   *
   * Note: tool_start and tool_input are now sent during streaming via
   * handleStreamEvent. This method handles:
   * - tool_use blocks: Only tracks for persistence if not already tracked
   * - tool_result blocks: Sends tool_end and updates status
   */
  private handleResultEvent(
    ws: WebSocketLike,
    event: Record<string, unknown>,
    toolsMap: Map<string, StoredToolInvocation>
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
          // Check if we already tracked this tool from streaming events
          const existing = toolsMap.get(block.id);
          if (!existing) {
            // Fallback: tool wasn't seen during streaming, track it now
            log.debug(`Tool ${block.name} (${block.id}) tracked from result event (fallback)`);
            toolsMap.set(block.id, {
              toolUseId: block.id,
              toolName: block.name,
              status: "running",
              input: block.input,
            });
            // Send tool_start and tool_input as fallback
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
          } else if (!existing.input && block.input !== undefined) {
            // Update input if we didn't get it from streaming
            existing.input = block.input;
          }
        } else if (block.type === "tool_result" && block.tool_use_id) {
          log.info(`Tool completed: ${block.tool_use_id}`);
          this.send(ws, {
            type: "tool_end",
            toolUseId: block.tool_use_id,
            output: block.content ?? null,
          });
          // Update tracked tool with output and mark complete
          const tracked = toolsMap.get(block.tool_use_id);
          if (tracked) {
            tracked.output = block.content ?? null;
            tracked.status = "complete";
          }
        }
      }
    }
  }

  /**
   * Handles user events containing tool results.
   * The SDK creates user messages after tool execution with the tool output.
   *
   * User event structure (from SDKUserMessage):
   * - type: 'user'
   * - message: APIUserMessage (with content array containing tool_result blocks)
   * - tool_use_result?: unknown (convenience field with result data)
   */
  private handleUserEvent(
    ws: WebSocketLike,
    event: Record<string, unknown>,
    toolsMap: Map<string, StoredToolInvocation>
  ): void {
    // The message field contains the APIUserMessage
    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return;

    // Check for tool_result blocks in message content
    const content = message.content as
      | Array<{
          type: string;
          tool_use_id?: string;
          content?: unknown;
        }>
      | undefined;

    if (!content || !Array.isArray(content)) return;

    for (const block of content) {
      if (block.type === "tool_result" && block.tool_use_id) {
        log.info(`Tool completed (from user event): ${block.tool_use_id}`);
        this.send(ws, {
          type: "tool_end",
          toolUseId: block.tool_use_id,
          output: block.content ?? null,
        });
        // Update tracked tool with output and mark complete
        const tracked = toolsMap.get(block.tool_use_id);
        if (tracked) {
          tracked.output = block.content ?? null;
          tracked.status = "complete";
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
        createdAt: metadata.createdAt,
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
      const entries = await listDirectory(this.state.currentVault.contentRoot, path);
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
      const result = await readMarkdownFile(this.state.currentVault.contentRoot, path);
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
   * Handles write_file message.
   * Writes content to a markdown file in the selected vault.
   */
  private async handleWriteFile(
    ws: WebSocketLike,
    path: string,
    content: string
  ): Promise<void> {
    log.info(`Writing file: ${path}`);
    if (!this.state.currentVault) {
      log.warn("No vault selected for file writing");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    try {
      await writeMarkdownFile(this.state.currentVault.contentRoot, path, content);
      log.info(`File written: ${path} (${content.length} bytes)`);
      this.send(ws, {
        type: "file_written",
        path,
        success: true,
      });
    } catch (error) {
      log.error("File writing failed", error);
      if (error instanceof FileBrowserError) {
        this.sendError(ws, error.code, error.message);
      } else {
        const message =
          error instanceof Error ? error.message : "Failed to write file";
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

  /**
   * Handles get_recent_activity message.
   * Returns both recent captured notes and recent discussions.
   */
  private async handleGetRecentActivity(ws: WebSocketLike): Promise<void> {
    log.info("Getting recent activity");
    if (!this.state.currentVault) {
      log.warn("No vault selected for recent activity");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    try {
      const [captures, discussions] = await Promise.all([
        getRecentNotes(this.state.currentVault, 5),
        getRecentSessions(this.state.currentVault.id, 5),
      ]);
      log.info(`Found ${captures.length} captures and ${discussions.length} discussions`);
      this.send(ws, {
        type: "recent_activity",
        captures,
        discussions,
      });
    } catch (error) {
      log.error("Failed to get recent activity", error);
      const message =
        error instanceof Error ? error.message : "Failed to get recent activity";
      this.sendError(ws, "INTERNAL_ERROR", message);
    }
  }

  /**
   * Handles get_goals message.
   * Returns goals from the vault's goals.md file.
   */
  private async handleGetGoals(ws: WebSocketLike): Promise<void> {
    log.info("Getting goals");
    if (!this.state.currentVault) {
      log.warn("No vault selected for goals");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    try {
      const sections = await getVaultGoals(this.state.currentVault);
      log.info(`Found ${sections?.length ?? 0} goal sections`);
      this.send(ws, {
        type: "goals",
        sections,
      });
    } catch (error) {
      log.error("Failed to get goals", error);
      const message =
        error instanceof Error ? error.message : "Failed to get goals";
      this.sendError(ws, "INTERNAL_ERROR", message);
    }
  }

  /**
   * Handles get_inspiration message.
   * Returns contextual prompt and inspirational quote.
   * Errors are logged but not sent to client (inspiration is optional).
   */
  private async handleGetInspiration(ws: WebSocketLike): Promise<void> {
    log.info("Getting inspiration");
    if (!this.state.currentVault) {
      log.warn("No vault selected for inspiration");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    try {
      const result = await getInspiration(this.state.currentVault);
      log.info(
        `Inspiration fetched: contextual=${result.contextual !== null}, quote="${result.quote.text.slice(0, 30)}..."`
      );
      this.send(ws, {
        type: "inspiration",
        contextual: result.contextual,
        quote: result.quote,
      });
    } catch (error) {
      // Log errors but don't send error response - inspiration is optional
      log.error("Failed to get inspiration (continuing silently)", error);
      // Don't send error to client per REQ-NF-3 (graceful degradation)
    }
  }

  /**
   * Handles get_tasks message.
   * Returns all tasks from configured directories (inbox, projects, areas).
   */
  private async handleGetTasks(ws: WebSocketLike): Promise<void> {
    log.info("Getting tasks");
    if (!this.state.currentVault) {
      log.warn("No vault selected for tasks");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    try {
      // Load vault config to get directory paths
      const config = await loadVaultConfig(this.state.currentVault.path);
      const result = await getAllTasks(this.state.currentVault.contentRoot, config);
      log.info(`Found ${result.total} tasks (${result.incomplete} incomplete)`);
      this.send(ws, {
        type: "tasks",
        tasks: result.tasks,
        incomplete: result.incomplete,
        total: result.total,
      });
    } catch (error) {
      log.error("Failed to get tasks", error);
      const message =
        error instanceof Error ? error.message : "Failed to get tasks";
      this.sendError(ws, "INTERNAL_ERROR", message);
    }
  }

  /**
   * Handles toggle_task message.
   * Toggles the checkbox state of a task in a file.
   * State cycle: ' ' -> 'x' -> '/' -> '?' -> 'b' -> 'f' -> ' '
   */
  private async handleToggleTask(
    ws: WebSocketLike,
    filePath: string,
    lineNumber: number
  ): Promise<void> {
    log.info(`Toggling task: ${filePath}:${lineNumber}`);
    if (!this.state.currentVault) {
      log.warn("No vault selected for task toggle");
      this.sendError(
        ws,
        "VAULT_NOT_FOUND",
        "No vault selected. Send select_vault first."
      );
      return;
    }

    try {
      const result = await toggleTask(
        this.state.currentVault.contentRoot,
        filePath,
        lineNumber
      );

      if (!result.success) {
        log.warn(`Task toggle failed: ${result.error}`);
        // Determine appropriate error code based on error message
        let errorCode: "PATH_TRAVERSAL" | "FILE_NOT_FOUND" | "INTERNAL_ERROR" = "INTERNAL_ERROR";
        if (result.error?.includes("Path outside") || result.error?.includes("path traversal")) {
          errorCode = "PATH_TRAVERSAL";
        } else if (result.error?.includes("not found") || result.error?.includes("File not found")) {
          errorCode = "FILE_NOT_FOUND";
        }
        this.sendError(ws, errorCode, result.error ?? "Failed to toggle task");
        return;
      }

      log.info(`Task toggled: ${filePath}:${lineNumber} -> '${result.newState}'`);
      this.send(ws, {
        type: "task_toggled",
        filePath,
        lineNumber,
        newState: result.newState!,
      });
    } catch (error) {
      log.error("Failed to toggle task", error);
      // Check for FileBrowserError (path traversal, etc.)
      if (error instanceof FileBrowserError) {
        this.sendError(ws, error.code, error.message);
      } else {
        const message =
          error instanceof Error ? error.message : "Failed to toggle task";
        this.sendError(ws, "INTERNAL_ERROR", message);
      }
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

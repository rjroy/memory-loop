/**
 * Discussion Component
 *
 * Chat interface for conversation with Claude via the Obsidian vault context.
 * Features message history, streaming responses, and slash command detection.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { ServerMessage, SlashCommand, ClientMessage } from "@memory-loop/shared";
import { useWebSocket, type ConnectionStatus } from "../../hooks/useWebSocket";
import { useChat } from "../../hooks/useChat";
import { useSession, useServerMessageHandler } from "../../contexts/SessionContext";
import { ConversationPane, DiscussionEmptyState } from "../shared/ConversationPane";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { ToolPermissionDialog, type ToolPermissionRequest } from "./ToolPermissionDialog";
import { AskUserQuestionDialog, type AskUserQuestionRequest } from "./AskUserQuestionDialog";
import { SlashCommandAutocomplete, useSlashCommandNavigation } from "./SlashCommandAutocomplete";
import { FileAttachButton } from "./FileAttachButton";
import "./Discussion.css";

const STORAGE_KEY = "memory-loop-discussion-draft";

/**
 * Transport method for Discussion communication.
 * - "websocket": Use WebSocket connection (default, legacy)
 * - "sse": Use SSE via useChat hook (new, for Next.js migration)
 */
export type DiscussionTransport = "websocket" | "sse";

/**
 * Props for the Discussion component.
 * All props are optional to maintain backward compatibility.
 * When provided, Discussion uses the shared WebSocket connection instead of creating its own.
 */
export interface DiscussionProps {
  /** Transport method: "websocket" (default) or "sse" */
  transport?: DiscussionTransport;
  /** Function to send WebSocket messages (shared connection) */
  sendMessage?: (message: ClientMessage) => void;
  /** Current connection status (shared connection) */
  connectionStatus?: ConnectionStatus;
  /** Last received server message (shared connection) */
  lastMessage?: ServerMessage | null;
  /** Callback fired when reconnecting (shared connection) */
  onReconnect?: () => void;
}

/**
 * Chat interface for vault-contextualized AI discussions.
 *
 * - Scrollable message history with user/assistant messages
 * - Streaming response display with inline tool display
 * - Input field with send button
 * - Slash command autocomplete with keyboard navigation
 * - Auto-scroll to bottom on new messages
 * - Draft preservation in localStorage
 *
 * When props are provided, Discussion uses a shared WebSocket connection.
 * This enables embedding Discussion in Pair Writing Mode with a shared session.
 */
export function Discussion(props: DiscussionProps = {}): React.ReactNode {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<ToolPermissionRequest | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<AskUserQuestionRequest | null>(null);
  const [autocompleteSelectedIndex, setAutocompleteSelectedIndex] = useState(0);
  const [argumentHintPlaceholder, setArgumentHintPlaceholder] = useState<string | null>(null);

  // messagesEndRef removed - auto-scroll now handled by ConversationPane
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasSentVaultSelectionRef = useRef(false);
  const prevSessionIdRef = useRef<string | null>(null);
  // Track session ID to resume after vault selection (for per-vault session storage)
  const pendingResumeRef = useRef<string | null>(null);

  const {
    vault,
    messages,
    sessionId,
    addMessage,
    startNewSession,
    discussionPrefill,
    setDiscussionPrefill,
    pendingSessionId,
    setPendingSessionId,
    showNewSessionDialog,
    setShowNewSessionDialog,
    wantsNewSession,
    addToolToLastMessage,
    updateToolInput,
    completeToolInvocation,
    slashCommands,
  } = useSession();

  // Detect touch-only devices (no hover capability)
  // On touch devices, Enter adds newlines; send button is the only way to submit
  useEffect(() => {
    const query = window.matchMedia("(hover: none)");
    setIsTouchDevice(query.matches);

    const handler = (e: MediaQueryListEvent) => setIsTouchDevice(e.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  // Determine transport method
  const transport = props.transport ?? "websocket";
  const isSSE = transport === "sse";

  // Check if we're using a shared WebSocket connection (all three props provided)
  const isSharedConnection = !isSSE &&
    props.sendMessage !== undefined &&
    props.connectionStatus !== undefined &&
    props.lastMessage !== undefined;

  // Callback to re-send vault selection on WebSocket reconnect
  const handleReconnect = useCallback(() => {
    if (isSSE) return; // SSE doesn't need reconnect handling
    hasSentVaultSelectionRef.current = false;
    // Reset submitting state - any in-flight request was interrupted
    setIsSubmitting(false);
    // Clear any pending permission dialog - backend lost the request on disconnect
    setPendingPermission(null);
    // Call external onReconnect if provided
    props.onReconnect?.();
  }, [isSSE, props.onReconnect]);

  const handleServerMessage = useServerMessageHandler();

  // Process incoming server messages via callback to ensure every message is handled
  // This prevents race conditions where React batches state updates and drops chunks
  const handleMessage = useCallback(
    (message: ServerMessage) => {
      // Process streaming messages (response_start, response_chunk, response_end)
      handleServerMessage(message);

      // Handle response start - ensure stop button is visible when streaming begins
      // This handles the race condition where user clicks stop before streaming starts:
      // the abort may not take effect, and we need the stop button to reappear
      if (message.type === "response_start") {
        setIsSubmitting(true);
      }

      // Handle response end - clear submitting state
      if (message.type === "response_end") {
        setIsSubmitting(false);
      }

      // Handle tool events - add/update tool invocations on last assistant message
      if (message.type === "tool_start") {
        addToolToLastMessage(message.toolUseId, message.toolName);
      }

      if (message.type === "tool_input") {
        updateToolInput(message.toolUseId, message.input);
      }

      if (message.type === "tool_end") {
        completeToolInvocation(message.toolUseId, message.output);
      }

      // Handle tool permission requests
      if (message.type === "tool_permission_request") {
        setPendingPermission({
          toolUseId: message.toolUseId,
          toolName: message.toolName,
          input: message.input,
        });
      }

      // Handle AskUserQuestion requests
      if (message.type === "ask_user_question_request") {
        setPendingQuestion({
          toolUseId: message.toolUseId,
          questions: message.questions,
        });
      }

      // Handle errors
      if (message.type === "error") {
        setIsSubmitting(false);
      }
    },
    [handleServerMessage, addToolToLastMessage, updateToolInput, completeToolInvocation]
  );

  // SSE transport via useChat hook
  const chat = useChat(
    isSSE ? vault : null, // Only activate when using SSE transport
    {
      onEvent: handleMessage,
      onStreamStart: () => setIsSubmitting(true),
      onStreamEnd: () => setIsSubmitting(false),
      onError: () => setIsSubmitting(false),
    }
  );

  // WebSocket transport - use internal WebSocket only when not using shared connection
  const internalWs = useWebSocket(
    isSSE || isSharedConnection
      ? {} // Minimal config when not using (connection still created but not used)
      : {
          onReconnect: handleReconnect,
          onMessage: handleMessage,
        }
  );

  // Unified interface that works for both transports
  // For SSE: wrap sendMessage to add user message and call chat.sendMessage
  // For WebSocket: use existing sendMessage function
  const sendChatMessage = useCallback(
    async (text: string) => {
      if (isSSE) {
        addMessage({ role: "user", content: text });
        await chat.sendMessage(text);
      } else {
        const wsMessage = isSharedConnection ? props.sendMessage! : internalWs.sendMessage;
        addMessage({ role: "user", content: text });
        wsMessage({ type: "discussion_message", text });
      }
    },
    [isSSE, chat, isSharedConnection, props.sendMessage, internalWs.sendMessage, addMessage]
  );

  // Unified abort function
  const abortChat = useCallback(async () => {
    if (isSSE) {
      await chat.abort();
    } else {
      const wsMessage = isSharedConnection ? props.sendMessage! : internalWs.sendMessage;
      wsMessage({ type: "abort" });
    }
    setIsSubmitting(false);
  }, [isSSE, chat, isSharedConnection, props.sendMessage, internalWs.sendMessage]);

  // Unified permission resolution
  const resolvePermission = useCallback(
    async (toolUseId: string, allowed: boolean) => {
      if (isSSE) {
        await chat.resolvePermission(toolUseId, allowed);
      } else {
        const wsMessage = isSharedConnection ? props.sendMessage! : internalWs.sendMessage;
        wsMessage({ type: "tool_permission_response", toolUseId, allowed });
      }
    },
    [isSSE, chat, isSharedConnection, props.sendMessage, internalWs.sendMessage]
  );

  // Unified question resolution
  const resolveQuestion = useCallback(
    async (toolUseId: string, answers: Record<string, string>) => {
      if (isSSE) {
        await chat.resolveQuestion(toolUseId, answers);
      } else {
        const wsMessage = isSharedConnection ? props.sendMessage! : internalWs.sendMessage;
        wsMessage({ type: "ask_user_question_response", toolUseId, answers });
      }
    },
    [isSSE, chat, isSharedConnection, props.sendMessage, internalWs.sendMessage]
  );

  // Select between shared and internal WebSocket connection (only for WebSocket transport)
  const sendMessage = isSharedConnection ? props.sendMessage! : internalWs.sendMessage;
  const connectionStatus = isSSE
    ? (chat.isStreaming ? "connected" : "connected") // SSE is always "connected" when idle or streaming
    : (isSharedConnection ? props.connectionStatus! : internalWs.connectionStatus);
  const lastMessage = isSharedConnection ? props.lastMessage! : internalWs.lastMessage;

  // Process messages from shared WebSocket connection via useEffect on lastMessage
  // (internal connection uses onMessage callback instead, SSE uses onEvent callback)
  const lastProcessedMessageRef = useRef<ServerMessage | null>(null);
  useEffect(() => {
    if (!isSSE && isSharedConnection && lastMessage && lastMessage !== lastProcessedMessageRef.current) {
      lastProcessedMessageRef.current = lastMessage;
      handleMessage(lastMessage);
    }
  }, [isSSE, isSharedConnection, lastMessage, handleMessage]);

  // Send vault selection when WebSocket connects (initial or reconnect)
  // Sessions are stored per-vault, so we must select vault before resuming any session.
  // Note: SSE transport handles vault selection via request body, so this effect is skipped.
  useEffect(() => {
    // Skip for SSE transport - useChat includes vaultId in POST request
    if (isSSE) return;

    if (
      connectionStatus === "connected" &&
      vault &&
      !hasSentVaultSelectionRef.current
    ) {
      hasSentVaultSelectionRef.current = true;

      // Priority 0: If user wants a new session, skip auto-resume entirely
      if (wantsNewSession) {
        console.log("[Discussion] wantsNewSession=true, starting fresh session");
        pendingResumeRef.current = null;
        sendMessage({ type: "select_vault", vaultId: vault.id });
        return;
      }

      // Priority 1: If RecentActivity set a pendingSessionId, queue it for resume after vault selection
      if (pendingSessionId) {
        console.log(`[Discussion] Will resume pending session after vault selection: ${pendingSessionId.slice(0, 8)}...`);
        pendingResumeRef.current = pendingSessionId;
        sendMessage({ type: "select_vault", vaultId: vault.id });
        return;
      }

      // Priority 2: If we have a current sessionId, queue it for resume (e.g., on reconnect)
      if (sessionId) {
        console.log(`[Discussion] Will resume session on reconnect after vault selection: ${sessionId.slice(0, 8)}...`);
        pendingResumeRef.current = sessionId;
        sendMessage({ type: "select_vault", vaultId: vault.id });
        return;
      }

      // Priority 3: Check API for existing session to auto-resume, or start fresh
      pendingResumeRef.current = null;
      void (async () => {
        try {
          const response = await fetch(`/api/sessions/${vault.id}`);
          if (!response.ok) {
            console.warn(`[Discussion] Session check failed with status ${response.status}, selecting vault`);
            sendMessage({ type: "select_vault", vaultId: vault.id });
            return;
          }
          const data = (await response.json()) as { sessionId: string | null };

          if (data.sessionId) {
            // Store session to resume after vault selection
            console.log(`[Discussion] Found existing session, will resume after vault selection: ${data.sessionId.slice(0, 8)}...`);
            pendingResumeRef.current = data.sessionId;
          } else {
            console.log(`[Discussion] No existing session, selecting vault: ${vault.id}`);
          }
          sendMessage({ type: "select_vault", vaultId: vault.id });
        } catch (err) {
          console.warn("[Discussion] Failed to check session, selecting vault:", err);
          sendMessage({ type: "select_vault", vaultId: vault.id });
        }
      })();
    }
  }, [isSSE, connectionStatus, vault, sessionId, pendingSessionId, wantsNewSession, sendMessage]);

  // Detect when sessionId is cleared (user clicked "New" button) and notify backend
  // Note: SSE transport handles new sessions via useChat - just send next message without sessionId
  useEffect(() => {
    // Skip for SSE transport - useChat handles session management
    if (isSSE) {
      prevSessionIdRef.current = sessionId;
      return;
    }

    // Only send new_session if we had a session before and now it's null
    if (
      prevSessionIdRef.current !== null &&
      sessionId === null &&
      vault &&
      connectionStatus === "connected"
    ) {
      console.log("[Discussion] Session cleared, sending new_session to backend");
      sendMessage({ type: "new_session" });
      // Don't reset hasSentVaultSelectionRef - the new_session message will trigger
      // a session_ready response from the backend with the new session ID.
      // Resetting the ref here causes a race condition where the vault selection
      // effect re-runs and fetches the old session before new_session is processed.
    }
    // Always update the ref to track current sessionId
    prevSessionIdRef.current = sessionId;
  }, [isSSE, sessionId, vault, connectionStatus, sendMessage]);

  // Handle errors during resume - fall back to select_vault
  // Note: SSE transport handles session errors via useChat's lastError state
  useEffect(() => {
    // Skip for SSE transport
    if (isSSE) return;

    if (lastMessage?.type === "error" && lastMessage.code === "SESSION_NOT_FOUND" && vault) {
      // Session no longer exists on server, clear stale state and start fresh
      console.log("[Discussion] Session not found, starting fresh");
      startNewSession();
      setPendingSessionId(null); // Clear pending to prevent retry on reconnect
      pendingResumeRef.current = null;
      sendMessage({ type: "select_vault", vaultId: vault.id });
    }
  }, [isSSE, lastMessage, vault, sendMessage, startNewSession, setPendingSessionId]);

  // After vault is selected (session_ready with empty sessionId), send resume_session if needed
  // Note: SSE transport doesn't use this flow - sessions are created/resumed per-request
  useEffect(() => {
    // Skip for SSE transport
    if (isSSE) return;

    if (
      lastMessage?.type === "session_ready" &&
      !lastMessage.sessionId && // Empty sessionId means vault selected, no session yet
      pendingResumeRef.current &&
      connectionStatus === "connected"
    ) {
      const resumeId = pendingResumeRef.current;
      pendingResumeRef.current = null;
      console.log(`[Discussion] Vault selected, now resuming session: ${resumeId.slice(0, 8)}...`);
      sendMessage({ type: "resume_session", sessionId: resumeId });
    }
  }, [isSSE, lastMessage, connectionStatus, sendMessage]);

  // Load prefill or draft on mount - prefill takes precedence over localStorage draft
  // Using a ref to capture the initial prefill value avoids needing to suppress exhaustive-deps
  const initialPrefillRef = useRef(discussionPrefill);
  useEffect(() => {
    const initialPrefill = initialPrefillRef.current;
    if (initialPrefill) {
      // Prefill from inspiration card takes precedence
      setInput(initialPrefill);
      setDiscussionPrefill(null);
    } else {
      // Fall back to localStorage draft
      const draft = localStorage.getItem(STORAGE_KEY);
      if (draft) {
        setInput(draft);
      }
    }
  }, [setDiscussionPrefill]);

  // Save draft to localStorage on input change
  useEffect(() => {
    if (input) {
      localStorage.setItem(STORAGE_KEY, input);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [input]);

  // Auto-scroll removed - now handled by ConversationPane

  // Slash command autocomplete logic
  // Check if input starts with "/" and we have commands available
  // Use trimmed for startsWith check but check for space in original input
  // (trailing space indicates user is done with command name and entering arguments)
  const inputStartsWithSlash = input.trim().startsWith("/");
  const hasNoSpaceInInput = !input.includes(" ");
  const isAutocompleteVisible = inputStartsWithSlash && hasNoSpaceInInput && slashCommands.length > 0;

  // Filter commands based on current input prefix (memoized for performance)
  const filteredCommands = useMemo(() => {
    if (!isAutocompleteVisible) return [];

    const prefix = input.trim().slice(1).toLowerCase(); // Remove leading "/"
    return slashCommands
      .filter((cmd) => {
        const cmdName = cmd.name.startsWith("/") ? cmd.name.slice(1) : cmd.name;
        return cmdName.toLowerCase().startsWith(prefix);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [input, slashCommands, isAutocompleteVisible]);

  // Handle autocomplete command selection
  const handleAutocompleteSelect = useCallback((command: SlashCommand) => {
    // Replace input with full command name
    setInput(command.name + " ");
    // Set argumentHint as placeholder if available
    setArgumentHintPlaceholder(command.argumentHint ?? null);
    // Reset autocomplete selection
    setAutocompleteSelectedIndex(0);
    // Focus the input and position cursor at end
    inputRef.current?.focus();
  }, []);

  // Handle selection by index (from keyboard navigation)
  const handleAutocompleteSelectByIndex = useCallback((index: number) => {
    const command = filteredCommands[index];
    if (command) {
      handleAutocompleteSelect(command);
    }
  }, [filteredCommands, handleAutocompleteSelect]);

  // Handle autocomplete close
  const handleAutocompleteClose = useCallback(() => {
    // Simply reset selection; visibility is derived from input state
    setAutocompleteSelectedIndex(0);
  }, []);

  // Keyboard navigation for autocomplete
  const { handleKeyDown: handleAutocompleteKeyDown } = useSlashCommandNavigation(
    filteredCommands.length,
    autocompleteSelectedIndex,
    setAutocompleteSelectedIndex,
    handleAutocompleteSelectByIndex,
    handleAutocompleteClose,
    isAutocompleteVisible && filteredCommands.length > 0
  );

  // Clear argumentHint placeholder when input changes from the command pattern
  useEffect(() => {
    if (argumentHintPlaceholder && !inputStartsWithSlash) {
      setArgumentHintPlaceholder(null);
    }
  }, [inputStartsWithSlash, argumentHintPlaceholder]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    if (connectionStatus !== "connected") return;
    if (!vault) return;

    // Clear input and localStorage first to prevent double-submit
    setInput("");
    localStorage.removeItem(STORAGE_KEY);
    setIsSubmitting(true);

    // Send message via unified interface (adds user message and sends to server)
    void sendChatMessage(trimmedInput);

    // Blur input to collapse it back to single row
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // First, let autocomplete handle keyboard events when visible
    // handleAutocompleteKeyDown returns true if it handled the event
    if (handleAutocompleteKeyDown(e)) {
      return;
    }

    // On touch devices, Enter always adds a newline (no keyboard shortcut to submit)
    // On desktop, Enter submits and Shift+Enter adds a newline
    // When submitting (draft mode), Enter adds newline to prevent premature submission
    if (e.key === "Enter" && !e.shiftKey && !isTouchDevice && !isSubmitting) {
      // Check for trailing backslash (line continuation, like Claude Code CLI)
      // If input ends with `\` (as last non-whitespace char), remove it and add newline
      const trimmedEnd = input.trimEnd();
      if (trimmedEnd.endsWith("\\")) {
        e.preventDefault();
        setInput(trimmedEnd.slice(0, -1) + "\n");
        return;
      }

      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleAbort() {
    if (!isSubmitting) return;
    void abortChat();
  }

  /**
   * Handle file upload completion - append path to input.
   * Claude can then read the file using its Read tool.
   */
  const handleFileUploaded = useCallback((path: string) => {
    setInput((prev) => {
      const trimmed = prev.trim();
      if (trimmed) {
        return `${trimmed}\n${path}`;
      }
      return path;
    });
    // Focus the input so user can add a message
    inputRef.current?.focus();
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
  }

  const isDisconnected = connectionStatus !== "connected" || !vault;

  function handleNewSessionClick() {
    setShowNewSessionDialog(true);
  }

  function handleConfirmNewSession() {
    setShowNewSessionDialog(false);
    startNewSession();
  }

  function handleCancelNewSession() {
    setShowNewSessionDialog(false);
  }

  function handleAllowTool() {
    if (pendingPermission) {
      void resolvePermission(pendingPermission.toolUseId, true);
      setPendingPermission(null);
    }
  }

  function handleDenyTool() {
    if (pendingPermission) {
      void resolvePermission(pendingPermission.toolUseId, false);
      setPendingPermission(null);
    }
  }

  function handleQuestionSubmit(answers: Record<string, string>) {
    if (pendingQuestion) {
      void resolveQuestion(pendingQuestion.toolUseId, answers);
      setPendingQuestion(null);
    }
  }

  function handleQuestionCancel() {
    // Canceling sends an empty answers object, which the backend will reject
    if (pendingQuestion) {
      void resolveQuestion(pendingQuestion.toolUseId, {});
      setPendingQuestion(null);
    }
  }

  return (
    <div className="discussion">
      <button
        type="button"
        className="discussion__new-btn"
        onClick={handleNewSessionClick}
        aria-label="Start new session"
        title="New session"
      >
        +
      </button>

      <ConversationPane
        messages={messages}
        vaultId={vault?.id}
        emptyState={<DiscussionEmptyState />}
        className="discussion__messages"
        ariaLabel="Conversation"
      />

      <form className="discussion__input-area" onSubmit={handleSubmit}>
        <SlashCommandAutocomplete
          commands={slashCommands}
          inputValue={input}
          isVisible={isAutocompleteVisible}
          onSelect={handleAutocompleteSelect}
          onClose={handleAutocompleteClose}
          selectedIndex={autocompleteSelectedIndex}
          onSelectedIndexChange={setAutocompleteSelectedIndex}
        />
        <div className="discussion__input-row">
          <FileAttachButton
            onFileUploaded={handleFileUploaded}
            disabled={isSubmitting}
          />
          <textarea
            ref={inputRef}
            className={`discussion__input${isFocused ? " discussion__input--expanded" : ""}${isSubmitting ? " discussion__input--draft" : ""}`}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={argumentHintPlaceholder ?? (isSubmitting ? "Your thoughts take shape while the vault responds..." : "Explore. Challenge. Refine. Your vault awaits...")}
            rows={1}
            aria-label="Message input"
          />
          <button
            type={isSubmitting ? "button" : "submit"}
            className={`discussion__send${isSubmitting ? " discussion__send--stop" : ""}`}
            disabled={!isSubmitting && (isDisconnected || !input.trim())}
            onClick={isSubmitting ? handleAbort : undefined}
            aria-label={isSubmitting ? "Stop response" : "Send message"}
          >
            {isSubmitting ? (
              <svg
                className="discussion__stop-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            ) : (
              <svg
                className="discussion__send-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </button>
        </div>
      </form>

      <ConfirmDialog
        isOpen={showNewSessionDialog}
        title="Start New Session?"
        message="This will clear the current conversation. Your notes are already saved to the vault."
        confirmLabel="New"
        onConfirm={handleConfirmNewSession}
        onCancel={handleCancelNewSession}
      />

      <ToolPermissionDialog
        request={pendingPermission}
        onAllow={handleAllowTool}
        onDeny={handleDenyTool}
      />

      <AskUserQuestionDialog
        request={pendingQuestion}
        onSubmit={handleQuestionSubmit}
        onCancel={handleQuestionCancel}
      />
    </div>
  );
}

/**
 * Discussion Component
 *
 * Chat interface for conversation with Claude via the Obsidian vault context.
 * Features message history, streaming responses, and slash command detection.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { ServerMessage, SlashCommand } from "@memory-loop/shared";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSession, useServerMessageHandler } from "../contexts/SessionContext";
import { MessageBubble } from "./MessageBubble";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToolPermissionDialog, type ToolPermissionRequest } from "./ToolPermissionDialog";
import { SlashCommandAutocomplete, useSlashCommandNavigation } from "./SlashCommandAutocomplete";
import { ImageAttachButton } from "./ImageAttachButton";
import "./Discussion.css";

const STORAGE_KEY = "memory-loop-discussion-draft";

/**
 * Chat interface for vault-contextualized AI discussions.
 *
 * - Scrollable message history with user/assistant messages
 * - Streaming response display with inline tool display
 * - Input field with send button
 * - Slash command autocomplete with keyboard navigation
 * - Auto-scroll to bottom on new messages
 * - Draft preservation in localStorage
 */
export function Discussion(): React.ReactNode {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<ToolPermissionRequest | null>(null);
  const [autocompleteSelectedIndex, setAutocompleteSelectedIndex] = useState(0);
  const [argumentHintPlaceholder, setArgumentHintPlaceholder] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasSentVaultSelectionRef = useRef(false);
  const prevSessionIdRef = useRef<string | null>(null);

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

  // Callback to re-send vault selection on WebSocket reconnect
  const handleReconnect = useCallback(() => {
    hasSentVaultSelectionRef.current = false;
    // Reset submitting state - any in-flight request was interrupted
    setIsSubmitting(false);
    // Clear any pending permission dialog - backend lost the request on disconnect
    setPendingPermission(null);
  }, []);

  const handleServerMessage = useServerMessageHandler();

  // Process incoming server messages via callback to ensure every message is handled
  // This prevents race conditions where React batches state updates and drops chunks
  const handleMessage = useCallback(
    (message: ServerMessage) => {
      // Process streaming messages (response_start, response_chunk, response_end)
      handleServerMessage(message);

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

      // Handle errors
      if (message.type === "error") {
        setIsSubmitting(false);
      }
    },
    [handleServerMessage, addToolToLastMessage, updateToolInput, completeToolInvocation]
  );

  const { sendMessage, lastMessage, connectionStatus } = useWebSocket({
    onReconnect: handleReconnect,
    onMessage: handleMessage,
  });

  // Send vault selection or resume session when WebSocket connects (initial or reconnect)
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      vault &&
      !hasSentVaultSelectionRef.current
    ) {
      hasSentVaultSelectionRef.current = true;

      // Priority 0: If user wants a new session, skip auto-resume entirely
      if (wantsNewSession) {
        console.log("[Discussion] wantsNewSession=true, starting fresh session");
        sendMessage({ type: "select_vault", vaultId: vault.id });
        return;
      }

      // Priority 1: If RecentActivity set a pendingSessionId, resume that session
      if (pendingSessionId) {
        console.log(`[Discussion] Resuming pending session: ${pendingSessionId.slice(0, 8)}...`);
        sendMessage({ type: "resume_session", sessionId: pendingSessionId });
        return;
      }

      // Priority 2: If we have a current sessionId, resume it (e.g., on reconnect)
      if (sessionId) {
        console.log(`[Discussion] Resuming session on reconnect: ${sessionId.slice(0, 8)}...`);
        sendMessage({ type: "resume_session", sessionId });
        return;
      }

      // Priority 3: Check API for existing session, or start fresh
      void (async () => {
        try {
          const response = await fetch(`/api/sessions/${vault.id}`);
          if (!response.ok) {
            // Non-2xx status - fall back to selecting vault
            console.warn(`[Discussion] Session check failed with status ${response.status}, selecting vault`);
            sendMessage({ type: "select_vault", vaultId: vault.id });
            return;
          }
          const data = (await response.json()) as { sessionId: string | null };

          if (data.sessionId) {
            console.log(`[Discussion] Found existing session: ${data.sessionId.slice(0, 8)}...`);
            sendMessage({ type: "resume_session", sessionId: data.sessionId });
          } else {
            console.log(`[Discussion] No existing session, selecting vault: ${vault.id}`);
            sendMessage({ type: "select_vault", vaultId: vault.id });
          }
        } catch (err) {
          console.warn("[Discussion] Failed to check session, selecting vault:", err);
          sendMessage({ type: "select_vault", vaultId: vault.id });
        }
      })();
    }
  }, [connectionStatus, vault, sessionId, pendingSessionId, wantsNewSession, sendMessage]);

  // Detect when sessionId is cleared (user clicked "New" button) and notify backend
  useEffect(() => {
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
  }, [sessionId, vault, connectionStatus, sendMessage]);

  // Handle errors during resume - fall back to select_vault
  useEffect(() => {
    if (lastMessage?.type === "error" && lastMessage.code === "SESSION_NOT_FOUND" && vault) {
      // Session no longer exists on server, clear stale state and start fresh
      console.log("[Discussion] Session not found, starting fresh");
      startNewSession();
      setPendingSessionId(null); // Clear pending to prevent retry on reconnect
      sendMessage({ type: "select_vault", vaultId: vault.id });
    }
  }, [lastMessage, vault, sendMessage, startNewSession, setPendingSessionId]);

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

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

    // Add user message to history
    addMessage({
      role: "user",
      content: trimmedInput,
    });

    // Send to server
    sendMessage({
      type: "discussion_message",
      text: trimmedInput,
    });

    // Clear input and localStorage
    setInput("");
    localStorage.removeItem(STORAGE_KEY);
    setIsSubmitting(true);

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
    if (e.key === "Enter" && !e.shiftKey && !isTouchDevice) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleAbort() {
    if (!isSubmitting) return;
    sendMessage({ type: "abort" });
    setIsSubmitting(false);
  }

  /**
   * Handle image upload completion - append path to input.
   * Claude can then read the image file using its Read tool.
   */
  const handleImageUploaded = useCallback((path: string) => {
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
      sendMessage({
        type: "tool_permission_response",
        toolUseId: pendingPermission.toolUseId,
        allowed: true,
      });
      setPendingPermission(null);
    }
  }

  function handleDenyTool() {
    if (pendingPermission) {
      sendMessage({
        type: "tool_permission_response",
        toolUseId: pendingPermission.toolUseId,
        allowed: false,
      });
      setPendingPermission(null);
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

      <div className="discussion__messages" role="list" aria-label="Conversation">
        {messages.length === 0 ? (
          <div className="discussion__empty">
            <p>Start a conversation about your vault.</p>
            <p className="discussion__hint">
              Try asking questions about your notes or use slash commands.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} vaultId={vault?.id} />
          ))
        )}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

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
          <ImageAttachButton
            onImageUploaded={handleImageUploaded}
            disabled={isSubmitting}
          />
          <textarea
            ref={inputRef}
            className={`discussion__input${isFocused ? " discussion__input--expanded" : ""}`}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={argumentHintPlaceholder ?? "Explore. Challenge. Refine. Your vault awaits..."}
            disabled={isSubmitting}
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
    </div>
  );
}

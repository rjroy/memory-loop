/**
 * Discussion Component
 *
 * Chat interface for conversation with Claude via the Obsidian vault context.
 * Features message history, streaming responses, and slash command detection.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, type MutableRefObject } from "react";
import type { ServerMessage, SlashCommand } from "@memory-loop/shared";
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

/** Function signature for sending a chat message through Discussion's pipeline. */
export type SendMessageFn = (text: string) => Promise<void>;

/** Props for the Discussion component. */
export interface DiscussionProps {
  /**
   * Optional ref that receives Discussion's sendChatMessage function.
   * Used by PairWritingMode to route Quick/Advisory actions through
   * Discussion's chat pipeline instead of creating a separate useChat instance.
   */
  sendMessageRef?: MutableRefObject<SendMessageFn | null>;
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
 * Communication uses SSE via the useChat hook.
 */
export function Discussion({ sendMessageRef }: DiscussionProps = {}): React.ReactNode {
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

  const {
    vault,
    messages,
    addMessage,
    startNewSession,
    discussionPrefill,
    setDiscussionPrefill,
    pendingSessionId,
    setPendingSessionId,
    showNewSessionDialog,
    setShowNewSessionDialog,
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

  // Capture pendingSessionId on mount and clear it from context.
  // useRef ensures we read it once (the value at mount time) and don't
  // re-initialize useChat's session ID on subsequent renders.
  const initialSessionIdRef = useRef(pendingSessionId);
  useEffect(() => {
    if (initialSessionIdRef.current) {
      setPendingSessionId(null);
    }
  }, [setPendingSessionId]);

  // SSE transport via useChat hook
  const chat = useChat(vault, {
    initialSessionId: initialSessionIdRef.current,
    onEvent: handleMessage,
    onStreamStart: () => setIsSubmitting(true),
    onStreamEnd: () => setIsSubmitting(false),
    onError: () => setIsSubmitting(false),
  });

  const sendChatMessage = useCallback(
    async (text: string) => {
      addMessage({ role: "user", content: text });
      await chat.sendMessage(text);
    },
    [chat, addMessage]
  );

  // Expose sendChatMessage to parent via ref (used by PairWritingMode)
  useEffect(() => {
    if (sendMessageRef) {
      sendMessageRef.current = sendChatMessage;
    }
    return () => {
      if (sendMessageRef) {
        sendMessageRef.current = null;
      }
    };
  }, [sendMessageRef, sendChatMessage]);

  const abortChat = useCallback(async () => {
    await chat.abort();
    setIsSubmitting(false);
  }, [chat]);

  const resolvePermission = useCallback(
    async (toolUseId: string, allowed: boolean) => {
      await chat.resolvePermission(toolUseId, allowed);
    },
    [chat]
  );

  const resolveQuestion = useCallback(
    async (toolUseId: string, answers: Record<string, string>) => {
      await chat.resolveQuestion(toolUseId, answers);
    },
    [chat]
  );

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

  const isDisconnected = !vault;

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

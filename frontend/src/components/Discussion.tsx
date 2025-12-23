/**
 * Discussion Component
 *
 * Chat interface for conversation with Claude via the Obsidian vault context.
 * Features message history, streaming responses, and slash command detection.
 */

import React, { useState, useEffect, useRef } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSession, useServerMessageHandler } from "../contexts/SessionContext";
import { MessageBubble } from "./MessageBubble";
import "./Discussion.css";

const STORAGE_KEY = "memory-loop-discussion-draft";

/**
 * Props for Discussion component.
 */
export interface DiscussionProps {
  /** Optional callback when a tool is invoked */
  onToolUse?: (toolName: string, toolUseId: string) => void;
}

/**
 * Chat interface for vault-contextualized AI discussions.
 *
 * - Scrollable message history with user/assistant messages
 * - Streaming response display
 * - Input field with send button
 * - Slash command detection (basic, no autocomplete)
 * - Auto-scroll to bottom on new messages
 * - Draft preservation in localStorage
 */
export function Discussion({ onToolUse }: DiscussionProps): React.ReactNode {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { sendMessage, lastMessage, connectionStatus } = useWebSocket();
  const { vault, messages, addMessage } = useSession();
  const handleServerMessage = useServerMessageHandler();

  // Load draft from localStorage on mount
  useEffect(() => {
    const draft = localStorage.getItem(STORAGE_KEY);
    if (draft) {
      setInput(draft);
    }
  }, []);

  // Save draft to localStorage on input change
  useEffect(() => {
    if (input) {
      localStorage.setItem(STORAGE_KEY, input);
    }
  }, [input]);

  // Process incoming server messages
  useEffect(() => {
    if (lastMessage) {
      handleServerMessage(lastMessage);

      // Handle response end - clear submitting state
      if (lastMessage.type === "response_end") {
        setIsSubmitting(false);
      }

      // Handle tool use
      if (lastMessage.type === "tool_start") {
        onToolUse?.(lastMessage.toolName, lastMessage.toolUseId);
      }

      // Handle errors
      if (lastMessage.type === "error") {
        setIsSubmitting(false);
      }
    }
  }, [lastMessage, handleServerMessage, onToolUse]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Detect slash commands
  function isSlashCommand(text: string): boolean {
    return text.trim().startsWith("/");
  }

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
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Submit on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
  }

  const isDisabled = isSubmitting || connectionStatus !== "connected" || !vault;
  const showSlashHint = isSlashCommand(input);

  return (
    <div className="discussion">
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
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      <form className="discussion__input-area" onSubmit={handleSubmit}>
        {showSlashHint && (
          <div className="discussion__slash-hint" role="status">
            Slash command detected
          </div>
        )}
        <div className="discussion__input-row">
          <textarea
            ref={inputRef}
            className="discussion__input"
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={isSubmitting}
            rows={1}
            aria-label="Message input"
          />
          <button
            type="submit"
            className="discussion__send"
            disabled={isDisabled || !input.trim()}
            aria-label="Send message"
          >
            {isSubmitting ? (
              <span className="discussion__send-spinner" aria-hidden="true" />
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
    </div>
  );
}

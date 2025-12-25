/**
 * Message Bubble Component
 *
 * Displays a single message in the conversation with appropriate styling
 * for user (right-aligned) vs assistant (left-aligned) messages.
 */

import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ConversationMessage } from "../contexts/SessionContext";
import "./MessageBubble.css";

/**
 * Props for MessageBubble component.
 */
export interface MessageBubbleProps {
  /** The message to display */
  message: ConversationMessage;
}

/**
 * Formats a timestamp for display.
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Renders a single chat message bubble.
 *
 * - User messages: right-aligned with primary color background
 * - Assistant messages: left-aligned with secondary background
 * - Shows streaming indicator when message is still being received
 */
export function MessageBubble({ message }: MessageBubbleProps): React.ReactNode {
  return (
    <div
      className={`message-bubble message-bubble--${message.role}`}
      role="listitem"
    >
      <div className="message-bubble__content">
        <div className="message-bubble__text">
          {message.role === "user" ? (
            message.content
          ) : (
            <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
          )}
          {message.isStreaming && (
            <span className="message-bubble__cursor" aria-label="Typing">
              ▊
            </span>
          )}
        </div>
        <span className="message-bubble__time">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

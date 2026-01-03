/**
 * Message Bubble Component
 *
 * Displays a single message in the conversation with appropriate styling
 * for user (right-aligned) vs assistant (left-aligned) messages.
 * Assistant messages may include tool invocations displayed before the text.
 */

import React from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ConversationMessage } from "../contexts/SessionContext";
import { ToolDisplay } from "./ToolDisplay";
import "./MessageBubble.css";

/**
 * Custom markdown components for Discussion messages.
 * Uses decorative hr.webp image for horizontal rules.
 */
const markdownComponents: Components = {
  hr: () => (
    <img
      src="/images/hr.webp"
      alt=""
      className="message-bubble__hr"
      aria-hidden="true"
    />
  ),
};

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
 * - Assistant messages: left-aligned with secondary background, tool invocations before text
 * - Shows streaming indicator when message is still being received
 */
export function MessageBubble({ message }: MessageBubbleProps): React.ReactNode {
  const hasTools = message.role === "assistant" && message.toolInvocations && message.toolInvocations.length > 0;

  return (
    <div
      className={`message-bubble message-bubble--${message.role}`}
      role="listitem"
    >
      <div className="message-bubble__content">
        {/* Tool invocations displayed before message text */}
        {hasTools && (
          <div className="message-bubble__tools" role="list" aria-label="Tool invocations">
            {message.toolInvocations!.map((tool) => (
              <ToolDisplay
                key={tool.toolUseId}
                toolName={tool.toolName}
                toolUseId={tool.toolUseId}
                input={tool.input}
                output={tool.output}
                isLoading={tool.status === "running"}
              />
            ))}
          </div>
        )}
        <div className="message-bubble__text">
          {message.role === "user" ? (
            message.content
          ) : (
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{message.content}</Markdown>
          )}
          {message.isStreaming && (
            <img
              src="/images/empty-state.webp"
              alt="Typing"
              className="message-bubble__cursor"
            />
          )}
        </div>
        <span className="message-bubble__time">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

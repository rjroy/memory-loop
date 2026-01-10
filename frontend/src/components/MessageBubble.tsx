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
import { encodeAssetPath } from "../utils/file-types";
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
  /** Vault ID for constructing image URLs (required for user messages with images) */
  vaultId?: string;
}

/**
 * Formats a timestamp for display.
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Pattern to detect image paths in user messages.
 * Matches paths in common attachment directories.
 */
const IMAGE_PATH_PATTERN =
  /(?:05_Attachments|Attachments|attachments|assets|images)\/[\w.-]+\.(png|jpg|jpeg|gif|webp)/gi;

/**
 * Transforms user message content by converting detected image paths to markdown syntax.
 * This allows react-markdown to render both the markdown and inline images.
 */
function transformImagePaths(content: string, vaultId: string): string {
  // Reset regex lastIndex for each call
  IMAGE_PATH_PATTERN.lastIndex = 0;

  return content.replace(IMAGE_PATH_PATTERN, (match) => {
    const imageUrl = `/vault/${vaultId}/assets/${encodeAssetPath(match)}`;
    return `![Attached: ${match}](${imageUrl})`;
  });
}

/**
 * Renders user message content with markdown support.
 * Detects image paths and converts them to markdown image syntax before rendering.
 */
function UserMessageContent({
  content,
  vaultId,
}: {
  content: string;
  vaultId?: string;
}): React.ReactNode {
  const processedContent = vaultId ? transformImagePaths(content, vaultId) : content;

  return (
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {processedContent}
    </Markdown>
  );
}

/**
 * Renders a single chat message bubble.
 *
 * - User messages: right-aligned with primary color background
 * - Assistant messages: left-aligned with secondary background, tool invocations before text
 * - Shows streaming indicator when message is still being received
 */
export function MessageBubble({ message, vaultId }: MessageBubbleProps): React.ReactNode {
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
            <UserMessageContent content={message.content} vaultId={vaultId} />
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
        <div className="message-bubble__meta">
          <span className="message-bubble__time">
            {formatTime(message.timestamp)}
          </span>
          {message.role === "assistant" && message.contextUsage !== undefined && (
            <span className="message-bubble__context-usage">
              {message.contextUsage}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

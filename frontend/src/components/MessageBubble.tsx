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
 * Formats a duration in milliseconds for display.
 * Returns a string like "1h 23m 45s", omitting zero components.
 * For durations under 1 second, returns "<1s".
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 1) return "<1s";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

/**
 * Pattern to detect image paths in user messages.
 * Matches paths in common attachment directories.
 * Uses negative lookbehind to avoid matching paths inside markdown, URLs, or inline code.
 */
const IMAGE_PATH_PATTERN =
  /(?<![a-zA-Z0-9_\-/[`])(?:05_Attachments|Attachments|attachments|assets|images)\/[\w.-]+\.(png|jpg|jpeg|gif|webp)/gi;

/**
 * Pattern to detect Obsidian wiki-link image syntax.
 * Matches ![[path/to/image.ext]] format for images in any directory.
 * Uses negative lookbehind to avoid matching syntax inside inline code.
 */
const OBSIDIAN_IMAGE_PATTERN = /(?<!`)!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp))\]\]/gi;

/**
 * Transforms image references in content to markdown image syntax.
 * Handles both Obsidian wiki-link syntax (![[path]]) and attachment folder paths.
 */
function transformImageReferences(content: string, vaultId: string): string {
  // Reset regex lastIndex for each call
  OBSIDIAN_IMAGE_PATTERN.lastIndex = 0;
  IMAGE_PATH_PATTERN.lastIndex = 0;

  // First transform Obsidian wiki-link syntax: ![[path/to/image.png]]
  let result = content.replace(OBSIDIAN_IMAGE_PATTERN, (_match, path: string) => {
    const imageUrl = `/vault/${vaultId}/assets/${encodeAssetPath(path)}`;
    return `![${path}](${imageUrl})`;
  });

  // Then transform attachment folder paths (for backward compatibility)
  result = result.replace(IMAGE_PATH_PATTERN, (match) => {
    const imageUrl = `/vault/${vaultId}/assets/${encodeAssetPath(match)}`;
    return `![Attached: ${match}](${imageUrl})`;
  });

  return result;
}

/**
 * Renders message content with markdown support.
 * Transforms Obsidian image syntax and attachment paths to displayable images.
 */
function MessageContent({
  content,
  vaultId,
}: {
  content: string;
  vaultId?: string;
}): React.ReactNode {
  const processedContent = vaultId ? transformImageReferences(content, vaultId) : content;

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
          <MessageContent content={message.content} vaultId={vaultId} />
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
          {message.role === "assistant" && message.durationMs !== undefined && (
            <span className="message-bubble__duration">
              {formatDuration(message.durationMs)}
            </span>
          )}
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

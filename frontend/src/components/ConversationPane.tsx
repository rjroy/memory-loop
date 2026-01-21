/**
 * ConversationPane Component
 *
 * Shared conversation display for Discussion mode and Pair Writing Mode.
 * Renders message list with auto-scroll and streaming indicator.
 *
 * Extracted from Discussion.tsx per TD-7 to ensure REQ-NF-4 (consistent styling).
 */

import React, { useEffect, useRef } from "react";
import type { ConversationMessage } from "../contexts/SessionContext";
import { MessageBubble } from "./MessageBubble";
import "./ConversationPane.css";

/**
 * Props for ConversationPane component.
 */
export interface ConversationPaneProps {
  /** Messages to display */
  messages: ConversationMessage[];
  /** Vault ID for constructing image URLs in messages */
  vaultId?: string;
  /** Empty state content (displayed when no messages) */
  emptyState?: React.ReactNode;
  /** Additional CSS class for the container */
  className?: string;
  /** ARIA label for the conversation (defaults to "Conversation") */
  ariaLabel?: string;
}

/**
 * Default empty state for Discussion mode.
 */
export function DiscussionEmptyState(): React.ReactNode {
  return (
    <div className="conversation-pane__empty">
      <p>Start a conversation about your vault.</p>
      <p className="conversation-pane__hint">
        Try asking questions about your notes or use slash commands.
      </p>
    </div>
  );
}

/**
 * Renders a scrollable conversation with messages and auto-scroll behavior.
 *
 * Features:
 * - Scrollable message list with user/assistant messages
 * - Auto-scrolls to bottom when messages change
 * - Configurable empty state for different contexts
 * - Matches Discussion mode styling (REQ-NF-4)
 */
export function ConversationPane({
  messages,
  vaultId,
  emptyState,
  className,
  ariaLabel = "Conversation",
}: ConversationPaneProps): React.ReactNode {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const containerClassName = className
    ? `conversation-pane ${className}`
    : "conversation-pane";

  return (
    <div className={containerClassName} role="list" aria-label={ariaLabel}>
      {messages.length === 0 ? (
        emptyState ?? <DiscussionEmptyState />
      ) : (
        messages.map((message) => (
          <MessageBubble key={message.id} message={message} vaultId={vaultId} />
        ))
      )}
      <div ref={messagesEndRef} aria-hidden="true" />
    </div>
  );
}

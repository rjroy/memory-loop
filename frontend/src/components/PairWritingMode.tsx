/**
 * PairWritingMode Component
 *
 * Split-screen container for desktop pair writing with AI assistance.
 * Left pane: MemoryEditor for document editing
 * Right pane: ConversationPane for AI feedback and chat
 *
 * Desktop-only: hidden via CSS media query on touch devices (REQ-F-10).
 *
 * @see .sdd/plans/memory-loop/2026-01-20-pair-writing-mode-plan.md TD-5, TD-6, TD-9
 * @see .sdd/specs/memory-loop/2026-01-20-pair-writing-mode.md REQ-F-10, REQ-F-11, REQ-F-14, REQ-F-30
 */

import React, { useState, useCallback, useEffect } from "react";
import type { ClientMessage, ServerMessage } from "@memory-loop/shared";
import type { ConversationMessage } from "../contexts/SessionContext";
import {
  usePairWritingState,
  type PairWritingMessage,
} from "../hooks/usePairWritingState";
import { PairWritingToolbar } from "./PairWritingToolbar";
import { MemoryEditor } from "./MemoryEditor";
import { ConversationPane } from "./ConversationPane";
import { ConfirmDialog } from "./ConfirmDialog";
import "./PairWritingMode.css";

/**
 * Props for PairWritingMode component.
 */
export interface PairWritingModeProps {
  /** File path being edited (relative to vault content root) */
  filePath: string;
  /** Initial file content */
  content: string;
  /** Base URL for vault assets (images) */
  assetBaseUrl: string;
  /** Called when exiting Pair Writing mode */
  onExit: () => void;
  /** Called to save content to disk */
  onSave: (content: string) => void;
  /** Function to send WebSocket messages (optional, for full Quick Action support) */
  sendMessage?: (message: ClientMessage) => void;
  /** Last received server message (optional, for full Quick Action support) */
  lastMessage?: ServerMessage | null;
  /** Called when Quick Action completes and file should be reloaded */
  onQuickActionComplete?: (path: string) => void;
}

/**
 * Convert PairWritingMessage to ConversationMessage for ConversationPane.
 * ConversationPane expects the Discussion mode message format.
 */
function toConversationMessage(msg: PairWritingMessage): ConversationMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    toolInvocations: [], // Advisory actions don't use tools
  };
}

/**
 * Empty state for Pair Writing conversation pane.
 */
function PairWritingEmptyState(): React.ReactNode {
  return (
    <div className="pair-writing-conversation__empty">
      <p>Select text and use the context menu for AI assistance.</p>
      <p className="pair-writing-conversation__hint">
        Try Validate, Critique, or ask freeform questions.
      </p>
    </div>
  );
}

/**
 * Split-screen Pair Writing Mode for desktop.
 *
 * Features:
 * - 50/50 split layout with editor and conversation (REQ-F-11)
 * - Toolbar with Snapshot, Save, Exit buttons (REQ-F-14, REQ-F-23, REQ-F-29)
 * - Exit confirmation when unsaved manual edits exist (REQ-F-30)
 * - Hidden on touch devices via CSS media query (REQ-F-10)
 *
 * State management is handled by usePairWritingState hook (TD-5).
 */
export function PairWritingMode({
  filePath,
  content: initialContent,
  assetBaseUrl,
  onExit,
  onSave,
  sendMessage,
  lastMessage,
  onQuickActionComplete,
}: PairWritingModeProps): React.ReactNode {
  const { state, actions } = usePairWritingState();
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Extract vault ID from assetBaseUrl for ConversationPane
  // assetBaseUrl format: /vault/{vaultId}/assets
  const vaultId = assetBaseUrl.match(/\/vault\/([^/]+)\/assets/)?.[1];

  // Activate pair writing mode on mount (if not already active)
  useEffect(() => {
    if (!state.isActive) {
      actions.activate(initialContent);
    }
  }, [state.isActive, actions, initialContent]);

  // Handle snapshot button (REQ-F-23)
  const handleSnapshot = useCallback(() => {
    actions.takeSnapshot();
  }, [actions]);

  // Handle save button (REQ-F-29)
  const handleSave = useCallback(() => {
    setIsSaving(true);
    // Use the onSave prop to save content
    onSave(state.content);
    // Save completion is tracked via the parent component
    // For now, assume save is synchronous from our perspective
    setIsSaving(false);
    actions.markSaved();
  }, [onSave, state.content, actions]);

  // Handle exit button (REQ-F-14, REQ-F-30)
  const handleExitClick = useCallback(() => {
    if (state.hasUnsavedChanges) {
      setShowExitConfirm(true);
    } else {
      actions.clearAll();
      onExit();
    }
  }, [state.hasUnsavedChanges, actions, onExit]);

  // Confirm exit with unsaved changes
  const handleConfirmExit = useCallback(() => {
    setShowExitConfirm(false);
    actions.clearAll();
    onExit();
  }, [actions, onExit]);

  // Cancel exit
  const handleCancelExit = useCallback(() => {
    setShowExitConfirm(false);
  }, []);

  // Handle Quick Action completion (reload content from disk)
  const handleQuickActionComplete = useCallback(
    (path: string) => {
      // The file was updated by Claude's Edit tool
      // Parent component should reload the file and call onQuickActionComplete
      onQuickActionComplete?.(path);
    },
    [onQuickActionComplete]
  );

  // Create a no-op sendMessage if not provided (Quick Actions will be disabled)
  const safeSendMessage =
    sendMessage ??
    (() => {
      console.warn(
        "[PairWritingMode] sendMessage not provided, Quick Actions disabled"
      );
    });

  // Convert conversation messages for ConversationPane
  const conversationMessages = state.conversation.map(toConversationMessage);

  return (
    <div className="pair-writing-mode">
      {/* Toolbar (REQ-F-14) */}
      <PairWritingToolbar
        hasUnsavedChanges={state.hasUnsavedChanges}
        hasSnapshot={state.snapshot !== null}
        isSaving={isSaving}
        onSnapshot={handleSnapshot}
        onSave={handleSave}
        onExit={handleExitClick}
        filePath={filePath}
      />

      {/* Split-screen content (REQ-F-11, TD-6) */}
      <div className="pair-writing-mode__content">
        {/* Left pane: Editor (REQ-F-12) */}
        <div className="pair-writing-mode__editor-pane">
          <MemoryEditor
            sendMessage={safeSendMessage}
            lastMessage={lastMessage ?? null}
            filePath={filePath}
            onQuickActionComplete={handleQuickActionComplete}
          />
        </div>

        {/* Right pane: Conversation (REQ-F-13) */}
        <div className="pair-writing-mode__conversation-pane">
          <ConversationPane
            messages={conversationMessages}
            vaultId={vaultId}
            emptyState={<PairWritingEmptyState />}
            className="pair-writing-conversation"
            ariaLabel="Pair Writing conversation"
          />
        </div>
      </div>

      {/* Exit confirmation dialog (REQ-F-30) */}
      <ConfirmDialog
        isOpen={showExitConfirm}
        title="Unsaved Changes"
        message="You have unsaved manual edits. Are you sure you want to exit Pair Writing mode? Your changes will be lost."
        confirmLabel="Exit Without Saving"
        onConfirm={handleConfirmExit}
        onCancel={handleCancelExit}
      />
    </div>
  );
}

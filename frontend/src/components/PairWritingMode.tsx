/**
 * PairWritingMode Component
 *
 * Split-screen container for desktop pair writing with AI assistance.
 * Left pane: PairWritingEditor for document editing with Quick Actions
 * Right pane: Discussion component (same session as Think tab)
 *
 * Hidden on phones via CSS media query; visible on iPad and desktop (REQ-F-10).
 *
 * The right pane IS the Discussion tab: same conversation history, same session,
 * same WebSocket connection. Quick Actions and Advisory Actions appear in the
 * Discussion conversation, and responses stream through the same channel.
 *
 * @see .sdd/plans/memory-loop/2026-01-20-pair-writing-mode-plan.md TD-5, TD-6, TD-9
 * @see .sdd/specs/memory-loop/2026-01-20-pair-writing-mode.md REQ-F-10, REQ-F-11, REQ-F-14, REQ-F-30
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { ClientMessage, ServerMessage } from "@memory-loop/shared";
import { useSession } from "../contexts/SessionContext";
import { usePairWritingState } from "../hooks/usePairWritingState";
import { PairWritingToolbar } from "./PairWritingToolbar";
import { PairWritingEditor } from "./PairWritingEditor";
import { Discussion } from "./Discussion";
import { ConfirmDialog } from "./ConfirmDialog";
import type { AdvisoryActionType, QuickActionType } from "./EditorContextMenu";
import { type SelectionContext } from "../hooks/useTextSelection";
import type { ConnectionStatus } from "../hooks/useWebSocket";
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
  /** Function to send WebSocket messages (shared with Discussion) */
  sendMessage: (message: ClientMessage) => void;
  /** Last received server message (shared with Discussion) */
  lastMessage: ServerMessage | null;
  /** Current WebSocket connection status (shared with Discussion) */
  connectionStatus: ConnectionStatus;
  /** Called when Quick Action completes and file should be reloaded */
  onQuickActionComplete?: (path: string) => void;
  // Dependency injection for testing (avoids mock.module pollution)
  /** Editor component to render (defaults to PairWritingEditor) */
  EditorComponent?: typeof PairWritingEditor;
  /** Discussion component to render (defaults to Discussion) */
  DiscussionComponent?: typeof Discussion;
}

/**
 * Split-screen Pair Writing Mode for desktop.
 *
 * Features:
 * - 50/50 split layout with editor and Discussion (REQ-F-11)
 * - Toolbar with Snapshot, Save, Exit buttons (REQ-F-14, REQ-F-23, REQ-F-29)
 * - Exit confirmation when unsaved manual edits exist (REQ-F-30)
 * - Hidden on phones via CSS media query; visible on iPad and desktop (REQ-F-10)
 * - Discussion in right pane is the same session as Think tab
 *
 * State management for editor (content, snapshot, unsaved changes) is handled
 * by usePairWritingState hook. Conversation state is managed by SessionContext
 * and displayed by the embedded Discussion component.
 */
export function PairWritingMode({
  filePath,
  content: initialContent,
  assetBaseUrl: _assetBaseUrl,
  onExit,
  onSave,
  sendMessage,
  lastMessage,
  connectionStatus,
  onQuickActionComplete,
  EditorComponent = PairWritingEditor,
  DiscussionComponent = Discussion,
}: PairWritingModeProps): React.ReactNode {
  void _assetBaseUrl; // Preserved for interface stability; Discussion handles its own asset resolution
  const { state, actions } = usePairWritingState();
  const { addMessage } = useSession();
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentSelection, setCurrentSelection] = useState<SelectionContext | null>(null);
  const [openMenuTrigger, setOpenMenuTrigger] = useState(0);

  // Track previous initialContent to detect external changes (not local edits)
  const prevInitialContent = useRef(initialContent);

  // Activate pair writing mode on mount (if not already active)
  useEffect(() => {
    if (!state.isActive) {
      actions.activate(initialContent);
    }
  }, [state.isActive, actions, initialContent]);

  // Update content when initialContent prop changes from parent (e.g., after Quick Action reload)
  // Only triggers when the PARENT changes the content, not when user makes local edits
  useEffect(() => {
    if (state.isActive && initialContent !== prevInitialContent.current) {
      // Content was reloaded from disk (e.g., after Quick Action)
      actions.reloadContent(initialContent);
      prevInitialContent.current = initialContent;
    }
  }, [initialContent, state.isActive, actions]);

  // Handle selection changes from editor
  const handleSelectionChange = useCallback((selection: SelectionContext | null) => {
    setCurrentSelection(selection);
  }, []);

  // Handle Actions button click (opens context menu in editor)
  const handleShowActions = useCallback(() => {
    setOpenMenuTrigger((prev) => prev + 1);
  }, []);

  // Handle snapshot button (REQ-F-23)
  // Captures the currently selected text, not the entire file
  const handleSnapshot = useCallback(() => {
    if (currentSelection?.text) {
      actions.takeSnapshot(currentSelection.text);
    }
  }, [actions, currentSelection]);

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

  // Handle content change from editor
  const handleContentChange = useCallback(
    (newContent: string) => {
      actions.setContent(newContent);
    },
    [actions]
  );

  // Handle Quick Action completion (reload content from disk)
  const handleQuickActionComplete = useCallback(
    (path: string) => {
      // The file was updated by Claude's Edit tool
      // Parent component should reload the file
      onQuickActionComplete?.(path);
    },
    [onQuickActionComplete]
  );

  // Handle Quick Action from editor
  // Adds user message to SessionContext so it appears in the Discussion
  const handleQuickAction = useCallback(
    (action: QuickActionType, selection: SelectionContext) => {
      // Add user message showing what they selected to the shared conversation
      const userMessage = `[${action.charAt(0).toUpperCase() + action.slice(1)}] "${selection.text}"`;
      addMessage({ role: "user", content: userMessage });

      // Send quick action request to backend
      sendMessage({
        type: "quick_action_request",
        action,
        selection: selection.text,
        contextBefore: selection.contextBefore,
        contextAfter: selection.contextAfter,
        filePath,
        selectionStartLine: selection.startLine,
        selectionEndLine: selection.endLine,
        totalLines: selection.totalLines,
      });
    },
    [addMessage, sendMessage, filePath]
  );

  // Handle Advisory Action from editor (REQ-F-15)
  // Adds user message to SessionContext so it appears in the Discussion
  const handleAdvisoryAction = useCallback(
    (action: AdvisoryActionType, selection: SelectionContext) => {
      // Add user message showing what they selected to the shared conversation
      const userMessage = `[${action.charAt(0).toUpperCase() + action.slice(1)}] "${selection.text}"`;
      addMessage({ role: "user", content: userMessage });

      // Send advisory action request to backend
      // Backend routes through existing session, response appears in Discussion
      sendMessage({
        type: "advisory_action_request",
        action,
        selection: selection.text,
        contextBefore: selection.contextBefore,
        contextAfter: selection.contextAfter,
        filePath,
        selectionStartLine: selection.startLine,
        selectionEndLine: selection.endLine,
        totalLines: selection.totalLines,
        snapshotSelection: action === "compare" ? state.snapshot ?? undefined : undefined,
      });
    },
    [addMessage, sendMessage, filePath, state.snapshot]
  );

  return (
    <div className="pair-writing-mode">
      {/* Toolbar (REQ-F-14) */}
      <PairWritingToolbar
        hasUnsavedChanges={state.hasUnsavedChanges}
        hasSnapshot={state.snapshot !== null}
        hasSelection={currentSelection !== null}
        isSaving={isSaving}
        onSnapshot={handleSnapshot}
        onSave={handleSave}
        onExit={handleExitClick}
        onShowActions={handleShowActions}
        filePath={filePath}
        snapshotContent={state.snapshot ?? undefined}
      />

      {/* Split-screen content (REQ-F-11, TD-6) */}
      <div className="pair-writing-mode__content">
        {/* Left pane: Editor (REQ-F-12) */}
        <div className="pair-writing-mode__editor-pane">
          <EditorComponent
            initialContent={initialContent}
            filePath={filePath}
            sendMessage={sendMessage}
            lastMessage={lastMessage}
            onContentChange={handleContentChange}
            onQuickActionComplete={handleQuickActionComplete}
            onQuickAction={handleQuickAction}
            onAdvisoryAction={handleAdvisoryAction}
            onSelectionChange={handleSelectionChange}
            hasSnapshot={state.snapshot !== null}
            snapshotContent={state.snapshot ?? undefined}
            openMenuTrigger={openMenuTrigger}
          />
        </div>

        {/* Right pane: Discussion (same session as Think tab) */}
        <div className="pair-writing-mode__conversation-pane">
          <DiscussionComponent
            sendMessage={sendMessage}
            connectionStatus={connectionStatus}
            lastMessage={lastMessage}
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

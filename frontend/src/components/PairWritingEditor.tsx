/**
 * PairWritingEditor Component
 *
 * Editor for Pair Writing Mode that handles arbitrary markdown files.
 * Supports Quick Actions via context menu with text selection.
 *
 * Key difference from MemoryEditor: This component receives content via props
 * rather than fetching a specific file. It's designed for editing any vault file.
 *
 * Features:
 * - Textarea for editing content
 * - Context menu with Quick Actions (Tighten, Embellish, Correct, Polish)
 * - Advisory Actions in pair-writing mode (Validate, Critique, Compare)
 * - WebSocket integration for streaming Quick Action responses
 * - Toast notifications for Claude's commentary
 *
 * Spec Requirements:
 * - REQ-F-4: Selection + context sent to Claude for Quick Actions
 * - REQ-F-6: Toast for Claude commentary
 * - REQ-F-7: Loading indicator on selection during processing
 * - REQ-F-8: Quick Actions persist immediately via Claude Edit tool
 * - REQ-F-12: Editor pane in split view
 * - REQ-F-15: Advisory Actions (Validate, Critique)
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type {
  ClientMessage,
  ServerMessage,
  QuickActionType as QuickActionTypeProtocol,
} from "@memory-loop/shared";
import {
  EditorContextMenu,
  getMenuPositionFromEvent,
  type MenuPosition,
  type QuickActionType,
  type AdvisoryActionType,
} from "./EditorContextMenu";
import { useLongPress } from "../hooks/useLongPress";
import {
  useTextSelection,
  type SelectionContext,
} from "../hooks/useTextSelection";
import { Toast, type ToastVariant } from "./Toast";
import "./PairWritingEditor.css";

/**
 * Props for the PairWritingEditor component.
 */
export interface PairWritingEditorProps {
  /** Initial file content to display */
  initialContent: string;
  /** File path (relative to vault content root) for Quick Actions */
  filePath: string;
  /** Function to send WebSocket messages */
  sendMessage: (message: ClientMessage) => void;
  /** Last received server message (for handling responses) */
  lastMessage: ServerMessage | null;
  /** Called when content changes (for tracking unsaved changes) */
  onContentChange?: (content: string) => void;
  /** Called when Quick Action completes and file should be reloaded */
  onQuickActionComplete?: (path: string) => void;
  /** Called when an Advisory Action is triggered (for conversation pane) */
  onAdvisoryAction?: (
    action: AdvisoryActionType,
    selection: SelectionContext
  ) => void;
  /** Whether a snapshot exists (shows Compare action) */
  hasSnapshot?: boolean;
  /** Current snapshot content (for Compare action) */
  snapshotContent?: string;
  // Dependency injection for testing (avoids mock.module pollution)
  /** Context menu component (defaults to EditorContextMenu) */
  ContextMenuComponent?: typeof EditorContextMenu;
  /** Toast component (defaults to Toast) */
  ToastComponent?: typeof Toast;
}

/**
 * PairWritingEditor Component
 *
 * A textarea-based editor for Pair Writing Mode that supports:
 * - Quick Actions via context menu (right-click/long-press)
 * - Advisory Actions for pair-writing mode
 * - Real-time streaming of Claude's responses
 * - Toast notifications for commentary
 */
export function PairWritingEditor({
  initialContent,
  filePath,
  sendMessage,
  lastMessage,
  onContentChange,
  onQuickActionComplete,
  onAdvisoryAction,
  hasSnapshot = false,
  ContextMenuComponent = EditorContextMenu,
  ToastComponent = Toast,
}: PairWritingEditorProps): React.ReactNode {
  // Content state - initialized from props, updated on edit
  const [content, setContent] = useState(initialContent);

  // Context menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  // Quick Action state (REQ-F-7: loading indicator during processing)
  const [isProcessingQuickAction, setIsProcessingQuickAction] = useState(false);
  const [quickActionMessageId, setQuickActionMessageId] = useState<
    string | null
  >(null);
  // Use ref for confirmation to avoid infinite loop in useEffect
  // (state in deps would re-trigger effect on every chunk append)
  const quickActionConfirmationRef = useRef("");

  // Toast state (REQ-F-6: commentary displayed as toast)
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVariant, setToastVariant] = useState<ToastVariant>("success");

  // Ref to the textarea for selection tracking
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Track text selection
  const { selection } = useTextSelection(textareaRef, content);

  // Store selection context for use in action handlers
  const selectionRef = useRef<SelectionContext | null>(null);
  selectionRef.current = selection;

  // Track filePath in ref for use in callbacks
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  // Update content when initialContent changes (e.g., after Quick Action reload)
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  // Handle server messages for Quick Actions
  useEffect(() => {
    if (!lastMessage || !isProcessingQuickAction) return;

    if (lastMessage.type === "response_start") {
      // Store message ID for tracking
      setQuickActionMessageId(lastMessage.messageId);
    } else if (lastMessage.type === "response_chunk") {
      // Accumulate confirmation message text from Claude
      if (lastMessage.messageId === quickActionMessageId) {
        quickActionConfirmationRef.current += lastMessage.content;
      }
    } else if (lastMessage.type === "response_end") {
      // Quick Action complete - clear processing state
      setIsProcessingQuickAction(false);
      setQuickActionMessageId(null);

      // Show toast with confirmation message (REQ-F-6)
      const confirmation = quickActionConfirmationRef.current.trim();
      if (confirmation) {
        setToastMessage(confirmation);
        setToastVariant("success");
        setToastVisible(true);
      }
      quickActionConfirmationRef.current = "";

      // Trigger file reload (REQ-F-8: file is already updated by Claude's Edit tool)
      onQuickActionComplete?.(filePathRef.current);
    } else if (lastMessage.type === "error") {
      // Clear Quick Action processing state on error
      setIsProcessingQuickAction(false);
      setQuickActionMessageId(null);
      quickActionConfirmationRef.current = "";
      // Show error toast
      setToastMessage(lastMessage.message);
      setToastVariant("error");
      setToastVisible(true);
    }
  }, [lastMessage, isProcessingQuickAction, quickActionMessageId, onQuickActionComplete]);

  // Handle content change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setContent(newContent);
      onContentChange?.(newContent);
    },
    [onContentChange]
  );

  // Open context menu at position (only if there's a selection)
  const openContextMenu = useCallback((position: MenuPosition) => {
    // Only show menu if there's selected text
    if (!selectionRef.current) return;
    setMenuPosition(position);
    setMenuOpen(true);
  }, []);

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuPosition(null);
  }, []);

  // Handle right-click (desktop context menu)
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      // Only intercept if there's a selection
      if (!selectionRef.current) return;

      e.preventDefault();
      openContextMenu(getMenuPositionFromEvent(e));
    },
    [openContextMenu]
  );

  // Handle long-press (mobile context menu)
  const handleLongPress = useCallback(
    (e: React.TouchEvent) => {
      // Only show menu if there's a selection
      if (!selectionRef.current) return;

      openContextMenu(getMenuPositionFromEvent(e));
    },
    [openContextMenu]
  );

  // Long press handlers for mobile
  const longPressHandlers = useLongPress(handleLongPress, { duration: 500 });

  // Handle Quick Action selection
  const handleQuickAction = useCallback(
    (action: QuickActionType) => {
      const currentSelection = selectionRef.current;
      if (!currentSelection) {
        closeContextMenu();
        return;
      }

      // Close menu immediately
      closeContextMenu();

      // Set processing state for loading indicator (REQ-F-7)
      setIsProcessingQuickAction(true);
      quickActionConfirmationRef.current = "";
      setQuickActionMessageId(null);

      // Send quick_action_request message (REQ-F-4)
      sendMessage({
        type: "quick_action_request",
        action: action as QuickActionTypeProtocol,
        selection: currentSelection.text,
        contextBefore: currentSelection.contextBefore,
        contextAfter: currentSelection.contextAfter,
        filePath: filePathRef.current,
        selectionStartLine: currentSelection.startLine,
        selectionEndLine: currentSelection.endLine,
        totalLines: currentSelection.totalLines,
      });
    },
    [closeContextMenu, sendMessage]
  );

  // Handle Advisory Action selection (REQ-F-15)
  const handleAdvisoryAction = useCallback(
    (action: AdvisoryActionType) => {
      const currentSelection = selectionRef.current;
      if (!currentSelection) {
        closeContextMenu();
        return;
      }

      // Close menu immediately
      closeContextMenu();

      // Delegate to parent for conversation pane handling
      onAdvisoryAction?.(action, currentSelection);
    },
    [closeContextMenu, onAdvisoryAction]
  );

  return (
    <div
      className={`pair-writing-editor${isProcessingQuickAction ? " pair-writing-editor--processing" : ""}`}
    >
      {/* Textarea for editing */}
      <textarea
        ref={textareaRef}
        className={`pair-writing-editor__textarea${isProcessingQuickAction ? " pair-writing-editor__textarea--processing" : ""}`}
        value={content}
        onChange={handleChange}
        onContextMenu={handleContextMenu}
        {...longPressHandlers}
        spellCheck={false}
        disabled={isProcessingQuickAction}
        aria-label="Document editor"
      />

      {/* Loading indicator for Quick Actions (REQ-F-7) */}
      {isProcessingQuickAction && (
        <div className="pair-writing-editor__processing-overlay">
          <div className="pair-writing-editor__processing-spinner" />
          <span className="pair-writing-editor__processing-text">
            Applying changes...
          </span>
        </div>
      )}

      {/* Context Menu for Quick Actions and Advisory Actions */}
      <ContextMenuComponent
        isOpen={menuOpen}
        position={menuPosition}
        onAction={handleQuickAction}
        onAdvisoryAction={handleAdvisoryAction}
        onDismiss={closeContextMenu}
        mode="pair-writing"
        hasSnapshot={hasSnapshot}
      />

      {/* Toast for Quick Action confirmation (REQ-F-6) */}
      <ToastComponent
        isVisible={toastVisible}
        variant={toastVariant}
        message={toastMessage}
        onDismiss={() => setToastVisible(false)}
      />
    </div>
  );
}

/**
 * PairWritingEditor Component
 *
 * Editor for Pair Writing Mode that supports Quick Actions (text transformation)
 * and Advisory Actions (conversation-based feedback) via context menu.
 *
 * Unlike MemoryEditor, this component receives content via props rather than
 * fetching a specific file, making it suitable for editing any vault file.
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

export interface PairWritingEditorProps {
  initialContent: string;
  filePath: string;
  sendMessage: (message: ClientMessage) => void;
  lastMessage: ServerMessage | null;
  onContentChange?: (content: string) => void;
  onQuickActionComplete?: (path: string) => void;
  onAdvisoryAction?: (
    action: AdvisoryActionType,
    selection: SelectionContext
  ) => void;
  hasSnapshot?: boolean;
  snapshotContent?: string;
  /** Dependency injection for testing */
  ContextMenuComponent?: typeof EditorContextMenu;
  /** Dependency injection for testing */
  ToastComponent?: typeof Toast;
}

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
  const [content, setContent] = useState(initialContent);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [isProcessingQuickAction, setIsProcessingQuickAction] = useState(false);
  const [quickActionMessageId, setQuickActionMessageId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    variant: ToastVariant;
  }>({ visible: false, message: "", variant: "success" });

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Ref accumulates streamed confirmation text (avoids re-render per chunk)
  const quickActionConfirmationRef = useRef("");

  const { selection } = useTextSelection(textareaRef, content);

  // Refs for stable callback access to current values
  const selectionRef = useRef<SelectionContext | null>(null);
  selectionRef.current = selection;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  // Sync content when initialContent changes (e.g., after Quick Action reload)
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  // Process Quick Action response messages
  useEffect(() => {
    if (!lastMessage || !isProcessingQuickAction) return;

    switch (lastMessage.type) {
      case "response_start":
        setQuickActionMessageId(lastMessage.messageId);
        break;

      case "response_chunk":
        if (lastMessage.messageId === quickActionMessageId) {
          quickActionConfirmationRef.current += lastMessage.content;
        }
        break;

      case "response_end": {
        setIsProcessingQuickAction(false);
        setQuickActionMessageId(null);

        const confirmation = quickActionConfirmationRef.current.trim();
        if (confirmation) {
          setToast({ visible: true, message: confirmation, variant: "success" });
        }
        quickActionConfirmationRef.current = "";

        onQuickActionComplete?.(filePathRef.current);
        break;
      }

      case "error":
        setIsProcessingQuickAction(false);
        setQuickActionMessageId(null);
        quickActionConfirmationRef.current = "";
        setToast({ visible: true, message: lastMessage.message, variant: "error" });
        break;
    }
  }, [lastMessage, isProcessingQuickAction, quickActionMessageId, onQuickActionComplete]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setContent(newContent);
      onContentChange?.(newContent);
    },
    [onContentChange]
  );

  const openContextMenu = useCallback((position: MenuPosition) => {
    if (!selectionRef.current) return;
    setMenuPosition(position);
    setMenuOpen(true);
  }, []);

  const closeContextMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuPosition(null);
  }, []);

  // Desktop: right-click opens context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (!selectionRef.current) return;
      e.preventDefault();
      openContextMenu(getMenuPositionFromEvent(e));
    },
    [openContextMenu]
  );

  // Mobile: long-press opens context menu
  const handleLongPress = useCallback(
    (e: React.TouchEvent) => {
      if (!selectionRef.current) return;
      openContextMenu(getMenuPositionFromEvent(e));
    },
    [openContextMenu]
  );

  const longPressHandlers = useLongPress(handleLongPress, { duration: 500 });

  const handleQuickAction = useCallback(
    (action: QuickActionType) => {
      const currentSelection = selectionRef.current;
      closeContextMenu();
      if (!currentSelection) return;

      setIsProcessingQuickAction(true);
      quickActionConfirmationRef.current = "";
      setQuickActionMessageId(null);

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

  const handleAdvisoryAction = useCallback(
    (action: AdvisoryActionType) => {
      const currentSelection = selectionRef.current;
      closeContextMenu();
      if (!currentSelection) return;

      onAdvisoryAction?.(action, currentSelection);
    },
    [closeContextMenu, onAdvisoryAction]
  );

  const processingClass = isProcessingQuickAction ? " pair-writing-editor--processing" : "";
  const textareaProcessingClass = isProcessingQuickAction ? " pair-writing-editor__textarea--processing" : "";

  return (
    <div className={`pair-writing-editor${processingClass}`}>
      <textarea
        ref={textareaRef}
        className={`pair-writing-editor__textarea${textareaProcessingClass}`}
        value={content}
        onChange={handleChange}
        onContextMenu={handleContextMenu}
        {...longPressHandlers}
        spellCheck={false}
        disabled={isProcessingQuickAction}
        aria-label="Document editor"
      />

      {isProcessingQuickAction && (
        <div className="pair-writing-editor__processing-overlay">
          <div className="pair-writing-editor__processing-spinner" />
          <span className="pair-writing-editor__processing-text">
            Applying changes...
          </span>
        </div>
      )}

      <ContextMenuComponent
        isOpen={menuOpen}
        position={menuPosition}
        onAction={handleQuickAction}
        onAdvisoryAction={handleAdvisoryAction}
        onDismiss={closeContextMenu}
        mode="pair-writing"
        hasSnapshot={hasSnapshot}
      />

      <ToastComponent
        isVisible={toast.visible}
        variant={toast.variant}
        message={toast.message}
        onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </div>
  );
}

/**
 * MemoryEditor Component
 *
 * Editor for the memory.md file used by Claude for context injection.
 * Also supports Quick Actions for Pair Writing Mode when filePath is provided.
 *
 * Features:
 * - Textarea for editing content
 * - Size indicator showing current/max bytes
 * - Save button with loading state
 * - Error handling and display
 * - Context menu with Quick Actions (Tighten, Embellish, Correct, Polish)
 * - WebSocket integration for streaming Quick Action responses
 *
 * Spec Requirements:
 * - REQ-F-12: View memory.md
 * - REQ-F-13: Edit memory.md
 * - REQ-NF-1: Enforce 50KB memory file limit
 * - REQ-F-4: Selection + context sent to Claude for Quick Actions
 * - REQ-F-6: Toast for Claude commentary
 * - REQ-F-7: Loading indicator on selection during processing
 * - REQ-F-8: Quick Actions persist immediately via Claude Edit tool
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { ClientMessage, ServerMessage, QuickActionType as QuickActionTypeProtocol } from "@memory-loop/shared";
import {
  EditorContextMenu,
  getMenuPositionFromEvent,
  type MenuPosition,
  type QuickActionType,
} from "./EditorContextMenu";
import { useLongPress } from "../hooks/useLongPress";
import { useTextSelection, type SelectionContext } from "../hooks/useTextSelection";
import { Toast, type ToastVariant } from "./Toast";
import "./MemoryEditor.css";

/**
 * Maximum memory file size in bytes (50KB).
 */
const MAX_MEMORY_SIZE = 50 * 1024;

/**
 * Warning threshold for memory file size (45KB = 90% of max).
 */
const WARNING_THRESHOLD = 45 * 1024;

/**
 * Props for the MemoryEditor component.
 */
export interface MemoryEditorProps {
  /** Function to send WebSocket messages */
  sendMessage: (message: ClientMessage) => void;
  /** Last received server message (for handling responses) */
  lastMessage: ServerMessage | null;
  /**
   * Optional file path for Quick Actions (relative to vault content root).
   * When provided, Quick Actions will send requests for this vault file.
   * When omitted, Quick Actions are disabled (memory.md editing mode).
   */
  filePath?: string;
  /**
   * Optional callback fired when Quick Action completes and file should be reloaded.
   * Called with the file path after response_end is received.
   */
  onQuickActionComplete?: (path: string) => void;
  /**
   * Optional callback to handle WebSocket messages specifically for Quick Actions.
   * Used when the parent component manages its own WebSocket connection.
   * If not provided, Quick Action streaming events are handled internally.
   */
  onMessage?: (message: ServerMessage) => void;
}

/**
 * MemoryEditor Component
 *
 * Provides an interface for viewing and editing the memory.md file.
 * The content is loaded from the server on mount and can be saved back.
 * Also supports Quick Actions for Pair Writing Mode when filePath is provided.
 */
export function MemoryEditor({
  sendMessage,
  lastMessage,
  filePath,
  onQuickActionComplete,
  onMessage,
}: MemoryEditorProps): React.ReactNode {
  // State
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setSizeBytes] = useState(0);
  const [fileExists, setFileExists] = useState(false);

  // Context menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  // Quick Action state (REQ-F-7: loading indicator during processing)
  const [isProcessingQuickAction, setIsProcessingQuickAction] = useState(false);
  const [quickActionMessageId, setQuickActionMessageId] = useState<string | null>(null);
  const [quickActionConfirmation, setQuickActionConfirmation] = useState<string>("");

  // Toast state (REQ-F-6: commentary displayed as toast)
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVariant, setToastVariant] = useState<ToastVariant>("success");

  // Ref to the textarea for selection tracking
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Track if we've requested the content
  const hasRequestedRef = useRef(false);

  // Track text selection
  const { selection } = useTextSelection(textareaRef, content);

  // Store selection context for use in action handler
  const selectionRef = useRef<SelectionContext | null>(null);
  selectionRef.current = selection;

  // Track filePath in ref for use in callbacks
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  // Calculate current content size
  const currentSize = new TextEncoder().encode(content).length;
  const sizePercentage = Math.min((currentSize / MAX_MEMORY_SIZE) * 100, 100);
  const isOverLimit = currentSize > MAX_MEMORY_SIZE;
  const isWarning = currentSize >= WARNING_THRESHOLD && !isOverLimit;
  const hasChanges = content !== originalContent;

  // Request memory content on mount
  useEffect(() => {
    if (!hasRequestedRef.current) {
      hasRequestedRef.current = true;
      sendMessage({ type: "get_memory" });
    }
  }, [sendMessage]);

  // Ref to track current content for save callback
  const contentRef = useRef(content);
  contentRef.current = content;

  // Handle server messages
  useEffect(() => {
    if (!lastMessage) return;

    // Forward message to external handler if provided
    onMessage?.(lastMessage);

    // Handle memory file messages (when not in Quick Action mode)
    if (lastMessage.type === "memory_content") {
      setContent(lastMessage.content);
      setOriginalContent(lastMessage.content);
      setSizeBytes(lastMessage.sizeBytes);
      setFileExists(lastMessage.exists);
      setIsLoading(false);
      setError(null);
    } else if (lastMessage.type === "memory_saved") {
      setIsSaving(false);
      if (lastMessage.success) {
        // Update original content to match current content (use ref to avoid stale closure)
        setOriginalContent(contentRef.current);
        if (lastMessage.sizeBytes !== undefined) {
          setSizeBytes(lastMessage.sizeBytes);
        }
        setFileExists(true);
        setError(null);
      } else {
        setError(lastMessage.error ?? "Failed to save memory file");
      }
    } else if (lastMessage.type === "error") {
      setIsLoading(false);
      setIsSaving(false);
      // Clear Quick Action processing state on error
      if (isProcessingQuickAction) {
        setIsProcessingQuickAction(false);
        setQuickActionMessageId(null);
        setQuickActionConfirmation("");
        // Show error toast
        setToastMessage(lastMessage.message);
        setToastVariant("error");
        setToastVisible(true);
      } else {
        setError(lastMessage.message);
      }
    }

    // Handle Quick Action streaming events (when filePath is provided)
    // These events use the same message types as Discussion mode
    if (filePathRef.current && isProcessingQuickAction) {
      if (lastMessage.type === "response_start") {
        // Store message ID for tracking
        setQuickActionMessageId(lastMessage.messageId);
      } else if (lastMessage.type === "response_chunk") {
        // Accumulate confirmation message text from Claude
        if (lastMessage.messageId === quickActionMessageId) {
          setQuickActionConfirmation((prev) => prev + lastMessage.content);
        }
      } else if (lastMessage.type === "response_end") {
        // Quick Action complete - clear processing state
        setIsProcessingQuickAction(false);
        setQuickActionMessageId(null);

        // Show toast with confirmation message (REQ-F-6)
        const confirmation = quickActionConfirmation.trim();
        if (confirmation) {
          setToastMessage(confirmation);
          setToastVariant("success");
          setToastVisible(true);
        }
        setQuickActionConfirmation("");

        // Trigger file reload (REQ-F-8: file is already updated by Claude's Edit tool)
        if (filePathRef.current) {
          onQuickActionComplete?.(filePathRef.current);
        }
      }
      // Note: tool_start and tool_end events can be used to show "editing..." indicator
      // but are optional per the task description
    }
  }, [lastMessage, onMessage, isProcessingQuickAction, quickActionMessageId, quickActionConfirmation, onQuickActionComplete]);

  // Handle content change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
      setError(null); // Clear error on edit
    },
    []
  );

  // Handle save
  const handleSave = useCallback(() => {
    if (isSaving || isOverLimit) return;
    setIsSaving(true);
    setError(null);
    sendMessage({ type: "save_memory", content });
  }, [sendMessage, content, isSaving, isOverLimit]);

  // Handle reset to original
  const handleReset = useCallback(() => {
    setContent(originalContent);
    setError(null);
  }, [originalContent]);

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
  const handleAction = useCallback(
    (action: QuickActionType) => {
      const currentSelection = selectionRef.current;
      if (!currentSelection) {
        closeContextMenu();
        return;
      }

      // Close menu immediately
      closeContextMenu();

      // If filePath is provided, send Quick Action request via WebSocket
      if (filePathRef.current) {
        // Set processing state for loading indicator (REQ-F-7)
        setIsProcessingQuickAction(true);
        setQuickActionConfirmation("");
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
      } else {
        // Memory file mode - Quick Actions not supported, just log
        console.log("Quick Action not available in memory file mode:", {
          action,
          selection: currentSelection,
        });
      }
    },
    [closeContextMenu, sendMessage]
  );

  // Format bytes for display
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="memory-editor">
      {/* Header with info */}
      <div className="memory-editor__header">
        <div className="memory-editor__info">
          <span className="memory-editor__label">
            Memory File
            {!fileExists && !isLoading && (
              <span className="memory-editor__badge memory-editor__badge--new">
                New
              </span>
            )}
          </span>
          <span className="memory-editor__path">~/.claude/rules/memory.md</span>
        </div>
      </div>

      {/* Size indicator */}
      <div className="memory-editor__size-container">
        <div className="memory-editor__size-bar">
          <div
            className={`memory-editor__size-fill${isOverLimit ? " memory-editor__size-fill--error" : isWarning ? " memory-editor__size-fill--warning" : ""}`}
            style={{ width: `${sizePercentage}%` }}
          />
        </div>
        <div className="memory-editor__size-text">
          <span
            className={`memory-editor__size-current${isOverLimit ? " memory-editor__size-current--error" : isWarning ? " memory-editor__size-current--warning" : ""}`}
          >
            {formatBytes(currentSize)}
          </span>
          <span className="memory-editor__size-separator">/</span>
          <span className="memory-editor__size-max">
            {formatBytes(MAX_MEMORY_SIZE)}
          </span>
        </div>
      </div>

      {/* Editor area */}
      <div className={`memory-editor__content${isProcessingQuickAction ? " memory-editor__content--processing" : ""}`}>
        {isLoading ? (
          <div className="memory-editor__loading">
            <div className="memory-editor__spinner" />
            <span>Loading memory file...</span>
          </div>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              className={`memory-editor__textarea${isProcessingQuickAction ? " memory-editor__textarea--processing" : ""}`}
              value={content}
              onChange={handleChange}
              onContextMenu={handleContextMenu}
              {...longPressHandlers}
              placeholder="# Memory&#10;&#10;Add facts about yourself that Claude should remember..."
              spellCheck={false}
              disabled={isProcessingQuickAction}
            />
            {/* Loading indicator for Quick Actions (REQ-F-7) */}
            {isProcessingQuickAction && (
              <div className="memory-editor__processing-overlay">
                <div className="memory-editor__processing-spinner" />
                <span className="memory-editor__processing-text">Applying changes...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="memory-editor__error" role="alert">
          {error}
        </div>
      )}

      {/* Over limit warning */}
      {isOverLimit && (
        <div className="memory-editor__warning" role="alert">
          Content exceeds 50KB limit. Reduce content before saving.
        </div>
      )}

      {/* Actions */}
      <div className="memory-editor__actions">
        <button
          type="button"
          className="memory-editor__btn memory-editor__btn--reset"
          onClick={handleReset}
          disabled={!hasChanges || isSaving}
        >
          Reset
        </button>
        <button
          type="button"
          className={`memory-editor__btn memory-editor__btn--save${isSaving ? " memory-editor__btn--loading" : ""}`}
          onClick={handleSave}
          disabled={!hasChanges || isSaving || isOverLimit}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Context Menu for Quick Actions */}
      <EditorContextMenu
        isOpen={menuOpen}
        position={menuPosition}
        onAction={handleAction}
        onDismiss={closeContextMenu}
      />

      {/* Toast for Quick Action confirmation (REQ-F-6) */}
      <Toast
        isVisible={toastVisible}
        variant={toastVariant}
        message={toastMessage}
        onDismiss={() => setToastVisible(false)}
      />
    </div>
  );
}

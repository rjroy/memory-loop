/**
 * MemoryEditor Component
 *
 * Editor for the memory.md file used by Claude for context injection.
 * Features:
 * - Textarea for editing content
 * - Size indicator showing current/max bytes
 * - Save button with loading state
 * - Error handling and display
 *
 * Spec Requirements:
 * - REQ-F-12: View memory.md
 * - REQ-F-13: Edit memory.md
 * - REQ-NF-1: Enforce 50KB memory file limit
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { ClientMessage, ServerMessage } from "@memory-loop/shared";
import {
  EditorContextMenu,
  getMenuPositionFromEvent,
  type MenuPosition,
  type QuickActionType,
} from "./EditorContextMenu";
import { useLongPress } from "../hooks/useLongPress";
import { useTextSelection, type SelectionContext } from "../hooks/useTextSelection";
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
}

/**
 * MemoryEditor Component
 *
 * Provides an interface for viewing and editing the memory.md file.
 * The content is loaded from the server on mount and can be saved back.
 */
export function MemoryEditor({
  sendMessage,
  lastMessage,
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

  // Ref to the textarea for selection tracking
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Track if we've requested the content
  const hasRequestedRef = useRef(false);

  // Track text selection
  const { selection } = useTextSelection(textareaRef, content);

  // Store selection context for use in action handler
  const selectionRef = useRef<SelectionContext | null>(null);
  selectionRef.current = selection;

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
      setError(lastMessage.message);
    }
  }, [lastMessage]);

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

      // Log the action with selection context (WebSocket dispatch comes in TASK-008)
      console.log("Quick Action triggered:", {
        action,
        selection: currentSelection,
      });

      closeContextMenu();
    },
    [closeContextMenu]
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
      <div className="memory-editor__content">
        {isLoading ? (
          <div className="memory-editor__loading">
            <div className="memory-editor__spinner" />
            <span>Loading memory file...</span>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="memory-editor__textarea"
            value={content}
            onChange={handleChange}
            onContextMenu={handleContextMenu}
            {...longPressHandlers}
            placeholder="# Memory&#10;&#10;Add facts about yourself that Claude should remember..."
            spellCheck={false}
          />
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
    </div>
  );
}

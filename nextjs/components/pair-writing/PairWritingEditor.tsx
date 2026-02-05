/**
 * PairWritingEditor Component
 *
 * Editor for Pair Writing Mode that supports Quick Actions (text transformation)
 * and Advisory Actions (conversation-based feedback) via context menu.
 *
 * Unlike MemoryEditor, this component receives content via props rather than
 * fetching a specific file, making it suitable for editing any vault file.
 *
 * Optionally supports vi mode editing (when viModeEnabled prop is true and
 * a physical keyboard is detected). Vi mode provides vim-style navigation
 * and commands for power users.
 *
 * @see .lore/specs/vi-mode-pair-writing.md
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  EditorContextMenu,
  getMenuPositionFromEvent,
  type MenuPosition,
  type QuickActionType,
  type AdvisoryActionType,
} from "../shared/EditorContextMenu";
import {
  useTextSelection,
  type SelectionContext,
} from "../../hooks/useTextSelection";
import { useHasKeyboard } from "../../hooks/useHasKeyboard";
import { useViMode } from "../../hooks/useViMode";
import { useViCursor } from "../../hooks/useViCursor";
import { ViCursor } from "./ViCursor";
import { ViModeIndicator } from "./ViModeIndicator";
import { ViCommandLine } from "./ViCommandLine";
import "./PairWritingEditor.css";
import "./vi-mode.css";

export interface PairWritingEditorProps {
  initialContent: string;
  filePath: string;
  onContentChange?: (content: string) => void;
  onQuickActionComplete?: (path: string) => void;
  onAdvisoryAction?: (
    action: AdvisoryActionType,
    selection: SelectionContext
  ) => void;
  onQuickAction?: (
    action: QuickActionType,
    selection: SelectionContext
  ) => void;
  /** Called when text selection changes (null when no selection) */
  onSelectionChange?: (selection: SelectionContext | null) => void;
  hasSnapshot?: boolean;
  snapshotContent?: string;
  /** Dependency injection for testing */
  ContextMenuComponent?: typeof EditorContextMenu;
  /** Increment this to trigger opening the context menu (for toolbar Actions button) */
  openMenuTrigger?: number;
  /** Whether vi mode is enabled for this vault (from vault config) */
  viModeEnabled?: boolean;
  /** Called when vi mode :w or :wq command is executed */
  onSave?: () => void;
  /** Called when vi mode :q! or :wq command is executed */
  onExit?: () => void;
  /** Called when vi mode :q command is executed with unsaved changes */
  onQuitWithUnsaved?: () => void;
}

export function PairWritingEditor({
  initialContent,
  filePath,
  onContentChange,
  onAdvisoryAction,
  onQuickAction,
  onSelectionChange,
  hasSnapshot = false,
  ContextMenuComponent = EditorContextMenu,
  openMenuTrigger = 0,
  viModeEnabled = false,
  onSave,
  onExit,
  onQuitWithUnsaved,
}: PairWritingEditorProps): React.ReactNode {
  const [content, setContent] = useState(initialContent);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [isProcessingQuickAction, setIsProcessingQuickAction] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-focus textarea on mount so user can start typing immediately
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const { selection } = useTextSelection(textareaRef, content);

  // Vi mode integration
  // Only enable vi mode if the vault has it enabled AND a keyboard is detected
  const hasKeyboard = useHasKeyboard();
  const viEnabled = viModeEnabled && hasKeyboard;

  // Track cursor position for vi mode overlay
  const [cursorPosition, setCursorPosition] = useState(0);

  // Handle content changes from vi mode commands
  const handleViContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      onContentChange?.(newContent);
    },
    [onContentChange]
  );

  // Vi mode hook provides mode state, key handler, and command buffer
  const {
    mode: viMode,
    handleKeyDown: viHandleKeyDown,
    commandBuffer,
  } = useViMode({
    enabled: viEnabled,
    textareaRef,
    onSave,
    onExit,
    onQuitWithUnsaved,
    onContentChange: handleViContentChange,
  });

  // Vi cursor hook provides cursor overlay positioning
  const { cursorStyle, showOverlay } = useViCursor({
    textareaRef,
    cursorPosition,
    mode: viMode,
    enabled: viEnabled,
  });

  // Update cursor position when textarea selection changes
  const handleSelect = useCallback(() => {
    if (textareaRef.current) {
      setCursorPosition(textareaRef.current.selectionStart);
    }
  }, []);

  // Notify parent when selection changes
  useEffect(() => {
    onSelectionChange?.(selection);
  }, [selection, onSelectionChange]);

  // Track previous trigger value to detect changes
  const prevTriggerRef = useRef(openMenuTrigger);

  // Open context menu when triggered externally (from toolbar Actions button)
  useEffect(() => {
    if (openMenuTrigger > 0 && openMenuTrigger !== prevTriggerRef.current) {
      prevTriggerRef.current = openMenuTrigger;
      if (selectionRef.current && textareaRef.current) {
        // Position menu near top-left of textarea (accessible on mobile)
        const rect = textareaRef.current.getBoundingClientRect();
        setMenuPosition({ x: rect.left + 16, y: rect.top + 16 });
        setMenuOpen(true);
      }
    }
  }, [openMenuTrigger]);

  // Refs for stable callback access to current values
  const selectionRef = useRef<SelectionContext | null>(null);
  selectionRef.current = selection;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  // Sync content when initialContent changes (e.g., after Quick Action reload)
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setContent(newContent);
      onContentChange?.(newContent);
      // Update cursor position for vi mode overlay
      setCursorPosition(e.target.selectionStart);
    },
    [onContentChange]
  );

  // Handle keydown: pass through vi mode handler when enabled
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      viHandleKeyDown(e);
      // Update cursor position after key processing
      // Use requestAnimationFrame to ensure we get the updated position
      // after the key event is processed
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          setCursorPosition(textareaRef.current.selectionStart);
        }
      });
    },
    [viHandleKeyDown]
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

  const handleQuickAction = useCallback(
    (action: QuickActionType) => {
      const currentSelection = selectionRef.current;
      closeContextMenu();
      if (!currentSelection) return;

      setIsProcessingQuickAction(true);

      // Delegate to parent to handle quick action via SSE chat
      onQuickAction?.(action, currentSelection);
    },
    [closeContextMenu, onQuickAction]
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

  // Vi mode adds classes to hide native caret when in normal/command mode
  const viModeClass = viEnabled && viMode === "normal" ? " pair-writing-editor__textarea--vi-normal" : "";
  const viCommandClass = viEnabled && viMode === "command" ? " pair-writing-editor__textarea--vi-command" : "";

  return (
    <div className={`pair-writing-editor${processingClass}`}>
      <textarea
        ref={textareaRef}
        className={`pair-writing-editor__textarea${textareaProcessingClass}${viModeClass}${viCommandClass}`}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onContextMenu={handleContextMenu}
        spellCheck={false}
        disabled={isProcessingQuickAction}
        aria-label="Document editor"
      />

      {/* Vi mode cursor overlay - shown in normal/command mode */}
      <ViCursor style={cursorStyle} visible={showOverlay} />

      {/* Vi mode indicator - shows current mode at bottom of editor */}
      <ViModeIndicator
        mode={viMode}
        visible={viEnabled}
        commandBuffer={commandBuffer}
      />

      {/* Vi command line - shown when in command mode for ex commands */}
      {/* Hidden during quick action processing to prevent interference */}
      <ViCommandLine
        visible={viEnabled && viMode === "command" && !isProcessingQuickAction}
        value={commandBuffer}
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
    </div>
  );
}

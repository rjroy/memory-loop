/**
 * useViMode Hook - Vi Mode State Machine
 *
 * Implements core vi mode state management for the Pair Writing Editor.
 * Handles mode transitions between normal, insert, and command modes,
 * cursor movement commands, insert mode entry with cursor positioning,
 * internal undo stack for the `u` command, delete commands, yank/put,
 * numeric prefixes for command repetition, and ex command execution.
 *
 * @see .lore/plans/vi-mode-pair-writing.md (TD-1, TD-4, TD-6, TD-8, TD-9)
 * @see REQ-7, REQ-8: Movement commands (h, j, k, l, 0, $)
 * @see REQ-9: Insert mode entry commands (i, a, A, o, O)
 * @see REQ-10: Delete commands (x, dd)
 * @see REQ-11: Yank/put commands (yy, p, P)
 * @see REQ-12: Undo: u undoes last edit operation
 * @see REQ-13: Numeric prefixes (e.g., 5j, 3dd, 2x)
 * @see REQ-15, REQ-16, REQ-17, REQ-18: Ex commands (:w, :wq, :q, :q!)
 */

import { useState, useCallback } from "react";

export type ViMode = "normal" | "insert" | "command";

/**
 * Snapshot of editor state for undo functionality.
 * Captures both content and cursor position to restore both on undo.
 */
export interface UndoState {
  content: string;
  cursorPosition: number;
}

/** Maximum number of undo entries to keep. Prevents unbounded memory growth. */
const MAX_UNDO_STACK_SIZE = 100;

export interface UseViModeOptions {
  enabled: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onSave?: () => void;
  onExit?: () => void;
  onQuitWithUnsaved?: () => void;
  onContentChange?: (content: string) => void;
}

export interface UseViModeResult {
  mode: ViMode;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  commandBuffer: string;
  pendingCount: number | null;
  pendingOperator: "d" | "y" | null;
  clipboard: string | null;
  /** Current undo stack depth (for debugging/testing) */
  undoStackSize: number;
  /** Push current state to undo stack (exposed for external edit operations) */
  pushUndoState: () => void;
}

/**
 * Keys that transition from normal mode to insert mode.
 * Each key positions the cursor differently before entering insert mode:
 * - i: Insert at current cursor position
 * - a: Insert after cursor (append)
 * - A: Insert at end of line
 * - o: Open new line below
 * - O: Open new line above
 */
const INSERT_MODE_KEYS = new Set(["i", "a", "A", "o", "O"]);

/**
 * Movement command keys handled in normal mode.
 */
const MOVEMENT_KEYS = new Set(["h", "j", "k", "l", "0", "$"]);

/**
 * Information about the current line at a given cursor position.
 */
export interface LineInfo {
  /** Zero-based line number */
  lineNumber: number;
  /** Index of the first character of this line in the text */
  lineStart: number;
  /** Index of the last character of this line (before newline or end of text) */
  lineEnd: number;
  /** Current column position within the line */
  column: number;
}

/**
 * Get information about the line at the given cursor position.
 *
 * @param text - The full text content
 * @param position - The cursor position (index into text)
 * @returns Information about the current line
 */
export function getLineInfo(text: string, position: number): LineInfo {
  // Find line boundaries by scanning for newlines
  let lineStart = 0;
  let lineNumber = 0;

  // Find the start of the current line
  for (let i = 0; i < position; i++) {
    if (text[i] === "\n") {
      lineStart = i + 1;
      lineNumber++;
    }
  }

  // Find the end of the current line
  let lineEnd = text.indexOf("\n", lineStart);
  if (lineEnd === -1) {
    lineEnd = text.length;
  }

  const column = position - lineStart;

  return { lineNumber, lineStart, lineEnd, column };
}

/**
 * Count the total number of lines in the text.
 *
 * @param text - The full text content
 * @returns The number of lines (minimum 1)
 */
export function getLineCount(text: string): number {
  if (text.length === 0) return 1;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return count;
}

/**
 * Get the start and end positions of a specific line.
 *
 * @param text - The full text content
 * @param lineNumber - Zero-based line number
 * @returns Object with lineStart and lineEnd, or null if line doesn't exist
 */
export function getLinePositions(
  text: string,
  lineNumber: number
): { lineStart: number; lineEnd: number } | null {
  let currentLine = 0;
  let lineStart = 0;

  for (let i = 0; i <= text.length; i++) {
    if (currentLine === lineNumber) {
      // Found the target line, now find its end
      let lineEnd = text.indexOf("\n", lineStart);
      if (lineEnd === -1) {
        lineEnd = text.length;
      }
      return { lineStart, lineEnd };
    }
    if (i < text.length && text[i] === "\n") {
      currentLine++;
      lineStart = i + 1;
    }
  }

  return null;
}

/**
 * Move the cursor to a new position, collapsing any selection.
 *
 * @param textarea - The textarea element
 * @param newPosition - The new cursor position
 */
export function moveCursor(
  textarea: HTMLTextAreaElement,
  newPosition: number
): void {
  const clamped = Math.max(0, Math.min(newPosition, textarea.value.length));
  textarea.selectionStart = clamped;
  textarea.selectionEnd = clamped;
}

export function useViMode(options: UseViModeOptions): UseViModeResult {
  const { enabled, textareaRef, onContentChange, onSave, onExit, onQuitWithUnsaved } = options;

  const [mode, setMode] = useState<ViMode>("normal");
  const [commandBuffer, setCommandBuffer] = useState("");

  // Pending operator for multi-key commands like 'dd', 'yy'
  // Using state so changes trigger re-renders and can be observed by tests
  const [pendingOperator, setPendingOperator] = useState<"d" | "y" | null>(
    null
  );

  // Pending count for numeric prefixes (e.g., 5j, 3dd)
  // Using state so changes trigger re-renders and can be observed by tests
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  // Internal clipboard for yank/put operations (REQ-20, REQ-21)
  // Using state so clipboard is observable in tests and persists within session
  const [clipboard, setClipboard] = useState<string | null>(null);

  // Undo stack: stores snapshots of content + cursor position
  // Using state instead of ref so that undoStackSize triggers re-renders
  const [undoStack, setUndoStack] = useState<UndoState[]>([]);

  /**
   * Push current editor state to undo stack.
   * Called before any edit operation to enable undoing.
   * Stack is capped at MAX_UNDO_STACK_SIZE to prevent memory issues.
   */
  const pushUndoState = useCallback(() => {
    const textarea = textareaRef?.current;
    if (!textarea) return;

    const state: UndoState = {
      content: textarea.value,
      cursorPosition: textarea.selectionStart,
    };

    setUndoStack((prev) => {
      const newStack = [...prev, state];
      // Enforce stack size limit by removing oldest entries
      if (newStack.length > MAX_UNDO_STACK_SIZE) {
        return newStack.slice(-MAX_UNDO_STACK_SIZE);
      }
      return newStack;
    });
  }, [textareaRef]);

  /**
   * Pop and restore the most recent undo state.
   * Does nothing if stack is empty or textarea is unavailable.
   */
  const popUndoState = useCallback((): void => {
    const textarea = textareaRef?.current;
    if (!textarea) return;

    setUndoStack((prev) => {
      if (prev.length === 0) return prev;

      const newStack = prev.slice(0, -1);
      const state = prev[prev.length - 1];

      textarea.value = state.content;
      moveCursor(textarea, state.cursorPosition);
      onContentChange?.(state.content);

      return newStack;
    });
  }, [textareaRef, onContentChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // When disabled, do nothing and let all keys through naturally
      if (!enabled) {
        return;
      }

      const { key } = e;
      const textarea = textareaRef?.current ?? null;

      switch (mode) {
        case "normal":
          handleNormalModeKey(
            e,
            key,
            setMode,
            setCommandBuffer,
            textarea,
            onContentChange,
            pushUndoState,
            popUndoState,
            pendingOperator,
            setPendingOperator,
            clipboard,
            setClipboard,
            pendingCount,
            setPendingCount
          );
          break;

        case "insert":
          handleInsertModeKey(e, key, setMode);
          break;

        case "command":
          handleCommandModeKey(e, key, setMode, commandBuffer, setCommandBuffer, {
            onSave,
            onExit,
            onQuitWithUnsaved,
          });
          break;
      }
    },
    [
      enabled,
      mode,
      textareaRef,
      onContentChange,
      pushUndoState,
      popUndoState,
      pendingOperator,
      clipboard,
      pendingCount,
      commandBuffer,
      onSave,
      onExit,
      onQuitWithUnsaved,
    ]
  );

  return {
    mode,
    handleKeyDown,
    commandBuffer,
    pendingCount,
    pendingOperator,
    clipboard,
    undoStackSize: undoStack.length,
    pushUndoState,
  };
}

/**
 * Handle keystrokes in normal mode.
 * In normal mode, we intercept all keys and prevent default to stop character insertion.
 */
function handleNormalModeKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  key: string,
  setMode: React.Dispatch<React.SetStateAction<ViMode>>,
  setCommandBuffer: React.Dispatch<React.SetStateAction<string>>,
  textarea: HTMLTextAreaElement | null,
  onContentChange?: (content: string) => void,
  pushUndoState?: () => void,
  popUndoState?: () => void,
  pendingOperator?: "d" | "y" | null,
  setPendingOperator?: React.Dispatch<React.SetStateAction<"d" | "y" | null>>,
  clipboard?: string | null,
  setClipboard?: React.Dispatch<React.SetStateAction<string | null>>,
  pendingCount?: number | null,
  setPendingCount?: React.Dispatch<React.SetStateAction<number | null>>
): void {
  // Handle digit accumulation for numeric prefixes (e.g., 5j, 10dd)
  // Digits 1-9 start a count; digit 0 extends when count pending (otherwise line start)
  if (/[1-9]/.test(key) && pendingCount === null) {
    e.preventDefault();
    setPendingCount?.(parseInt(key));
    return;
  }
  if (/[0-9]/.test(key) && pendingCount != null) {
    e.preventDefault();
    setPendingCount?.(pendingCount * 10 + parseInt(key));
    return;
  }

  // Get the effective count for this command (default to 1)
  const count = pendingCount ?? 1;

  // Helper to clear pending count after command execution
  const clearPendingCount = () => setPendingCount?.(null);
  // Handle 'd' key for delete operations (dd to delete line)
  if (key === "d" && textarea) {
    e.preventDefault();
    if (pendingOperator === "d") {
      // Second 'd' pressed - execute dd (delete line) with count
      setPendingOperator?.(null);
      clearPendingCount();
      executeDeleteLine(textarea, onContentChange, pushUndoState, count);
    } else {
      // First 'd' pressed - set pending operator
      setPendingOperator?.("d");
    }
    return;
  }

  // Handle 'y' key for yank operations (yy to yank line)
  if (key === "y" && textarea) {
    e.preventDefault();
    if (pendingOperator === "y") {
      // Second 'y' pressed - execute yy (yank line) with count
      setPendingOperator?.(null);
      clearPendingCount();
      executeYankLine(textarea, setClipboard, count);
    } else {
      // First 'y' pressed - set pending operator
      setPendingOperator?.("y");
    }
    return;
  }

  // Handle 'p' key for paste after current line
  if (key === "p" && textarea) {
    e.preventDefault();
    clearPendingCount();
    executePasteAfter(textarea, clipboard, onContentChange, pushUndoState);
    return;
  }

  // Handle 'P' key for paste before current line
  if (key === "P" && textarea) {
    e.preventDefault();
    clearPendingCount();
    executePasteBefore(textarea, clipboard, onContentChange, pushUndoState);
    return;
  }

  // Any other key clears the pending operator (unless it's a modifier key)
  // Note: pending count is cleared when commands execute, not here
  if (setPendingOperator && key.length === 1 && key !== "d" && key !== "y") {
    setPendingOperator(null);
  }

  // Transition to insert mode with cursor positioning
  if (INSERT_MODE_KEYS.has(key)) {
    e.preventDefault();
    clearPendingCount();
    if (textarea) {
      // Snapshot state before entering insert mode.
      // This batches all insert mode changes into a single undo entry.
      pushUndoState?.();
      executeInsertModeEntry(key, textarea, onContentChange);
    }
    setMode("insert");
    return;
  }

  // Transition to command mode
  if (key === ":") {
    e.preventDefault();
    clearPendingCount();
    setMode("command");
    setCommandBuffer("");
    return;
  }

  // Handle movement commands if we have a textarea
  if (MOVEMENT_KEYS.has(key) && textarea) {
    e.preventDefault();
    clearPendingCount();
    executeMovementCommand(key, textarea, count);
    return;
  }

  // Handle undo command
  if (key === "u") {
    e.preventDefault();
    clearPendingCount();
    popUndoState?.();
    return;
  }

  // Handle Escape in normal mode: cancel pending operator and count
  // This provides a way to cancel partially-entered commands like "d" waiting for second key
  if (key === "Escape") {
    e.preventDefault();
    setPendingOperator?.(null);
    setPendingCount?.(null);
    return;
  }

  // Handle delete character command (x)
  if (key === "x" && textarea) {
    e.preventDefault();
    clearPendingCount();
    executeDeleteCharacter(textarea, onContentChange, pushUndoState, count);
    return;
  }

  // In normal mode, prevent default for all single-character keys to stop insertion
  // Allow modifier keys and navigation keys to work naturally
  if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
  }
}

/**
 * Execute a movement command on the textarea.
 *
 * @param key - The movement key pressed
 * @param textarea - The textarea element to manipulate
 * @param count - Number of times to repeat the movement (default 1)
 */
function executeMovementCommand(
  key: string,
  textarea: HTMLTextAreaElement,
  count: number = 1
): void {
  const text = textarea.value;

  switch (key) {
    case "h": {
      // Move left count characters, clamp at 0
      const pos = textarea.selectionStart;
      moveCursor(textarea, pos - count);
      break;
    }
    case "l": {
      // Move right count characters, clamp at end
      const pos = textarea.selectionStart;
      moveCursor(textarea, pos + count);
      break;
    }
    case "j": {
      // Move down count lines, trying to maintain column position
      for (let i = 0; i < count; i++) {
        const pos = textarea.selectionStart;
        const currentLine = getLineInfo(text, pos);
        const totalLines = getLineCount(text);

        // If already on the last line, stop
        if (currentLine.lineNumber >= totalLines - 1) {
          break;
        }

        const nextLinePositions = getLinePositions(
          text,
          currentLine.lineNumber + 1
        );
        if (!nextLinePositions) break;

        // Try to maintain column position, but clamp to next line's length
        const nextLineLength =
          nextLinePositions.lineEnd - nextLinePositions.lineStart;
        const targetColumn = Math.min(currentLine.column, nextLineLength);
        moveCursor(textarea, nextLinePositions.lineStart + targetColumn);
      }
      break;
    }
    case "k": {
      // Move up count lines, trying to maintain column position
      for (let i = 0; i < count; i++) {
        const pos = textarea.selectionStart;
        const currentLine = getLineInfo(text, pos);

        // If already on the first line, stop
        if (currentLine.lineNumber === 0) {
          break;
        }

        const prevLinePositions = getLinePositions(
          text,
          currentLine.lineNumber - 1
        );
        if (!prevLinePositions) break;

        // Try to maintain column position, but clamp to previous line's length
        const prevLineLength =
          prevLinePositions.lineEnd - prevLinePositions.lineStart;
        const targetColumn = Math.min(currentLine.column, prevLineLength);
        moveCursor(textarea, prevLinePositions.lineStart + targetColumn);
      }
      break;
    }
    case "0": {
      // Move to start of current line (count is ignored for 0)
      const pos = textarea.selectionStart;
      const currentLine = getLineInfo(text, pos);
      moveCursor(textarea, currentLine.lineStart);
      break;
    }
    case "$": {
      // Move to end of current line (count is ignored for $)
      const pos = textarea.selectionStart;
      const currentLine = getLineInfo(text, pos);
      moveCursor(textarea, currentLine.lineEnd);
      break;
    }
  }
}

/**
 * Execute the 'x' command: delete characters at the cursor position.
 *
 * In vim, 'x' deletes the character under the cursor. With a count (e.g., 5x),
 * it deletes count characters. If the cursor is at the end of a line (past
 * the last character) or on an empty line, nothing happens. After deletion,
 * the cursor stays at the same position, or moves left if it would be past
 * the end of the text.
 *
 * @param textarea - The textarea element to manipulate
 * @param onContentChange - Optional callback for content changes
 * @param pushUndoState - Optional callback to push undo state before editing
 * @param count - Number of characters to delete (default 1)
 */
function executeDeleteCharacter(
  textarea: HTMLTextAreaElement,
  onContentChange?: (content: string) => void,
  pushUndoState?: () => void,
  count: number = 1
): void {
  const text = textarea.value;
  const pos = textarea.selectionStart;

  // Nothing to delete if at end of text or text is empty
  if (pos >= text.length || text.length === 0) {
    return;
  }

  // Push undo state before making changes
  pushUndoState?.();

  // Delete count characters at cursor position, clamped to available text
  const deleteCount = Math.min(count, text.length - pos);
  const newText = text.slice(0, pos) + text.slice(pos + deleteCount);
  textarea.value = newText;

  // Keep cursor at same position, but clamp if needed
  moveCursor(textarea, Math.min(pos, newText.length));

  // Notify parent of content change
  onContentChange?.(newText);
}

/**
 * Execute the 'dd' command: delete lines starting from the current line.
 *
 * Behavior:
 * - Deletes count lines starting from the cursor's line, including trailing newlines
 * - If count exceeds available lines, deletes all remaining lines
 * - If deleting all lines, leaves an empty document
 * - Cursor moves to the start of the next remaining line, or previous line if at end
 *
 * @param textarea - The textarea element to manipulate
 * @param onContentChange - Optional callback for content changes
 * @param pushUndoState - Optional callback to push undo state before editing
 * @param count - Number of lines to delete (default 1)
 */
function executeDeleteLine(
  textarea: HTMLTextAreaElement,
  onContentChange?: (content: string) => void,
  pushUndoState?: () => void,
  count: number = 1
): void {
  const text = textarea.value;
  const pos = textarea.selectionStart;

  // Empty document - nothing to delete
  if (text.length === 0) {
    return;
  }

  // Push undo state before making changes
  pushUndoState?.();

  const lineInfo = getLineInfo(text, pos);
  const totalLines = getLineCount(text);

  // Clamp count to available lines from current position
  const linesToDelete = Math.min(count, totalLines - lineInfo.lineNumber);

  // Calculate the end line (exclusive)
  const endLineNumber = lineInfo.lineNumber + linesToDelete;

  let deleteStart: number;
  let deleteEnd: number;
  let newCursorPos: number;

  if (linesToDelete >= totalLines) {
    // Deleting all lines - leave empty document
    deleteStart = 0;
    deleteEnd = text.length;
    newCursorPos = 0;
  } else if (endLineNumber >= totalLines) {
    // Deleting to end of document - need to delete preceding newline
    deleteStart = lineInfo.lineStart - (lineInfo.lineNumber > 0 ? 1 : 0);
    deleteEnd = text.length;
    // Cursor goes to start of what was the previous line
    if (lineInfo.lineNumber > 0) {
      const prevLinePositions = getLinePositions(text, lineInfo.lineNumber - 1);
      newCursorPos = prevLinePositions ? prevLinePositions.lineStart : 0;
    } else {
      newCursorPos = 0;
    }
  } else {
    // Deleting from middle - include trailing newline of last deleted line
    deleteStart = lineInfo.lineStart;
    const lastDeletedLine = getLinePositions(text, endLineNumber - 1);
    deleteEnd = lastDeletedLine ? lastDeletedLine.lineEnd + 1 : text.length;
    // Cursor stays at the start of the "next" line (which moves up)
    newCursorPos = deleteStart;
  }

  const newText = text.slice(0, deleteStart) + text.slice(deleteEnd);
  textarea.value = newText;

  // Clamp cursor position to valid range
  moveCursor(textarea, Math.min(newCursorPos, newText.length));

  // Notify parent of content change
  onContentChange?.(newText);
}

/**
 * Execute the 'yy' command: yank (copy) lines starting from the current line.
 *
 * When yanking multiple lines, they are joined with newlines. The content is
 * stored WITHOUT a trailing newline; the newline is added during paste operations.
 * This matches vim behavior where yanking lines and pasting creates proper new lines.
 *
 * @param textarea - The textarea element to read from
 * @param setClipboard - State setter to store the yanked content
 * @param count - Number of lines to yank (default 1)
 */
function executeYankLine(
  textarea: HTMLTextAreaElement,
  setClipboard?: React.Dispatch<React.SetStateAction<string | null>>,
  count: number = 1
): void {
  const text = textarea.value;
  const pos = textarea.selectionStart;

  const lineInfo = getLineInfo(text, pos);
  const totalLines = getLineCount(text);

  // Clamp count to available lines from current position
  const linesToYank = Math.min(count, totalLines - lineInfo.lineNumber);

  // Collect lines
  const lines: string[] = [];
  for (let i = 0; i < linesToYank; i++) {
    const linePositions = getLinePositions(text, lineInfo.lineNumber + i);
    if (linePositions) {
      lines.push(text.slice(linePositions.lineStart, linePositions.lineEnd));
    }
  }

  // Join lines with newlines (vim behavior for multi-line yank)
  const yankedContent = lines.join("\n");

  // Store in clipboard
  setClipboard?.(yankedContent);
}

/**
 * Execute the 'p' command: paste clipboard content after the current line.
 *
 * Creates a new line below the current line and inserts the clipboard content.
 * Cursor is positioned at the start of the pasted line.
 * Does nothing if clipboard is empty.
 *
 * @param textarea - The textarea element to manipulate
 * @param clipboard - The current clipboard content
 * @param onContentChange - Optional callback for content changes
 * @param pushUndoState - Optional callback to push undo state before editing
 */
function executePasteAfter(
  textarea: HTMLTextAreaElement,
  clipboard: string | null | undefined,
  onContentChange?: (content: string) => void,
  pushUndoState?: () => void
): void {
  // Do nothing if clipboard is empty
  if (clipboard === null || clipboard === undefined) {
    return;
  }

  const text = textarea.value;
  const pos = textarea.selectionStart;

  // Push undo state before making changes
  pushUndoState?.();

  const lineInfo = getLineInfo(text, pos);

  // Insert newline + clipboard content after current line end
  const insertPos = lineInfo.lineEnd;
  const newText =
    text.slice(0, insertPos) + "\n" + clipboard + text.slice(insertPos);

  textarea.value = newText;

  // Position cursor at start of pasted line (after the newline)
  moveCursor(textarea, insertPos + 1);

  // Notify parent of content change
  onContentChange?.(newText);
}

/**
 * Execute the 'P' command: paste clipboard content before the current line.
 *
 * Creates a new line above the current line and inserts the clipboard content.
 * Cursor is positioned at the start of the pasted line.
 * Does nothing if clipboard is empty.
 *
 * @param textarea - The textarea element to manipulate
 * @param clipboard - The current clipboard content
 * @param onContentChange - Optional callback for content changes
 * @param pushUndoState - Optional callback to push undo state before editing
 */
function executePasteBefore(
  textarea: HTMLTextAreaElement,
  clipboard: string | null | undefined,
  onContentChange?: (content: string) => void,
  pushUndoState?: () => void
): void {
  // Do nothing if clipboard is empty
  if (clipboard === null || clipboard === undefined) {
    return;
  }

  const text = textarea.value;
  const pos = textarea.selectionStart;

  // Push undo state before making changes
  pushUndoState?.();

  const lineInfo = getLineInfo(text, pos);

  // Insert clipboard content + newline before current line start
  const insertPos = lineInfo.lineStart;
  const newText =
    text.slice(0, insertPos) + clipboard + "\n" + text.slice(insertPos);

  textarea.value = newText;

  // Position cursor at start of pasted line (at the insertion point)
  moveCursor(textarea, insertPos);

  // Notify parent of content change
  onContentChange?.(newText);
}

/**
 * Execute an insert mode entry command, positioning the cursor appropriately.
 *
 * Commands:
 * - `i`: Insert at current cursor position (no cursor movement needed)
 * - `a`: Insert after current cursor position (move right one character)
 * - `A`: Insert at end of current line
 * - `o`: Open new line below current line, position cursor there
 * - `O`: Open new line above current line, position cursor there
 *
 * @param key - The insert mode entry key pressed
 * @param textarea - The textarea element to manipulate
 * @param onContentChange - Optional callback for content changes (needed for o/O)
 */
function executeInsertModeEntry(
  key: string,
  textarea: HTMLTextAreaElement,
  onContentChange?: (content: string) => void
): void {
  const text = textarea.value;
  const pos = textarea.selectionStart;

  switch (key) {
    case "i": {
      // Insert at current position - no cursor movement needed
      // Cursor stays where it is
      break;
    }
    case "a": {
      // Insert after current position - move right one character
      // Clamp at end of text (can position at the very end for appending)
      const newPos = Math.min(pos + 1, text.length);
      moveCursor(textarea, newPos);
      break;
    }
    case "A": {
      // Insert at end of current line
      const currentLine = getLineInfo(text, pos);
      moveCursor(textarea, currentLine.lineEnd);
      break;
    }
    case "o": {
      // Open new line below current line
      const currentLine = getLineInfo(text, pos);
      // Insert newline at end of current line
      const insertPos = currentLine.lineEnd;
      const newText =
        text.slice(0, insertPos) + "\n" + text.slice(insertPos);
      textarea.value = newText;
      // Position cursor at start of new line (after the newline we just inserted)
      moveCursor(textarea, insertPos + 1);
      // Notify parent of content change
      onContentChange?.(newText);
      break;
    }
    case "O": {
      // Open new line above current line
      const currentLine = getLineInfo(text, pos);
      // Insert newline at start of current line
      const insertPos = currentLine.lineStart;
      const newText =
        text.slice(0, insertPos) + "\n" + text.slice(insertPos);
      textarea.value = newText;
      // Position cursor at the new blank line (which is now at lineStart)
      moveCursor(textarea, insertPos);
      // Notify parent of content change
      onContentChange?.(newText);
      break;
    }
  }
}

/**
 * Handle keystrokes in insert mode.
 * In insert mode, we only intercept Escape to return to normal mode.
 * All other keys pass through naturally for text editing.
 */
function handleInsertModeKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  key: string,
  setMode: React.Dispatch<React.SetStateAction<ViMode>>
): void {
  if (key === "Escape") {
    e.preventDefault();
    setMode("normal");
  }
  // All other keys pass through naturally
}

/**
 * Callbacks for ex command execution.
 */
interface ExCommandCallbacks {
  onSave?: () => void;
  onExit?: () => void;
  onQuitWithUnsaved?: () => void;
}

/**
 * Execute an ex command (commands entered after ':' in command mode).
 *
 * Supported commands:
 * - `:w` - Save file, remain in Pair Writing (REQ-15)
 * - `:wq` or `:x` - Save file and exit Pair Writing (REQ-16)
 * - `:q` - Exit if no unsaved changes; triggers confirmation if unsaved (REQ-17)
 * - `:q!` - Exit without saving, discarding changes (REQ-18)
 *
 * Unknown commands are silently ignored (no-op).
 *
 * @param command - The command string (without the leading ':')
 * @param callbacks - Callbacks for save/exit operations
 */
export function executeExCommand(
  command: string,
  callbacks: ExCommandCallbacks
): void {
  const { onSave, onExit, onQuitWithUnsaved } = callbacks;
  const trimmed = command.trim();

  switch (trimmed) {
    case "w":
      // :w - Save file, remain in Pair Writing
      onSave?.();
      break;

    case "wq":
    case "x":
      // :wq or :x - Save file and exit Pair Writing
      onSave?.();
      onExit?.();
      break;

    case "q":
      // :q - Exit if no unsaved changes; parent handles the check
      // We call onQuitWithUnsaved and let the parent decide whether to show
      // a confirmation dialog or exit directly based on unsaved state
      onQuitWithUnsaved?.();
      break;

    case "q!":
      // :q! - Exit without saving (force quit)
      onExit?.();
      break;

    default:
      // Unknown commands are silently ignored
      break;
  }
}

/**
 * Handle keystrokes in command mode.
 * Escape returns to normal mode.
 * Enter executes the command and returns to normal mode.
 * Other keys are captured in the command buffer.
 */
function handleCommandModeKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  key: string,
  setMode: React.Dispatch<React.SetStateAction<ViMode>>,
  commandBuffer: string,
  setCommandBuffer: React.Dispatch<React.SetStateAction<string>>,
  callbacks: ExCommandCallbacks
): void {
  // Escape or Ctrl+C aborts command mode (standard vi behavior)
  if (key === "Escape" || (e.ctrlKey && key === "c")) {
    e.preventDefault();
    setMode("normal");
    setCommandBuffer("");
    return;
  }

  if (key === "Enter") {
    e.preventDefault();
    // Execute the command before returning to normal mode
    executeExCommand(commandBuffer, callbacks);
    setMode("normal");
    setCommandBuffer("");
    return;
  }

  // Prevent default for all keys in command mode to avoid inserting into textarea
  if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    setCommandBuffer((prev) => prev + key);
  }

  // Handle backspace in command buffer
  if (key === "Backspace") {
    e.preventDefault();
    setCommandBuffer((prev) => prev.slice(0, -1));
  }
}

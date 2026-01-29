/**
 * useViMode Hook - Vi Mode State Machine
 *
 * Implements core vi mode state management for the Pair Writing Editor.
 * Handles mode transitions between normal, insert, and command modes,
 * cursor movement commands, and insert mode entry with cursor positioning.
 *
 * @see .lore/plans/vi-mode-pair-writing.md (TD-1, TD-4)
 * @see REQ-7, REQ-8: Movement commands (h, j, k, l, 0, $)
 * @see REQ-9: Insert mode entry commands (i, a, A, o, O)
 */

import { useState, useCallback, useRef } from "react";

export type ViMode = "normal" | "insert" | "command";

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
  const { enabled, textareaRef, onContentChange } = options;

  const [mode, setMode] = useState<ViMode>("normal");
  const [commandBuffer, setCommandBuffer] = useState("");

  // These will be used in later chunks for commands/operations
  const pendingCountRef = useRef<number | null>(null);
  const pendingOperatorRef = useRef<"d" | "y" | null>(null);
  const clipboardRef = useRef<string | null>(null);

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
            onContentChange
          );
          break;

        case "insert":
          handleInsertModeKey(e, key, setMode);
          break;

        case "command":
          handleCommandModeKey(e, key, setMode, setCommandBuffer);
          break;
      }
    },
    [enabled, mode, textareaRef, onContentChange]
  );

  return {
    mode,
    handleKeyDown,
    commandBuffer,
    pendingCount: pendingCountRef.current,
    pendingOperator: pendingOperatorRef.current,
    clipboard: clipboardRef.current,
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
  onContentChange?: (content: string) => void
): void {
  // Transition to insert mode with cursor positioning
  if (INSERT_MODE_KEYS.has(key)) {
    e.preventDefault();
    if (textarea) {
      executeInsertModeEntry(key, textarea, onContentChange);
    }
    setMode("insert");
    return;
  }

  // Transition to command mode
  if (key === ":") {
    e.preventDefault();
    setMode("command");
    setCommandBuffer("");
    return;
  }

  // Handle movement commands if we have a textarea
  if (MOVEMENT_KEYS.has(key) && textarea) {
    e.preventDefault();
    executeMovementCommand(key, textarea);
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
 */
function executeMovementCommand(
  key: string,
  textarea: HTMLTextAreaElement
): void {
  const text = textarea.value;
  const pos = textarea.selectionStart;

  switch (key) {
    case "h": {
      // Move left one character, clamp at 0
      moveCursor(textarea, pos - 1);
      break;
    }
    case "l": {
      // Move right one character, clamp at end
      moveCursor(textarea, pos + 1);
      break;
    }
    case "j": {
      // Move down one line, trying to maintain column position
      const currentLine = getLineInfo(text, pos);
      const totalLines = getLineCount(text);

      // If already on the last line, stay put
      if (currentLine.lineNumber >= totalLines - 1) {
        return;
      }

      const nextLinePositions = getLinePositions(
        text,
        currentLine.lineNumber + 1
      );
      if (!nextLinePositions) return;

      // Try to maintain column position, but clamp to next line's length
      const nextLineLength =
        nextLinePositions.lineEnd - nextLinePositions.lineStart;
      const targetColumn = Math.min(currentLine.column, nextLineLength);
      moveCursor(textarea, nextLinePositions.lineStart + targetColumn);
      break;
    }
    case "k": {
      // Move up one line, trying to maintain column position
      const currentLine = getLineInfo(text, pos);

      // If already on the first line, stay put
      if (currentLine.lineNumber === 0) {
        return;
      }

      const prevLinePositions = getLinePositions(
        text,
        currentLine.lineNumber - 1
      );
      if (!prevLinePositions) return;

      // Try to maintain column position, but clamp to previous line's length
      const prevLineLength =
        prevLinePositions.lineEnd - prevLinePositions.lineStart;
      const targetColumn = Math.min(currentLine.column, prevLineLength);
      moveCursor(textarea, prevLinePositions.lineStart + targetColumn);
      break;
    }
    case "0": {
      // Move to start of current line
      const currentLine = getLineInfo(text, pos);
      moveCursor(textarea, currentLine.lineStart);
      break;
    }
    case "$": {
      // Move to end of current line
      const currentLine = getLineInfo(text, pos);
      moveCursor(textarea, currentLine.lineEnd);
      break;
    }
  }
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
 * Handle keystrokes in command mode.
 * Escape returns to normal mode.
 * Enter will execute the command (implemented in later chunk).
 * Other keys are captured in the command buffer (implemented in later chunk).
 */
function handleCommandModeKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  key: string,
  setMode: React.Dispatch<React.SetStateAction<ViMode>>,
  setCommandBuffer: React.Dispatch<React.SetStateAction<string>>
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
    // Command execution will be added in a later chunk
    // For now, just return to normal mode
    setMode("normal");
    setCommandBuffer("");
    return;
  }

  // Prevent default for all keys in command mode to avoid inserting into textarea
  // Command buffer building will be implemented in a later chunk
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

/**
 * useViMode Hook - Vi Mode State Machine
 *
 * Implements core vi mode state management for the Pair Writing Editor.
 * Handles mode transitions between normal, insert, and command modes.
 *
 * This hook manages the state machine only. Actual cursor manipulation and
 * text operations are added in subsequent chunks.
 *
 * @see .lore/plans/vi-mode-pair-writing.md (TD-1, TD-4)
 */

import { useState, useCallback, useRef } from "react";

export type ViMode = "normal" | "insert" | "command";

export interface UseViModeOptions {
  enabled: boolean;
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
 * For now, all of these just change mode. Cursor positioning (a, A, o, O)
 * will be implemented in a later chunk.
 */
const INSERT_MODE_KEYS = new Set(["i", "a", "A", "o", "O"]);

export function useViMode(options: UseViModeOptions): UseViModeResult {
  const { enabled } = options;

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

      switch (mode) {
        case "normal":
          handleNormalModeKey(e, key, setMode, setCommandBuffer);
          break;

        case "insert":
          handleInsertModeKey(e, key, setMode);
          break;

        case "command":
          handleCommandModeKey(e, key, setMode, setCommandBuffer);
          break;
      }
    },
    [enabled, mode]
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
  setCommandBuffer: React.Dispatch<React.SetStateAction<string>>
): void {
  // Transition to insert mode
  if (INSERT_MODE_KEYS.has(key)) {
    e.preventDefault();
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

  // In normal mode, prevent default for all single-character keys to stop insertion
  // Allow modifier keys and navigation keys to work naturally
  if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
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
  if (key === "Escape") {
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

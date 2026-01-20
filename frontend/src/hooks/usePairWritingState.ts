/**
 * Pair Writing Mode State Hook
 *
 * Manages session-scoped state for Pair Writing Mode including:
 * - Editor content and unsaved changes tracking
 * - Manual snapshot for comparison
 * - Conversation history (session-scoped per REQ-F-27)
 * - Current text selection
 *
 * @see .sdd/plans/memory-loop/2026-01-20-pair-writing-mode-plan.md TD-5
 */

import { useReducer, useCallback } from "react";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/**
 * Text selection within the editor.
 */
export interface TextSelection {
  /** Selected text content */
  text: string;
  /** Start position (character offset) */
  start: number;
  /** End position (character offset) */
  end: number;
  /** 1-indexed start line number */
  startLine: number;
  /** 1-indexed end line number */
  endLine: number;
}

/**
 * Message in the pair writing conversation.
 * Simpler than SessionContext's ConversationMessage since advisory actions
 * don't need tool invocations.
 */
export interface PairWritingMessage {
  /** Unique message ID */
  id: string;
  /** Role: user or assistant */
  role: "user" | "assistant";
  /** Message content */
  content: string;
  /** Timestamp */
  timestamp: Date;
  /** Whether this message is still streaming */
  isStreaming?: boolean;
}

/**
 * Pair Writing Mode state.
 * Session-scoped: cleared when exiting Pair Writing Mode (REQ-F-27).
 */
export interface PairWritingState {
  /** Whether Pair Writing Mode is active */
  isActive: boolean;
  /** Current editor content */
  content: string;
  /** Manual snapshot for comparison (REQ-F-23, REQ-F-24) */
  snapshot: string | null;
  /** Conversation history (session-scoped per REQ-F-22) */
  conversation: PairWritingMessage[];
  /** Current text selection */
  selection: TextSelection | null;
  /** Whether there are unsaved manual edits (REQ-F-30) */
  hasUnsavedChanges: boolean;
}

/**
 * Actions returned by the hook for state management.
 */
export interface PairWritingActions {
  /** Activate Pair Writing Mode with initial content */
  activate: (content: string) => void;
  /** Deactivate Pair Writing Mode (clears all state per REQ-F-27) */
  deactivate: () => void;
  /** Update editor content */
  setContent: (content: string) => void;
  /** Take a snapshot of current content (REQ-F-23) */
  takeSnapshot: () => void;
  /** Clear the current snapshot */
  clearSnapshot: () => void;
  /** Add a message to conversation */
  addMessage: (message: Omit<PairWritingMessage, "id" | "timestamp">) => void;
  /** Update the last message (for streaming) */
  updateLastMessage: (content: string, isStreaming?: boolean) => void;
  /** Set the current text selection */
  setSelection: (selection: TextSelection | null) => void;
  /** Clear all state (alias for deactivate, used on exit) */
  clearAll: () => void;
  /** Mark changes as saved (resets hasUnsavedChanges) */
  markSaved: () => void;
  /** Reload content from disk (updates content, clears unsaved flag) */
  reloadContent: (content: string) => void;
}

// ----------------------------------------------------------------------------
// Reducer
// ----------------------------------------------------------------------------

type PairWritingAction =
  | { type: "ACTIVATE"; content: string }
  | { type: "DEACTIVATE" }
  | { type: "SET_CONTENT"; content: string }
  | { type: "TAKE_SNAPSHOT" }
  | { type: "CLEAR_SNAPSHOT" }
  | { type: "ADD_MESSAGE"; message: PairWritingMessage }
  | { type: "UPDATE_LAST_MESSAGE"; content: string; isStreaming?: boolean }
  | { type: "SET_SELECTION"; selection: TextSelection | null }
  | { type: "MARK_SAVED" }
  | { type: "RELOAD_CONTENT"; content: string };

/**
 * Generate a unique message ID.
 */
function generateMessageId(): string {
  return `pw-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Initial state for Pair Writing Mode.
 */
function createInitialState(): PairWritingState {
  return {
    isActive: false,
    content: "",
    snapshot: null,
    conversation: [],
    selection: null,
    hasUnsavedChanges: false,
  };
}

/**
 * Pair Writing state reducer.
 */
function pairWritingReducer(
  state: PairWritingState,
  action: PairWritingAction
): PairWritingState {
  switch (action.type) {
    case "ACTIVATE":
      return {
        ...createInitialState(),
        isActive: true,
        content: action.content,
      };

    case "DEACTIVATE":
      // Clear all state per REQ-F-27 (session-scoped)
      return createInitialState();

    case "SET_CONTENT":
      // Track unsaved changes when content differs from what was loaded
      return {
        ...state,
        content: action.content,
        hasUnsavedChanges: true,
      };

    case "TAKE_SNAPSHOT":
      // REQ-F-24: Only one snapshot at a time; new snapshot replaces previous
      return {
        ...state,
        snapshot: state.content,
      };

    case "CLEAR_SNAPSHOT":
      return {
        ...state,
        snapshot: null,
      };

    case "ADD_MESSAGE":
      return {
        ...state,
        conversation: [...state.conversation, action.message],
      };

    case "UPDATE_LAST_MESSAGE": {
      if (state.conversation.length === 0) return state;

      const messages = [...state.conversation];
      const lastMessage = messages[messages.length - 1];

      if (lastMessage.role !== "assistant") {
        console.warn(
          "[usePairWritingState] UPDATE_LAST_MESSAGE ignored: last message is not an assistant message"
        );
        return state;
      }

      messages[messages.length - 1] = {
        ...lastMessage,
        content: lastMessage.content + action.content,
        isStreaming: action.isStreaming ?? lastMessage.isStreaming,
      };

      return { ...state, conversation: messages };
    }

    case "SET_SELECTION":
      return {
        ...state,
        selection: action.selection,
      };

    case "MARK_SAVED":
      return {
        ...state,
        hasUnsavedChanges: false,
      };

    case "RELOAD_CONTENT":
      // Used after Quick Actions complete (file was written by Claude)
      // Updates content without marking as unsaved
      return {
        ...state,
        content: action.content,
        hasUnsavedChanges: false,
      };

    default:
      return state;
  }
}

// ----------------------------------------------------------------------------
// Hook
// ----------------------------------------------------------------------------

/**
 * Hook for managing Pair Writing Mode state.
 *
 * State is session-scoped: conversation and snapshot are cleared when
 * deactivating Pair Writing Mode (REQ-F-27).
 *
 * @example
 * ```tsx
 * const { state, actions } = usePairWritingState();
 *
 * // Enter Pair Writing Mode
 * actions.activate(fileContent);
 *
 * // Take a snapshot before editing
 * actions.takeSnapshot();
 *
 * // Update content as user types
 * actions.setContent(newContent);
 *
 * // Exit (clears conversation and snapshot)
 * actions.clearAll();
 * ```
 */
export function usePairWritingState(): {
  state: PairWritingState;
  actions: PairWritingActions;
} {
  const [state, dispatch] = useReducer(pairWritingReducer, undefined, createInitialState);

  const activate = useCallback((content: string) => {
    dispatch({ type: "ACTIVATE", content });
  }, []);

  const deactivate = useCallback(() => {
    dispatch({ type: "DEACTIVATE" });
  }, []);

  const setContent = useCallback((content: string) => {
    dispatch({ type: "SET_CONTENT", content });
  }, []);

  const takeSnapshot = useCallback(() => {
    dispatch({ type: "TAKE_SNAPSHOT" });
  }, []);

  const clearSnapshot = useCallback(() => {
    dispatch({ type: "CLEAR_SNAPSHOT" });
  }, []);

  const addMessage = useCallback(
    (message: Omit<PairWritingMessage, "id" | "timestamp">) => {
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          ...message,
          id: generateMessageId(),
          timestamp: new Date(),
        },
      });
    },
    []
  );

  const updateLastMessage = useCallback(
    (content: string, isStreaming?: boolean) => {
      dispatch({ type: "UPDATE_LAST_MESSAGE", content, isStreaming });
    },
    []
  );

  const setSelection = useCallback((selection: TextSelection | null) => {
    dispatch({ type: "SET_SELECTION", selection });
  }, []);

  const clearAll = useCallback(() => {
    dispatch({ type: "DEACTIVATE" });
  }, []);

  const markSaved = useCallback(() => {
    dispatch({ type: "MARK_SAVED" });
  }, []);

  const reloadContent = useCallback((content: string) => {
    dispatch({ type: "RELOAD_CONTENT", content });
  }, []);

  return {
    state,
    actions: {
      activate,
      deactivate,
      setContent,
      takeSnapshot,
      clearSnapshot,
      addMessage,
      updateLastMessage,
      setSelection,
      clearAll,
      markSaved,
      reloadContent,
    },
  };
}

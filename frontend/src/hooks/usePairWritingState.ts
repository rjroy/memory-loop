/**
 * Pair Writing Mode State Hook
 *
 * Manages session-scoped state for Pair Writing Mode including:
 * - Editor content and unsaved changes tracking
 * - Manual snapshot for comparison
 *
 * Conversation state is now managed by SessionContext and displayed by the
 * embedded Discussion component. This hook only tracks editor-specific state.
 *
 * @see .sdd/plans/memory-loop/2026-01-20-pair-writing-mode-plan.md TD-5
 */

import { useReducer, useCallback } from "react";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/**
 * Pair Writing Mode state.
 * Session-scoped: snapshot is cleared when exiting Pair Writing Mode (REQ-F-27).
 * Conversation state is now managed by SessionContext (shared with Discussion).
 */
export interface PairWritingState {
  /** Whether Pair Writing Mode is active */
  isActive: boolean;
  /** Current editor content */
  content: string;
  /** Manual snapshot for comparison (REQ-F-23, REQ-F-24) */
  snapshot: string | null;
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
  | { type: "MARK_SAVED" }
  | { type: "RELOAD_CONTENT"; content: string };

/**
 * Initial state for Pair Writing Mode.
 */
function createInitialState(): PairWritingState {
  return {
    isActive: false,
    content: "",
    snapshot: null,
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
 * State is session-scoped: snapshot is cleared when deactivating Pair Writing
 * Mode (REQ-F-27). Conversation state is now managed by SessionContext (shared
 * with the Discussion component).
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
 * // Exit (clears snapshot)
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
      clearAll,
      markSaved,
      reloadContent,
    },
  };
}

/**
 * Tests for usePairWritingState hook.
 *
 * Covers all state transitions and ensures session-scoped behavior (REQ-F-27).
 *
 * Conversation state is now managed by SessionContext (shared with Discussion),
 * so conversation-related tests have been removed from this file.
 */

import { describe, test, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { usePairWritingState } from "./usePairWritingState";

describe("usePairWritingState", () => {
  describe("initial state", () => {
    test("starts inactive with empty state", () => {
      const { result } = renderHook(() => usePairWritingState());

      expect(result.current.state).toEqual({
        isActive: false,
        content: "",
        snapshot: null,
        hasUnsavedChanges: false,
      });
    });
  });

  describe("activate", () => {
    test("sets isActive to true and initializes content", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("# Hello World");
      });

      expect(result.current.state.isActive).toBe(true);
      expect(result.current.state.content).toBe("# Hello World");
      expect(result.current.state.hasUnsavedChanges).toBe(false);
    });

    test("clears previous state when reactivating", () => {
      const { result } = renderHook(() => usePairWritingState());

      // Set up some state
      act(() => {
        result.current.actions.activate("initial content");
        result.current.actions.takeSnapshot("selected text");
        result.current.actions.setContent("modified content");
      });

      // Reactivate with new content
      act(() => {
        result.current.actions.activate("new content");
      });

      expect(result.current.state.content).toBe("new content");
      expect(result.current.state.snapshot).toBeNull();
      expect(result.current.state.hasUnsavedChanges).toBe(false);
    });
  });

  describe("deactivate", () => {
    test("clears all state (REQ-F-27: session-scoped)", () => {
      const { result } = renderHook(() => usePairWritingState());

      // Set up some state
      act(() => {
        result.current.actions.activate("content");
        result.current.actions.takeSnapshot("selected text");
        result.current.actions.setContent("modified");
      });

      // Deactivate
      act(() => {
        result.current.actions.deactivate();
      });

      expect(result.current.state).toEqual({
        isActive: false,
        content: "",
        snapshot: null,
        hasUnsavedChanges: false,
      });
    });
  });

  describe("setContent", () => {
    test("updates content and sets hasUnsavedChanges", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("initial");
      });

      expect(result.current.state.hasUnsavedChanges).toBe(false);

      act(() => {
        result.current.actions.setContent("modified");
      });

      expect(result.current.state.content).toBe("modified");
      expect(result.current.state.hasUnsavedChanges).toBe(true);
    });

    test("marks unsaved even if content is same (intentional simplicity)", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("same");
        result.current.actions.setContent("same");
      });

      // This is intentional: we don't track original content for comparison
      expect(result.current.state.hasUnsavedChanges).toBe(true);
    });
  });

  describe("takeSnapshot (REQ-F-23, REQ-F-24)", () => {
    test("captures selected text as snapshot (not entire file)", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("full document content here");
        result.current.actions.takeSnapshot("selected portion");
      });

      expect(result.current.state.snapshot).toBe("selected portion");
    });

    test("new snapshot replaces previous (REQ-F-24: only one at a time)", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("document content");
        result.current.actions.takeSnapshot("first selection");
      });

      expect(result.current.state.snapshot).toBe("first selection");

      act(() => {
        result.current.actions.takeSnapshot("second selection");
      });

      expect(result.current.state.snapshot).toBe("second selection");
    });
  });

  describe("clearSnapshot", () => {
    test("clears the snapshot", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.takeSnapshot("selected text");
      });

      expect(result.current.state.snapshot).toBe("selected text");

      act(() => {
        result.current.actions.clearSnapshot();
      });

      expect(result.current.state.snapshot).toBeNull();
    });
  });

  describe("clearAll", () => {
    test("is an alias for deactivate (REQ-F-27)", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.takeSnapshot("selected text");
        result.current.actions.setContent("modified");
      });

      act(() => {
        result.current.actions.clearAll();
      });

      expect(result.current.state.isActive).toBe(false);
      expect(result.current.state.content).toBe("");
      expect(result.current.state.snapshot).toBeNull();
      expect(result.current.state.hasUnsavedChanges).toBe(false);
    });
  });

  describe("markSaved", () => {
    test("clears hasUnsavedChanges flag", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("initial");
        result.current.actions.setContent("modified");
      });

      expect(result.current.state.hasUnsavedChanges).toBe(true);

      act(() => {
        result.current.actions.markSaved();
      });

      expect(result.current.state.hasUnsavedChanges).toBe(false);
    });
  });

  describe("reloadContent", () => {
    test("updates content without marking as unsaved", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("initial");
        result.current.actions.setContent("user edits");
      });

      expect(result.current.state.hasUnsavedChanges).toBe(true);

      // Simulate Quick Action completing and reloading file from disk
      act(() => {
        result.current.actions.reloadContent("claude edited this");
      });

      expect(result.current.state.content).toBe("claude edited this");
      expect(result.current.state.hasUnsavedChanges).toBe(false);
    });

    test("preserves snapshot", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("initial");
        result.current.actions.takeSnapshot("selected text");
      });

      act(() => {
        result.current.actions.reloadContent("reloaded");
      });

      expect(result.current.state.content).toBe("reloaded");
      expect(result.current.state.snapshot).toBe("selected text");
    });
  });

  describe("action reference stability", () => {
    test("actions are stable across re-renders", () => {
      const { result, rerender } = renderHook(() => usePairWritingState());

      const firstActions = result.current.actions;
      rerender();
      const secondActions = result.current.actions;

      // All action references should be stable (useCallback)
      expect(secondActions.activate).toBe(firstActions.activate);
      expect(secondActions.deactivate).toBe(firstActions.deactivate);
      expect(secondActions.setContent).toBe(firstActions.setContent);
      expect(secondActions.takeSnapshot).toBe(firstActions.takeSnapshot);
      expect(secondActions.clearSnapshot).toBe(firstActions.clearSnapshot);
      expect(secondActions.clearAll).toBe(firstActions.clearAll);
      expect(secondActions.markSaved).toBe(firstActions.markSaved);
      expect(secondActions.reloadContent).toBe(firstActions.reloadContent);
    });
  });

  describe("session-scoped behavior (REQ-F-27)", () => {
    test("snapshot is cleared on exit", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.takeSnapshot("selected text");
      });

      expect(result.current.state.snapshot).toBe("selected text");

      act(() => {
        result.current.actions.clearAll();
      });

      expect(result.current.state.snapshot).toBeNull();
    });
  });

  describe("typical workflow", () => {
    test("select-snapshot-edit-compare workflow", () => {
      const { result } = renderHook(() => usePairWritingState());

      // 1. Enter Pair Writing Mode with file content
      act(() => {
        result.current.actions.activate("# Original Title\n\nSome content here.");
      });

      expect(result.current.state.isActive).toBe(true);
      expect(result.current.state.hasUnsavedChanges).toBe(false);

      // 2. Select a section and take a snapshot of it
      act(() => {
        result.current.actions.takeSnapshot("Some content here.");
      });

      expect(result.current.state.snapshot).toBe("Some content here.");

      // 3. User edits the document (reworks the section)
      act(() => {
        result.current.actions.setContent("# Original Title\n\nRevised and improved content.");
      });

      expect(result.current.state.hasUnsavedChanges).toBe(true);

      // 4. User saves
      act(() => {
        result.current.actions.markSaved();
      });

      expect(result.current.state.hasUnsavedChanges).toBe(false);

      // 5. Exit clears session state
      act(() => {
        result.current.actions.clearAll();
      });

      expect(result.current.state.isActive).toBe(false);
      expect(result.current.state.snapshot).toBeNull();
    });
  });
});

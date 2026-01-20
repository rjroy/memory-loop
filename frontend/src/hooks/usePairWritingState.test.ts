/**
 * Tests for usePairWritingState hook.
 *
 * Covers all state transitions and ensures session-scoped behavior (REQ-F-27).
 */

import { describe, test, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { usePairWritingState, type TextSelection } from "./usePairWritingState";

describe("usePairWritingState", () => {
  describe("initial state", () => {
    test("starts inactive with empty state", () => {
      const { result } = renderHook(() => usePairWritingState());

      expect(result.current.state).toEqual({
        isActive: false,
        content: "",
        snapshot: null,
        conversation: [],
        selection: null,
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
        result.current.actions.takeSnapshot();
        result.current.actions.addMessage({ role: "user", content: "hello" });
        result.current.actions.setContent("modified content");
      });

      // Reactivate with new content
      act(() => {
        result.current.actions.activate("new content");
      });

      expect(result.current.state.content).toBe("new content");
      expect(result.current.state.snapshot).toBeNull();
      expect(result.current.state.conversation).toEqual([]);
      expect(result.current.state.hasUnsavedChanges).toBe(false);
    });
  });

  describe("deactivate", () => {
    test("clears all state (REQ-F-27: session-scoped)", () => {
      const { result } = renderHook(() => usePairWritingState());

      // Set up some state
      act(() => {
        result.current.actions.activate("content");
        result.current.actions.takeSnapshot();
        result.current.actions.addMessage({ role: "user", content: "hello" });
        result.current.actions.setSelection({
          text: "test",
          start: 0,
          end: 4,
          startLine: 1,
          endLine: 1,
        });
      });

      // Deactivate
      act(() => {
        result.current.actions.deactivate();
      });

      expect(result.current.state).toEqual({
        isActive: false,
        content: "",
        snapshot: null,
        conversation: [],
        selection: null,
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
    test("captures current content as snapshot", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("snapshot this");
        result.current.actions.takeSnapshot();
      });

      expect(result.current.state.snapshot).toBe("snapshot this");
    });

    test("new snapshot replaces previous (REQ-F-24: only one at a time)", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("first snapshot");
        result.current.actions.takeSnapshot();
      });

      expect(result.current.state.snapshot).toBe("first snapshot");

      act(() => {
        result.current.actions.setContent("second snapshot");
        result.current.actions.takeSnapshot();
      });

      expect(result.current.state.snapshot).toBe("second snapshot");
    });
  });

  describe("clearSnapshot", () => {
    test("clears the snapshot", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.takeSnapshot();
      });

      expect(result.current.state.snapshot).toBe("content");

      act(() => {
        result.current.actions.clearSnapshot();
      });

      expect(result.current.state.snapshot).toBeNull();
    });
  });

  describe("addMessage", () => {
    test("adds message with generated id and timestamp", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.addMessage({ role: "user", content: "hello" });
      });

      expect(result.current.state.conversation).toHaveLength(1);
      const msg = result.current.state.conversation[0];
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("hello");
      expect(msg.id).toMatch(/^pw-msg-/);
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    test("adds multiple messages in order", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.addMessage({ role: "user", content: "question" });
        result.current.actions.addMessage({
          role: "assistant",
          content: "answer",
          isStreaming: false,
        });
      });

      expect(result.current.state.conversation).toHaveLength(2);
      expect(result.current.state.conversation[0].content).toBe("question");
      expect(result.current.state.conversation[1].content).toBe("answer");
    });

    test("preserves isStreaming flag", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.addMessage({
          role: "assistant",
          content: "",
          isStreaming: true,
        });
      });

      expect(result.current.state.conversation[0].isStreaming).toBe(true);
    });
  });

  describe("updateLastMessage", () => {
    test("appends content to last assistant message", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.addMessage({
          role: "assistant",
          content: "Hello",
          isStreaming: true,
        });
      });

      act(() => {
        result.current.actions.updateLastMessage(" world");
      });

      expect(result.current.state.conversation[0].content).toBe("Hello world");
    });

    test("updates isStreaming flag when provided", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.addMessage({
          role: "assistant",
          content: "streaming",
          isStreaming: true,
        });
      });

      expect(result.current.state.conversation[0].isStreaming).toBe(true);

      act(() => {
        result.current.actions.updateLastMessage("", false);
      });

      expect(result.current.state.conversation[0].isStreaming).toBe(false);
    });

    test("preserves isStreaming when not provided", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.addMessage({
          role: "assistant",
          content: "",
          isStreaming: true,
        });
        result.current.actions.updateLastMessage("chunk");
      });

      expect(result.current.state.conversation[0].isStreaming).toBe(true);
    });

    test("ignores update if conversation is empty", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.updateLastMessage("orphan");
      });

      expect(result.current.state.conversation).toHaveLength(0);
    });

    test("ignores update if last message is not assistant", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.addMessage({ role: "user", content: "question" });
        result.current.actions.updateLastMessage(" extra");
      });

      // User message should be unchanged
      expect(result.current.state.conversation[0].content).toBe("question");
    });
  });

  describe("setSelection", () => {
    test("sets text selection", () => {
      const { result } = renderHook(() => usePairWritingState());

      const selection: TextSelection = {
        text: "selected text",
        start: 10,
        end: 23,
        startLine: 2,
        endLine: 2,
      };

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.setSelection(selection);
      });

      expect(result.current.state.selection).toEqual(selection);
    });

    test("clears selection when set to null", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.setSelection({
          text: "test",
          start: 0,
          end: 4,
          startLine: 1,
          endLine: 1,
        });
      });

      expect(result.current.state.selection).not.toBeNull();

      act(() => {
        result.current.actions.setSelection(null);
      });

      expect(result.current.state.selection).toBeNull();
    });
  });

  describe("clearAll", () => {
    test("is an alias for deactivate (REQ-F-27)", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.takeSnapshot();
        result.current.actions.addMessage({ role: "user", content: "msg" });
      });

      act(() => {
        result.current.actions.clearAll();
      });

      expect(result.current.state.isActive).toBe(false);
      expect(result.current.state.content).toBe("");
      expect(result.current.state.snapshot).toBeNull();
      expect(result.current.state.conversation).toEqual([]);
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

    test("preserves other state (snapshot, conversation, selection)", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("initial");
        result.current.actions.takeSnapshot();
        result.current.actions.addMessage({ role: "user", content: "msg" });
        result.current.actions.setSelection({
          text: "test",
          start: 0,
          end: 4,
          startLine: 1,
          endLine: 1,
        });
      });

      act(() => {
        result.current.actions.reloadContent("reloaded");
      });

      expect(result.current.state.content).toBe("reloaded");
      expect(result.current.state.snapshot).toBe("initial");
      expect(result.current.state.conversation).toHaveLength(1);
      expect(result.current.state.selection).not.toBeNull();
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
      expect(secondActions.addMessage).toBe(firstActions.addMessage);
      expect(secondActions.updateLastMessage).toBe(firstActions.updateLastMessage);
      expect(secondActions.setSelection).toBe(firstActions.setSelection);
      expect(secondActions.clearAll).toBe(firstActions.clearAll);
      expect(secondActions.markSaved).toBe(firstActions.markSaved);
      expect(secondActions.reloadContent).toBe(firstActions.reloadContent);
    });
  });

  describe("session-scoped behavior (REQ-F-27)", () => {
    test("conversation is cleared on exit", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.addMessage({ role: "user", content: "q1" });
        result.current.actions.addMessage({ role: "assistant", content: "a1" });
        result.current.actions.addMessage({ role: "user", content: "q2" });
      });

      expect(result.current.state.conversation).toHaveLength(3);

      // Exit Pair Writing Mode
      act(() => {
        result.current.actions.clearAll();
      });

      expect(result.current.state.conversation).toEqual([]);
    });

    test("snapshot is cleared on exit", () => {
      const { result } = renderHook(() => usePairWritingState());

      act(() => {
        result.current.actions.activate("content");
        result.current.actions.takeSnapshot();
      });

      expect(result.current.state.snapshot).toBe("content");

      act(() => {
        result.current.actions.clearAll();
      });

      expect(result.current.state.snapshot).toBeNull();
    });
  });

  describe("typical workflow", () => {
    test("edit-snapshot-compare workflow", () => {
      const { result } = renderHook(() => usePairWritingState());

      // 1. Enter Pair Writing Mode with file content
      act(() => {
        result.current.actions.activate("# Original Title\n\nSome content here.");
      });

      expect(result.current.state.isActive).toBe(true);
      expect(result.current.state.hasUnsavedChanges).toBe(false);

      // 2. Take a snapshot before making changes
      act(() => {
        result.current.actions.takeSnapshot();
      });

      expect(result.current.state.snapshot).toBe("# Original Title\n\nSome content here.");

      // 3. User edits the document
      act(() => {
        result.current.actions.setContent("# Better Title\n\nRevised content here.");
      });

      expect(result.current.state.hasUnsavedChanges).toBe(true);

      // 4. User selects text for comparison
      act(() => {
        result.current.actions.setSelection({
          text: "Better Title",
          start: 2,
          end: 14,
          startLine: 1,
          endLine: 1,
        });
      });

      // 5. User asks for comparison, conversation updates
      act(() => {
        result.current.actions.addMessage({
          role: "user",
          content: "Compare to snapshot",
        });
        result.current.actions.addMessage({
          role: "assistant",
          content: "",
          isStreaming: true,
        });
      });

      // 6. Stream in response
      act(() => {
        result.current.actions.updateLastMessage("The title changed from 'Original Title' to 'Better Title'.");
        result.current.actions.updateLastMessage("", false);
      });

      expect(result.current.state.conversation).toHaveLength(2);
      expect(result.current.state.conversation[1].content).toBe(
        "The title changed from 'Original Title' to 'Better Title'."
      );
      expect(result.current.state.conversation[1].isStreaming).toBe(false);

      // 7. User saves
      act(() => {
        result.current.actions.markSaved();
      });

      expect(result.current.state.hasUnsavedChanges).toBe(false);

      // 8. Exit clears session state
      act(() => {
        result.current.actions.clearAll();
      });

      expect(result.current.state.isActive).toBe(false);
      expect(result.current.state.conversation).toEqual([]);
      expect(result.current.state.snapshot).toBeNull();
    });
  });
});

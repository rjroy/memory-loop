/**
 * Note Capture Component
 *
 * Multiline textarea for capturing notes with auto-save to localStorage.
 * Submits via WebSocket and shows toast feedback.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSession } from "../contexts/SessionContext";
import { RecentActivity } from "./RecentActivity";
import "./NoteCapture.css";

const STORAGE_KEY = "memory-loop-draft";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

/**
 * Props for NoteCapture component.
 */
export interface NoteCaptureProps {
  /** Optional callback when note is captured */
  onCaptured?: () => void;
}

/**
 * Toast state for feedback display.
 */
interface ToastState {
  visible: boolean;
  type: "success" | "error";
  message: string;
}

/**
 * Note capture input with auto-growing textarea and submit button.
 *
 * - Auto-saves draft to localStorage on change
 * - Sends capture_note message via WebSocket
 * - Shows toast notification on success/error
 * - Retries up to 3x on network failure
 */
export function NoteCapture({ onCaptured }: NoteCaptureProps): React.ReactNode {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, type: "success", message: "" });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSentVaultSelectionRef = useRef(false);
  const hasRequestedRecentActivityRef = useRef(false);

  const { vault, setRecentNotes, setRecentDiscussions } = useSession();

  // Callback to re-send vault selection on WebSocket reconnect
  const handleReconnect = useCallback(() => {
    hasSentVaultSelectionRef.current = false;
    hasRequestedRecentActivityRef.current = false;
  }, []);

  const { sendMessage, lastMessage, connectionStatus } = useWebSocket({
    onReconnect: handleReconnect,
  });

  // Send vault selection when WebSocket connects (initial or reconnect)
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      vault &&
      !hasSentVaultSelectionRef.current
    ) {
      sendMessage({
        type: "select_vault",
        vaultId: vault.id,
      });
      hasSentVaultSelectionRef.current = true;
    }
  }, [connectionStatus, vault, sendMessage]);

  // Request recent activity after server confirms vault selection
  useEffect(() => {
    if (
      lastMessage?.type === "session_ready" &&
      !hasRequestedRecentActivityRef.current
    ) {
      sendMessage({ type: "get_recent_activity" });
      hasRequestedRecentActivityRef.current = true;
    }
  }, [lastMessage, sendMessage]);

  // Handle recent_activity response
  useEffect(() => {
    if (lastMessage?.type === "recent_activity") {
      setRecentNotes(lastMessage.captures);
      setRecentDiscussions(lastMessage.discussions);
    }
  }, [lastMessage, setRecentNotes, setRecentDiscussions]);

  // Load draft from localStorage on mount
  useEffect(() => {
    const draft = localStorage.getItem(STORAGE_KEY);
    if (draft) {
      setContent(draft);
    }
  }, []);

  // Save draft to localStorage on content change
  useEffect(() => {
    if (content) {
      localStorage.setItem(STORAGE_KEY, content);
    }
  }, [content]);

  // Handle note_captured response
  useEffect(() => {
    if (lastMessage?.type === "note_captured" && isSubmitting) {
      // Success - clear everything
      setContent("");
      localStorage.removeItem(STORAGE_KEY);
      setIsSubmitting(false);
      retryCountRef.current = 0;

      showToast("success", `Note saved at ${lastMessage.timestamp}`);
      onCaptured?.();

      // Refresh recent activity (RecentActivity component will handle the response)
      sendMessage({ type: "get_recent_activity" });
    }
  }, [lastMessage, isSubmitting, onCaptured, sendMessage]);

  // Handle error response
  useEffect(() => {
    if (lastMessage?.type === "error" && isSubmitting) {
      handleError(lastMessage.message);
    }
  }, [lastMessage, isSubmitting]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [content]);

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ visible: true, type, message });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 3000);
  }

  function handleError(errorMessage: string) {
    if (retryCountRef.current < MAX_RETRIES) {
      // Schedule retry with exponential backoff
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCountRef.current);
      retryCountRef.current += 1;

      showToast("error", `Failed, retrying... (${retryCountRef.current}/${MAX_RETRIES})`);

      retryTimeoutRef.current = setTimeout(() => {
        submitNote();
      }, delay);
    } else {
      // Max retries exceeded
      setIsSubmitting(false);
      retryCountRef.current = 0;
      showToast("error", `Failed to save note: ${errorMessage}`);
    }
  }

  function submitNote() {
    if (!content.trim() || !vault) return;

    sendMessage({
      type: "capture_note",
      text: content.trim(),
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!content.trim()) return;

    if (connectionStatus !== "connected") {
      showToast("error", "Not connected. Please wait...");
      return;
    }

    if (!vault) {
      showToast("error", "No vault selected");
      return;
    }

    setIsSubmitting(true);
    retryCountRef.current = 0;
    submitNote();
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
  }

  const isDisabled = isSubmitting || connectionStatus !== "connected" || !vault;

  return (
    <div className="note-capture">
      <form className="note-capture__form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="note-capture__input"
          value={content}
          onChange={handleChange}
          placeholder="What's on your mind?"
          disabled={isSubmitting}
          rows={3}
          aria-label="Note content"
        />
        <button
          type="submit"
          className="note-capture__submit"
          disabled={isDisabled || !content.trim()}
        >
          {isSubmitting ? "Saving..." : "Capture Note"}
        </button>
      </form>

      <RecentActivity sendMessage={sendMessage} />

      {toast.visible && (
        <div
          className={`note-capture__toast note-capture__toast--${toast.type}`}
          role="alert"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

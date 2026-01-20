/**
 * Note Capture Component
 *
 * Multiline textarea for capturing notes with auto-save to localStorage.
 * Submits via WebSocket and shows toast feedback.
 *
 * Supports two modes:
 * - Normal: Captures go to daily note
 * - Meeting: Captures go to meeting-specific file
 */

import React, { useState, useEffect, useRef } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSession } from "../contexts/SessionContext";
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
 * - Supports meeting mode for dedicated meeting notes
 */
export function NoteCapture({ onCaptured }: NoteCaptureProps): React.ReactNode {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, type: "success", message: "" });
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Meeting mode state
  const [showMeetingPrompt, setShowMeetingPrompt] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [isStartingMeeting, setIsStartingMeeting] = useState(false);
  const [isStoppingMeeting, setIsStoppingMeeting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const meetingTitleRef = useRef<HTMLInputElement>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { vault, meeting, clearMeeting, setDiscussionPrefill, setMode } = useSession();

  const { sendMessage, lastMessage, connectionStatus } = useWebSocket();

  // Detect touch-only devices (no hover capability)
  // On touch devices, Enter adds newlines; send button is the only way to submit
  useEffect(() => {
    const query = window.matchMedia("(hover: none)");
    setIsTouchDevice(query.matches);

    const handler = (e: MediaQueryListEvent) => setIsTouchDevice(e.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

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
    } else {
      localStorage.removeItem(STORAGE_KEY);
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

      // Context-aware success message
      const message = meeting.isActive
        ? "Note added to meeting"
        : `Note saved at ${lastMessage.timestamp}`;
      showToast("success", message);
      onCaptured?.();
      // Delay focus to ensure it happens after toast renders (toast can steal focus)
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });

      // Refresh recent activity for HomeView
      sendMessage({ type: "get_recent_activity" });
    }
  }, [lastMessage, isSubmitting, onCaptured, sendMessage, meeting.isActive]);

  // Handle error response
  useEffect(() => {
    if (lastMessage?.type === "error" && isSubmitting) {
      handleError(lastMessage.message);
    }
  }, [lastMessage, isSubmitting]);

  // Handle meeting_started response (local UI updates only; session context
  // is updated by useServerMessageHandler in MainContent)
  useEffect(() => {
    if (lastMessage?.type === "meeting_started" && isStartingMeeting) {
      setIsStartingMeeting(false);
      setShowMeetingPrompt(false);
      setMeetingTitle("");
      showToast("success", `Meeting started: ${lastMessage.title}`);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [lastMessage, isStartingMeeting]);

  // Handle meeting_stopped response
  useEffect(() => {
    if (lastMessage?.type === "meeting_stopped" && isStoppingMeeting) {
      setIsStoppingMeeting(false);
      // Clear meeting state in session context
      clearMeeting();
      showToast(
        "success",
        `Meeting ended: ${lastMessage.entryCount} notes captured`
      );
      // Transition to Discussion tab with expand-note command
      setDiscussionPrefill(`/expand-note ${lastMessage.filePath}`);
      setMode("discussion");
    }
  }, [lastMessage, isStoppingMeeting, clearMeeting, setDiscussionPrefill, setMode]);

  // Handle meeting start error
  useEffect(() => {
    if (lastMessage?.type === "error" && isStartingMeeting) {
      setIsStartingMeeting(false);
      showToast("error", lastMessage.message);
    }
  }, [lastMessage, isStartingMeeting]);

  // Handle meeting stop error
  useEffect(() => {
    if (lastMessage?.type === "error" && isStoppingMeeting) {
      setIsStoppingMeeting(false);
      showToast("error", lastMessage.message);
    }
  }, [lastMessage, isStoppingMeeting]);

  // Focus meeting title input when prompt opens
  useEffect(() => {
    if (showMeetingPrompt) {
      meetingTitleRef.current?.focus();
    }
  }, [showMeetingPrompt]);

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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // On touch devices, Enter always adds a newline (no keyboard shortcut to submit)
    // On desktop, Enter submits and Shift+Enter adds a newline
    if (e.key === "Enter" && !e.shiftKey && !isTouchDevice) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  // Meeting handlers
  function handleStartMeetingClick() {
    setShowMeetingPrompt(true);
  }

  function handleCancelMeetingPrompt() {
    setShowMeetingPrompt(false);
    setMeetingTitle("");
  }

  function handleMeetingTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setMeetingTitle(e.target.value);
  }

  function handleMeetingTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirmStartMeeting();
    } else if (e.key === "Escape") {
      handleCancelMeetingPrompt();
    }
  }

  function handleConfirmStartMeeting() {
    if (!meetingTitle.trim()) {
      showToast("error", "Please enter a meeting title");
      return;
    }

    if (connectionStatus !== "connected") {
      showToast("error", "Not connected. Please wait...");
      return;
    }

    setIsStartingMeeting(true);
    sendMessage({
      type: "start_meeting",
      title: meetingTitle.trim(),
    });
  }

  function handleStopMeeting() {
    if (connectionStatus !== "connected") {
      showToast("error", "Not connected. Please wait...");
      return;
    }

    setIsStoppingMeeting(true);
    sendMessage({ type: "stop_meeting" });
  }

  const isDisabled = isSubmitting || connectionStatus !== "connected" || !vault;

  // Determine placeholder text based on meeting state
  const placeholderText = meeting.isActive
    ? `Capturing to: ${meeting.title}`
    : "What's on your mind? Goes to your daily note.";

  // Determine button text based on meeting state
  const submitButtonText = isSubmitting
    ? "Saving..."
    : meeting.isActive
      ? "Add Note"
      : "Capture Note";

  return (
    <div className="note-capture">
      {/* Meeting status bar */}
      {meeting.isActive && (
        <div className="note-capture__meeting-status">
          <span className="note-capture__meeting-indicator" />
          <span className="note-capture__meeting-title">{meeting.title}</span>
          <button
            type="button"
            className="note-capture__stop-meeting"
            onClick={handleStopMeeting}
            disabled={isStoppingMeeting}
          >
            {isStoppingMeeting ? "Stopping..." : "Stop Meeting"}
          </button>
        </div>
      )}

      {/* Meeting title prompt modal */}
      {showMeetingPrompt && (
        <div className="note-capture__meeting-prompt">
          <div className="note-capture__meeting-prompt-content">
            <label htmlFor="meeting-title">Meeting Title</label>
            <input
              ref={meetingTitleRef}
              id="meeting-title"
              type="text"
              value={meetingTitle}
              onChange={handleMeetingTitleChange}
              onKeyDown={handleMeetingTitleKeyDown}
              placeholder="e.g., Q3 Planning with Sarah"
              disabled={isStartingMeeting}
            />
            <div className="note-capture__meeting-prompt-buttons">
              <button
                type="button"
                onClick={handleCancelMeetingPrompt}
                disabled={isStartingMeeting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStartMeeting}
                disabled={isStartingMeeting || !meetingTitle.trim()}
              >
                {isStartingMeeting ? "Starting..." : "Start Meeting"}
              </button>
            </div>
          </div>
        </div>
      )}

      <form className="note-capture__form" onSubmit={handleSubmit}>
        <div className="note-capture__actions">
          <button
            type="submit"
            className="note-capture__submit"
            disabled={isDisabled || !content.trim()}
          >
            {submitButtonText}
          </button>
          {!meeting.isActive && (
            <button
              type="button"
              className="note-capture__start-meeting"
              onClick={handleStartMeetingClick}
              disabled={isDisabled}
            >
              Start Meeting
            </button>
          )}
        </div>
        <textarea
          ref={textareaRef}
          className="note-capture__input"
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          disabled={isSubmitting}
          rows={3}
          aria-label="Note content"
        />
      </form>

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

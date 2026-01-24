/**
 * RecentActivity Component
 *
 * Displays both recent note captures and discussion sessions.
 * Provides quick actions: View in Browse for captures, Resume/Delete for discussions.
 *
 * Note: This component reads data from SessionContext. The parent component
 * is responsible for fetching the data via WebSocket.
 */

import React, { useCallback, useState } from "react";
import { useSession } from "../../contexts/SessionContext";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import type { RecentNoteEntry, RecentDiscussionEntry } from "@memory-loop/shared";
import "./RecentActivity.css";

/**
 * Formats a Date as YYYY-MM-DD in local timezone.
 * Must match backend's formatDateForFilename for consistent comparison.
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a date string as a relative date (Today, Yesterday, or the date).
 */
function formatRelativeDate(dateStr: string): string {
  const today = new Date();
  const todayStr = formatLocalDate(today);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatLocalDate(yesterday);

  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  return dateStr;
}

/**
 * Props for RecentActivity component.
 */
export interface RecentActivityProps {
  /** Callback when user wants to resume a discussion */
  onResumeDiscussion?: (sessionId: string) => void;
  /** Callback when user wants to view a capture in browse mode */
  onViewCapture?: (date: string) => void;
  /** Callback when user confirms session deletion (parent handles WebSocket) */
  onDeleteSession?: (sessionId: string) => void;
}

/**
 * Recent activity display with captures and discussions.
 *
 * Reads data from SessionContext. Parent component is responsible for:
 * - Sending get_recent_activity message on mount/reconnect
 * - Handling recent_activity response and updating context
 * - Sending delete_session message via onDeleteSession callback
 * - Handling session_deleted response and calling removeDiscussion
 */
export function RecentActivity({
  onResumeDiscussion,
  onViewCapture,
  onDeleteSession,
}: RecentActivityProps): React.ReactNode {
  const {
    vault,
    recentNotes,
    recentDiscussions,
    sessionId,
    setMode,
    setCurrentPath,
    setPendingSessionId,
  } = useSession();

  // State for delete confirmation dialog
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Handle view capture click - open the daily note file in browse mode
  const handleViewCapture = useCallback(
    (date: string) => {
      if (onViewCapture) {
        onViewCapture(date);
      } else {
        // Navigate to the specific daily note file
        const inboxPath = vault?.inboxPath ?? "";
        const filePath = inboxPath ? `${inboxPath}/${date}.md` : `${date}.md`;
        setCurrentPath(filePath);
        setMode("browse");
      }
    },
    [onViewCapture, setCurrentPath, setMode, vault?.inboxPath]
  );

  // Handle resume discussion click
  const handleResumeDiscussion = useCallback(
    (sessionId: string) => {
      if (onResumeDiscussion) {
        onResumeDiscussion(sessionId);
      } else {
        // Set pending session ID so Discussion can send resume_session when it mounts
        // This avoids a race condition where Discussion would send its own session management
        setPendingSessionId(sessionId);
        setMode("discussion");
      }
    },
    [onResumeDiscussion, setPendingSessionId, setMode]
  );

  // Handle delete button click - show confirmation dialog
  const handleDeleteClick = useCallback((deleteSessionId: string) => {
    setPendingDeleteId(deleteSessionId);
  }, []);

  // Handle delete confirmation
  const handleConfirmDelete = useCallback(() => {
    if (pendingDeleteId && onDeleteSession) {
      onDeleteSession(pendingDeleteId);
      setPendingDeleteId(null);
    }
  }, [pendingDeleteId, onDeleteSession]);

  // Handle delete cancellation
  const handleCancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  const hasCaptures = recentNotes.length > 0;
  const hasDiscussions = recentDiscussions.length > 0;

  if (!hasCaptures && !hasDiscussions) {
    return null;
  }

  return (
    <section className="recent-activity" aria-label="Recent activity">

      {hasCaptures && (
        <div className="recent-activity__section">
          <h3 className="recent-activity__section-title">
            <span className="recent-activity__heading">Recent: Captures</span>
          </h3>
          <div className="recent-activity__list">
            {recentNotes.map((note) => (
              <CaptureCard
                key={note.id}
                note={note}
                onView={() => handleViewCapture(note.date)}
              />
            ))}
          </div>
        </div>
      )}

      {hasDiscussions && (
        <div className="recent-activity__section">
          <h3 className="recent-activity__section-title">
            <span className="recent-activity__heading">Recent: Discussions</span>
          </h3>
          <div className="recent-activity__list">
            {recentDiscussions.map((discussion) => (
              <DiscussionCard
                key={discussion.sessionId}
                discussion={discussion}
                isActive={discussion.sessionId === sessionId}
                onResume={() => handleResumeDiscussion(discussion.sessionId)}
                onDelete={() => handleDeleteClick(discussion.sessionId)}
              />
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        title="Delete Session?"
        message="This cannot be undone! The session and its conversation history will be permanently deleted."
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </section>
  );
}

/**
 * Card for displaying a recent capture.
 */
interface CaptureCardProps {
  note: RecentNoteEntry;
  onView: () => void;
}

function CaptureCard({ note, onView }: CaptureCardProps): React.ReactNode {
  const relativeDate = formatRelativeDate(note.date);
  const showDate = relativeDate !== "Today";

  return (
    <article className="recent-activity__card recent-activity__card--capture">
      <p className="recent-activity__text">{note.text}</p>
      <div className="recent-activity__footer">
        <div className="recent-activity__meta">
          <time className="recent-activity__time">{note.time}</time>
          {showDate && (
            <span className="recent-activity__date">{relativeDate}</span>
          )}
        </div>
        <button
          type="button"
          className="recent-activity__action"
          onClick={onView}
          aria-label="View note"
        >
          View
        </button>
      </div>
    </article>
  );
}

/**
 * Card for displaying a recent discussion.
 */
interface DiscussionCardProps {
  discussion: RecentDiscussionEntry;
  isActive: boolean;
  onResume: () => void;
  onDelete: () => void;
}

function DiscussionCard({
  discussion,
  isActive,
  onResume,
  onDelete,
}: DiscussionCardProps): React.ReactNode {
  const relativeDate = formatRelativeDate(discussion.date);
  const showDate = relativeDate !== "Today";

  return (
    <article className="recent-activity__card recent-activity__card--discussion">
      <p className="recent-activity__text">{discussion.preview}</p>
      <div className="recent-activity__footer">
        <div className="recent-activity__meta">
          <time className="recent-activity__time">{discussion.time}</time>
          {showDate && (
            <span className="recent-activity__date">{relativeDate}</span>
          )}
          <span className="recent-activity__count">
            {discussion.messageCount} messages
          </span>
        </div>
        <div className="recent-activity__actions">
          <button
            type="button"
            className="recent-activity__action recent-activity__action--danger"
            onClick={onDelete}
            disabled={isActive}
            aria-label={isActive ? "Cannot delete active session" : "Delete discussion"}
            title={isActive ? "Cannot delete the active session" : "Delete this session"}
          >
            Delete
          </button>
          <button
            type="button"
            className="recent-activity__action recent-activity__action--primary"
            onClick={onResume}
            aria-label="Resume discussion"
          >
            Resume
          </button>
        </div>
      </div>
    </article>
  );
}

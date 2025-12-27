/**
 * RecentActivity Component
 *
 * Displays both recent note captures and discussion sessions.
 * Provides quick actions: View in Browse for captures, Resume for discussions.
 *
 * Note: This component reads data from SessionContext. The parent component
 * is responsible for fetching the data via WebSocket.
 */

import React, { useCallback } from "react";
import { useSession } from "../contexts/SessionContext";
import type { RecentNoteEntry, RecentDiscussionEntry, ClientMessage } from "@memory-loop/shared";
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
  /** Function to send WebSocket messages (from parent's useWebSocket) */
  sendMessage?: (message: ClientMessage) => void;
}

/**
 * Recent activity display with captures and discussions.
 *
 * Reads data from SessionContext. Parent component is responsible for:
 * - Sending get_recent_activity message on mount/reconnect
 * - Handling recent_activity response and updating context
 */
export function RecentActivity({
  onResumeDiscussion,
  onViewCapture,
  sendMessage,
}: RecentActivityProps): React.ReactNode {
  const {
    vault,
    recentNotes,
    recentDiscussions,
    setMode,
    setCurrentPath,
  } = useSession();

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
      } else if (sendMessage) {
        // Default: send resume_session and switch to discussion mode
        sendMessage({ type: "resume_session", sessionId });
        setMode("discussion");
      }
    },
    [onResumeDiscussion, sendMessage, setMode]
  );

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
                onResume={() => handleResumeDiscussion(discussion.sessionId)}
              />
            ))}
          </div>
        </div>
      )}
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
  onResume: () => void;
}

function DiscussionCard({
  discussion,
  onResume,
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
        <button
          type="button"
          className="recent-activity__action recent-activity__action--primary"
          onClick={onResume}
          aria-label="Resume discussion"
        >
          Resume
        </button>
      </div>
    </article>
  );
}

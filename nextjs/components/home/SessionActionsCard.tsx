/**
 * SessionActionsCard Component
 *
 * Displays action buttons (Daily Prep/Debrief, Weekly, Monthly) and
 * shows today's commitment summary if daily prep exists.
 *
 * Part of the Ground tab restructure (split from context card).
 */

import React, { useMemo, useCallback } from "react";
import { useSession } from "../../contexts/SessionContext";
import "./SessionActionsCard.css";

/**
 * Debrief button configuration.
 */
export interface DebriefButton {
  label: string;
  command: string;
}

/**
 * Daily prep status from the API.
 */
export interface DailyPrepStatus {
  exists: boolean;
  commitment?: string[];
  energy?: string;
  calendar?: string;
}

export interface SessionActionsCardProps {
  /** Daily prep status for today */
  dailyPrepStatus: DailyPrepStatus | null;
  /** Whether daily prep status is loading */
  isLoading?: boolean;
}

/**
 * Determines which buttons to show based on date and daily prep status.
 *
 * Button logic:
 * - Daily row: "Daily Prep" if no prep file, "Daily Debrief" if prep exists
 * - Weekly: Friday through Sunday
 * - Monthly: Last 3 days or first 3 days of month
 */
export function getSessionButtons(
  today: Date,
  dailyPrepStatus: DailyPrepStatus | null
): DebriefButton[] {
  const buttons: DebriefButton[] = [];
  const dayOfWeek = today.getDay();
  const dayOfMonth = today.getDate();
  const year = today.getFullYear();
  const month = today.getMonth();

  // Daily row - always show one of these
  if (dailyPrepStatus?.exists) {
    buttons.push({ label: "Daily Debrief", command: "/daily-debrief" });
  } else {
    buttons.push({ label: "Daily Prep", command: "/daily-prep" });
  }

  // Weekly Debrief: Friday (5) through Sunday (0)
  if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
    buttons.push({ label: "Weekly Debrief", command: "/weekly-debrief" });
  }

  // Monthly Summary: last 3 days of month or first 3 days of next month
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const isLastDaysOfMonth = dayOfMonth >= lastDayOfMonth - 2;
  const isFirstDaysOfMonth = dayOfMonth <= 3;

  if (isLastDaysOfMonth || isFirstDaysOfMonth) {
    let summaryYear = year;
    let summaryMonth = month + 1;

    if (isFirstDaysOfMonth) {
      if (month === 0) {
        summaryYear = year - 1;
        summaryMonth = 12;
      } else {
        summaryMonth = month;
      }
    }

    const monthStr = summaryMonth.toString().padStart(2, "0");
    buttons.push({
      label: "Monthly Summary",
      command: `/monthly-summary ${summaryYear} ${monthStr}`,
    });
  }

  return buttons;
}

/**
 * SessionActionsCard displays action buttons and commitment summary.
 */
export function SessionActionsCard({
  dailyPrepStatus,
  isLoading = false,
}: SessionActionsCardProps): React.ReactNode {
  const { setDiscussionPrefill, setMode } = useSession();

  const today = useMemo(() => new Date(), []);
  const buttons = useMemo(
    () => getSessionButtons(today, dailyPrepStatus),
    [today, dailyPrepStatus]
  );

  const handleButtonClick = useCallback(
    (command: string) => {
      setDiscussionPrefill(command);
      setMode("discussion");
    },
    [setDiscussionPrefill, setMode]
  );

  return (
    <section className="session-actions-card" aria-label="Session actions">
      {/* Action Buttons */}
      <div className="session-actions-card__buttons">
        {buttons.map((btn) => (
          <button
            key={btn.command}
            type="button"
            className="session-actions-card__button"
            onClick={() => handleButtonClick(btn.command)}
            aria-label={`Start ${btn.label.toLowerCase()} discussion`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Commitment Summary - shown when prep exists */}
      {dailyPrepStatus?.exists && dailyPrepStatus.commitment && dailyPrepStatus.commitment.length > 0 && (
        <div className="session-actions-card__commitment">
          <span className="session-actions-card__commitment-label">Today's Commitment</span>
          <ul className="session-actions-card__commitment-list">
            {dailyPrepStatus.commitment.map((item, index) => (
              <li key={index} className="session-actions-card__commitment-item">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="session-actions-card__loading" aria-label="Loading daily prep status">
          <div className="session-actions-card__skeleton-line" />
        </div>
      )}
    </section>
  );
}

/**
 * HomeView Component
 *
 * Default landing view when a vault is selected.
 * Displays session context, goals, inspiration, and recent activity.
 */

/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises */
// REST API calls in useEffect fire-and-forget patterns

import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSession } from "../contexts/SessionContext";
import { useWebSocket } from "../hooks/useWebSocket";
import { useCapture } from "../hooks/useCapture";
import { useHome } from "../hooks/useHome";
import { useSessions } from "../hooks/useSessions";
import { RecentActivity } from "./RecentActivity";
import { GoalsCard } from "./GoalsCard";
import { InspirationCard } from "./InspirationCard";
import { HealthPanel } from "./HealthPanel";
import type { InspirationItem } from "@memory-loop/shared";
import "./HomeView.css";

/**
 * Debrief button configuration.
 */
interface DebriefButton {
  label: string;
  command: string;
}

/**
 * Determines which debrief buttons should be shown based on the current date
 * and whether a daily note exists.
 *
 * @param today - Current date (for testing, defaults to now)
 * @param hasTodayNote - Whether a note exists for today
 * @returns Array of buttons to display (max 3)
 */
export function getDebriefButtons(
  today: Date = new Date(),
  hasTodayNote: boolean = false
): DebriefButton[] {
  const buttons: DebriefButton[] = [];
  const dayOfWeek = today.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  const dayOfMonth = today.getDate();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-indexed

  // Daily Debrief: shown when there's a note for today
  if (hasTodayNote) {
    buttons.push({ label: "Daily Debrief", command: "/daily-debrief" });
  }

  // Weekly Debrief: shown Friday (5) through Sunday (0)
  if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
    buttons.push({ label: "Weekly Debrief", command: "/weekly-debrief" });
  }

  // Monthly Summary: shown last 3 days of month or first 3 days of next month
  // Get last day of current month
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const isLastDaysOfMonth = dayOfMonth >= lastDayOfMonth - 2;
  const isFirstDaysOfMonth = dayOfMonth <= 3;

  if (isLastDaysOfMonth || isFirstDaysOfMonth) {
    // Determine which month to summarize
    // First 3 days: summarize previous month
    // Last 3 days: summarize current month
    let summaryYear = year;
    let summaryMonth = month + 1; // Convert to 1-indexed

    if (isFirstDaysOfMonth) {
      // Summarize previous month
      if (month === 0) {
        summaryYear = year - 1;
        summaryMonth = 12;
      } else {
        summaryMonth = month; // 0-indexed month equals previous month 1-indexed (e.g., month=1 Feb → summaryMonth=1 → "01" Jan)
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
 * Formats today's date as YYYY-MM-DD for comparison with note dates.
 */
function formatDateAsYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Home view with session context and recent activity.
 *
 * - Shows vault name and debrief action buttons
 * - Displays goals, inspiration, and recent activity
 */
export function HomeView(): React.ReactNode {
  const {
    vault,
    recentNotes,
    setRecentNotes,
    setRecentDiscussions,
    setGoals,
    setMode,
    setDiscussionPrefill,
    removeDiscussion,
  } = useSession();

  const hasSentVaultSelectionRef = useRef(false);
  const hasLoadedDataRef = useRef(false);

  // REST API hooks (migrated from WebSocket)
  const { getRecentActivity } = useCapture(vault?.id);
  const { getGoals, getInspiration } = useHome(vault?.id);
  const { deleteSession } = useSessions(vault?.id);

  // Inspiration state
  const [inspirationLoading, setInspirationLoading] = useState(true);
  const [inspirationContextual, setInspirationContextual] =
    useState<InspirationItem | null>(null);
  const [inspirationQuote, setInspirationQuote] =
    useState<InspirationItem | null>(null);

  // Callback to re-send vault selection on WebSocket reconnect
  const handleReconnect = useCallback(() => {
    hasSentVaultSelectionRef.current = false;
    hasLoadedDataRef.current = false;
    setInspirationLoading(true);
  }, []);

  const { sendMessage, connectionStatus } = useWebSocket({
    onReconnect: handleReconnect,
  });

  // Callback to delete a session (now uses REST API)
  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const success = await deleteSession(sessionId);
      if (success) {
        removeDiscussion(sessionId);
      }
    },
    [deleteSession, removeDiscussion]
  );

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

  // Load data via REST API after vault selection is confirmed
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      vault &&
      hasSentVaultSelectionRef.current &&
      !hasLoadedDataRef.current
    ) {
      hasLoadedDataRef.current = true;

      // Load recent activity
      getRecentActivity().then((activity) => {
        if (activity) {
          setRecentNotes(activity.captures);
          setRecentDiscussions(activity.discussions);
        }
      });

      // Load goals (only if vault has goalsPath)
      if (vault.goalsPath) {
        getGoals().then((content) => {
          if (content !== null) {
            setGoals(content);
          }
        });
      }

      // Load inspiration
      getInspiration().then((result) => {
        if (result) {
          setInspirationContextual(result.contextual);
          setInspirationQuote(result.quote);
        }
        setInspirationLoading(false);
      });
    }
  }, [connectionStatus, vault, getRecentActivity, getGoals, getInspiration, setRecentNotes, setRecentDiscussions, setGoals]);

  // Determine which debrief buttons to show (single Date for consistency)
  const today = new Date();
  const todayStr = formatDateAsYYYYMMDD(today);
  const hasTodayNote = recentNotes.some((note) => note.date === todayStr);
  const debriefButtons = useMemo(
    () => getDebriefButtons(today, hasTodayNote),
    [todayStr, hasTodayNote]
  );

  // Handle debrief button click
  const handleDebriefClick = useCallback(
    (command: string) => {
      setDiscussionPrefill(command);
      setMode("discussion");
    },
    [setDiscussionPrefill, setMode]
  );

  return (
    <div className="home-view">
      {/* Session Context Card */}
      <section className="home-view__context-card" aria-label="Session context">
        <div className="home-view__vault-info">
          <span className="home-view__vault-label">Current Vault</span>
          <h2 className="home-view__vault-name">{vault?.name ?? "—"}</h2>
          {vault?.subtitle && (
            <p className="home-view__vault-subtitle">{vault.subtitle}</p>
          )}
        </div>
        {debriefButtons.length > 0 && (
          <div className="home-view__debrief-buttons">
            {debriefButtons.map((btn) => (
              <button
                key={btn.command}
                type="button"
                className="home-view__debrief-button"
                onClick={() => handleDebriefClick(btn.command)}
                aria-label={`Start ${btn.label.toLowerCase()} discussion`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Inspiration */}
      {inspirationQuote && (
        <InspirationCard
          contextual={inspirationContextual}
          quote={inspirationQuote}
          isLoading={inspirationLoading}
        />
      )}

      {/* Goals */}
      <GoalsCard />

      {/* Recent Activity */}
      <RecentActivity onDeleteSession={handleDeleteSession} />

      {/* Health Issues */}
      <HealthPanel />
    </div>
  );
}

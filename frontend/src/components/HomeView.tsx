/**
 * HomeView Component
 *
 * Default landing view when a vault is selected.
 * Displays session context, goals, inspiration, and recent activity.
 */

import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSession } from "../contexts/SessionContext";
import { useWebSocket } from "../hooks/useWebSocket";
import { RecentActivity } from "./RecentActivity";
import { GoalsCard } from "./GoalsCard";
import { InspirationCard } from "./InspirationCard";
import type {
  ClientMessage,
  InspirationItem,
  ServerMessage,
} from "@memory-loop/shared";
import { WidgetRenderer } from "./widgets";
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
    widgets,
    setGroundWidgets,
    setGroundWidgetsLoading,
    setGroundWidgetsError,
  } = useSession();

  const hasSentVaultSelectionRef = useRef(false);
  const hasRequestedRecentActivityRef = useRef(false);
  const hasRequestedGoalsRef = useRef(false);
  const hasRequestedInspirationRef = useRef(false);
  const hasRequestedGroundWidgetsRef = useRef(false);

  // Keep vault ref in sync for use in callbacks
  const vaultRef = useRef(vault);
  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);

  // Inspiration state
  const [inspirationLoading, setInspirationLoading] = useState(true);
  const [inspirationContextual, setInspirationContextual] =
    useState<InspirationItem | null>(null);
  const [inspirationQuote, setInspirationQuote] =
    useState<InspirationItem | null>(null);

  // Ref for sendMessage to use in callbacks without stale closure
  const sendMessageRef = useRef<((msg: ClientMessage) => void) | null>(null);

  // Handle all incoming messages in a single callback (prevents race conditions)
  const handleMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "session_ready":
          // Request recent activity, goals, inspiration, and ground widgets after server confirms vault selection
          // Note: Goals are only requested if vault has goalsPath set during discovery.
          // If user creates goals.md after vault selection, they must reselect the vault.
          if (!hasRequestedRecentActivityRef.current) {
            sendMessageRef.current?.({ type: "get_recent_activity" });
            hasRequestedRecentActivityRef.current = true;
          }
          if (!hasRequestedGoalsRef.current && vaultRef.current?.goalsPath) {
            sendMessageRef.current?.({ type: "get_goals" });
            hasRequestedGoalsRef.current = true;
          }
          if (!hasRequestedInspirationRef.current) {
            sendMessageRef.current?.({ type: "get_inspiration" });
            hasRequestedInspirationRef.current = true;
          }
          // Request ground widgets (vault-level aggregations) for Home view
          if (!hasRequestedGroundWidgetsRef.current) {
            sendMessageRef.current?.({ type: "get_ground_widgets" });
            hasRequestedGroundWidgetsRef.current = true;
          }
          break;

        case "recent_activity":
          setRecentNotes(message.captures);
          setRecentDiscussions(message.discussions);
          break;

        case "goals":
          setGoals(message.sections);
          break;

        case "inspiration":
          setInspirationContextual(message.contextual);
          setInspirationQuote(message.quote);
          setInspirationLoading(false);
          break;

        case "session_deleted":
          removeDiscussion(message.sessionId);
          break;

        case "ground_widgets":
          setGroundWidgets(message.widgets);
          setGroundWidgetsLoading(false);
          break;

        case "widget_error":
          // Only handle ground-level errors (no filePath means it's a ground widget error)
          if (!message.filePath) {
            setGroundWidgetsError(message.error);
            setGroundWidgetsLoading(false);
          }
          break;
      }
    },
    [setRecentNotes, setRecentDiscussions, setGoals, removeDiscussion, setGroundWidgets, setGroundWidgetsLoading, setGroundWidgetsError]
  );

  // Callback to re-send vault selection on WebSocket reconnect
  const handleReconnect = useCallback(() => {
    hasSentVaultSelectionRef.current = false;
    hasRequestedRecentActivityRef.current = false;
    hasRequestedGoalsRef.current = false;
    hasRequestedInspirationRef.current = false;
    hasRequestedGroundWidgetsRef.current = false;
    setInspirationLoading(true);
    setGroundWidgetsLoading(true);
  }, [setGroundWidgetsLoading]);

  const { sendMessage, connectionStatus } = useWebSocket({
    onReconnect: handleReconnect,
    onMessage: handleMessage,
  });

  // Keep sendMessage ref in sync
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // Callback to delete a session
  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      sendMessage({ type: "delete_session", sessionId });
    },
    [sendMessage]
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

      {/* Ground Widgets */}
      {widgets.isGroundLoading ? (
        <section className="home-view__widgets home-view__widgets--loading" aria-label="Loading widgets">
          <div className="home-view__widget-skeleton" aria-hidden="true" />
          <div className="home-view__widget-skeleton" aria-hidden="true" />
        </section>
      ) : widgets.groundError ? (
        <section className="home-view__widgets home-view__widgets--error" aria-label="Widget error">
          <p className="home-view__error">{widgets.groundError}</p>
        </section>
      ) : widgets.groundWidgets.length > 0 ? (
        <section className="home-view__widgets" aria-label="Vault widgets">
          {widgets.groundWidgets.map((widget) => (
            <WidgetRenderer key={widget.name} widget={widget} />
          ))}
        </section>
      ) : null}

      {/* Recent Activity */}
      <RecentActivity onDeleteSession={handleDeleteSession} />
    </div>
  );
}

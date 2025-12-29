/**
 * HomeView Component
 *
 * Default landing view when a vault is selected.
 * Displays session context, goals, inspiration, and recent activity.
 */

import React, { useEffect, useRef, useCallback, useState } from "react";
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
import "./HomeView.css";

/**
 * Formats a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return "< 1m";
}

/**
 * Home view with session context and recent activity.
 *
 * - Shows vault name and session stats
 * - Displays goals, inspiration, and recent activity
 */
export function HomeView(): React.ReactNode {
  const {
    vault,
    sessionStartTime,
    messages,
    setRecentNotes,
    setRecentDiscussions,
    setGoals,
  } = useSession();

  const hasSentVaultSelectionRef = useRef(false);
  const hasRequestedRecentActivityRef = useRef(false);
  const hasRequestedGoalsRef = useRef(false);
  const hasRequestedInspirationRef = useRef(false);

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
          // Request recent activity, goals, and inspiration after server confirms vault selection
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
      }
    },
    [setRecentNotes, setRecentDiscussions, setGoals]
  );

  // Callback to re-send vault selection on WebSocket reconnect
  const handleReconnect = useCallback(() => {
    hasSentVaultSelectionRef.current = false;
    hasRequestedRecentActivityRef.current = false;
    hasRequestedGoalsRef.current = false;
    hasRequestedInspirationRef.current = false;
    setInspirationLoading(true);
  }, []);

  const { sendMessage, connectionStatus } = useWebSocket({
    onReconnect: handleReconnect,
    onMessage: handleMessage,
  });

  // Keep sendMessage ref in sync
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

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

  // Calculate session duration
  const sessionDuration = sessionStartTime
    ? formatDuration(Date.now() - sessionStartTime.getTime())
    : null;

  return (
    <div className="home-view">
      {/* Session Context Card */}
      <section className="home-view__context-card" aria-label="Session context">
        <div className="home-view__vault-info">
          <span className="home-view__vault-label">Current Vault</span>
          <h2 className="home-view__vault-name">{vault?.name ?? "—"}</h2>
        </div>
        <div className="home-view__session-stats">
          {sessionDuration && (
            <div className="home-view__stat">
              <span className="home-view__stat-value">{sessionDuration}</span>
              <span className="home-view__stat-label">Session</span>
            </div>
          )}
          <div className="home-view__stat">
            <span className="home-view__stat-value">{messages.length}</span>
            <span className="home-view__stat-label">Messages</span>
          </div>
        </div>
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
      <RecentActivity />
    </div>
  );
}

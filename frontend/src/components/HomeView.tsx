/**
 * HomeView Component
 *
 * Default landing view when a vault is selected.
 * Displays session context, quick actions, and recent activity.
 */

import React, { useEffect, useRef, useCallback } from "react";
import { useSession, type AppMode } from "../contexts/SessionContext";
import { useWebSocket } from "../hooks/useWebSocket";
import { RecentActivity } from "./RecentActivity";
import { GoalsCard } from "./GoalsCard";
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
 * Props for HomeView component.
 */
export interface HomeViewProps {
  /** Optional callback when mode changes */
  onModeChange?: (mode: AppMode) => void;
}

/**
 * Home view with session context, quick actions, and recent activity.
 *
 * - Shows vault name and session stats
 * - Provides quick action buttons to switch modes
 * - Displays recent captures and discussions
 */
export function HomeView({ onModeChange }: HomeViewProps): React.ReactNode {
  const {
    vault,
    sessionStartTime,
    messages,
    setMode,
    setRecentNotes,
    setRecentDiscussions,
    setGoals,
  } = useSession();

  const hasSentVaultSelectionRef = useRef(false);
  const hasRequestedRecentActivityRef = useRef(false);
  const hasRequestedGoalsRef = useRef(false);

  // Callback to re-send vault selection on WebSocket reconnect
  const handleReconnect = useCallback(() => {
    hasSentVaultSelectionRef.current = false;
    hasRequestedRecentActivityRef.current = false;
    hasRequestedGoalsRef.current = false;
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

  // Request recent activity and goals after server confirms vault selection
  // Note: Goals are only requested if vault has goalsPath set during discovery.
  // If user creates goals.md after vault selection, they must reselect the vault.
  useEffect(() => {
    if (lastMessage?.type === "session_ready") {
      if (!hasRequestedRecentActivityRef.current) {
        sendMessage({ type: "get_recent_activity" });
        hasRequestedRecentActivityRef.current = true;
      }
      if (!hasRequestedGoalsRef.current && vault?.goalsPath) {
        sendMessage({ type: "get_goals" });
        hasRequestedGoalsRef.current = true;
      }
    }
  }, [lastMessage, sendMessage, vault?.goalsPath]);

  // Handle recent_activity response
  useEffect(() => {
    if (lastMessage?.type === "recent_activity") {
      setRecentNotes(lastMessage.captures);
      setRecentDiscussions(lastMessage.discussions);
    }
  }, [lastMessage, setRecentNotes, setRecentDiscussions]);

  // Handle goals response
  useEffect(() => {
    if (lastMessage?.type === "goals") {
      setGoals(lastMessage.sections);
    }
  }, [lastMessage, setGoals]);

  // Quick action handlers
  function handleCaptureThought() {
    setMode("note");
    onModeChange?.("note");
  }

  function handleAskClaude() {
    setMode("discussion");
    onModeChange?.("discussion");
  }

  function handleBrowseVault() {
    setMode("browse");
    onModeChange?.("browse");
  }

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

      {/* Quick Actions */}
      <section className="home-view__quick-actions" aria-label="Quick actions">
        <button
          type="button"
          className="home-view__action home-view__action--capture"
          onClick={handleCaptureThought}
        >
          <span className="home-view__action-icon">+</span>
          <span className="home-view__action-label">Capture thought</span>
        </button>
        <button
          type="button"
          className="home-view__action home-view__action--chat"
          onClick={handleAskClaude}
        >
          <span className="home-view__action-icon">?</span>
          <span className="home-view__action-label">Ask Claude</span>
        </button>
        <button
          type="button"
          className="home-view__action home-view__action--browse"
          onClick={handleBrowseVault}
        >
          <span className="home-view__action-icon">☰</span>
          <span className="home-view__action-label">Browse vault</span>
        </button>
      </section>

      {/* Goals */}
      <GoalsCard />

      {/* Recent Activity */}
      <RecentActivity sendMessage={sendMessage} />
    </div>
  );
}

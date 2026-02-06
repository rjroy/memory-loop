/**
 * HomeView Component
 *
 * Default landing view when a vault is selected.
 * Displays session context, goals, inspiration, and recent activity.
 *
 * Ground tab restructure:
 * - VaultInfoCard: Vault name and subtitle (left/top)
 * - SessionActionsCard: Action buttons + commitment (right/bottom)
 */

// REST API calls in useEffect use fire-and-forget patterns with explicit catch handlers

import React, { useEffect, useCallback, useState } from "react";
import { useSession } from "../../contexts/SessionContext";
import { useCapture } from "../../hooks/useCapture";
import { useHome, type DailyPrepStatusResponse } from "../../hooks/useHome";
import { useSessions } from "../../hooks/useSessions";
import { VaultInfoCard } from "./VaultInfoCard";
import { SessionActionsCard } from "./SessionActionsCard";
import { RecentActivity } from "./RecentActivity";
import { GoalsCard } from "./GoalsCard";
import { InspirationCard } from "./InspirationCard";
import { SpacedRepetitionWidget } from "./SpacedRepetitionWidget";

import type { InspirationItem } from "@/lib/schemas";
import { createLogger } from "@/lib/logger";
import "./HomeView.css";

const log = createLogger("HomeView");

/**
 * Home view with session context and recent activity.
 *
 * - Shows vault name and debrief action buttons
 * - Displays goals, inspiration, and recent activity
 */
export function HomeView(): React.ReactNode {
  const {
    vault,
    setRecentNotes,
    setRecentDiscussions,
    setGoals,
    removeDiscussion,
  } = useSession();

  log.debug(`Render - vault: ${vault?.id}`);

  // REST API hooks
  const { getRecentActivity } = useCapture(vault?.id);
  const { getGoals, getInspiration, getDailyPrepStatus } = useHome(vault?.id);
  const { deleteSession } = useSessions(vault?.id);

  // Loading states
  const [inspirationLoading, setInspirationLoading] = useState(true);
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [dailyPrepLoading, setDailyPrepLoading] = useState(true);

  // Inspiration state
  const [inspirationContextual, setInspirationContextual] =
    useState<InspirationItem | null>(null);
  const [inspirationQuote, setInspirationQuote] =
    useState<InspirationItem | null>(null);

  // Daily prep status
  const [dailyPrepStatus, setDailyPrepStatus] =
    useState<DailyPrepStatusResponse | null>(null);

  // Callback to delete a session (now uses REST API)
  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      void deleteSession(sessionId).then((success) => {
        if (success) {
          removeDiscussion(sessionId);
        }
      });
    },
    [deleteSession, removeDiscussion]
  );

  // Load data via REST API when vault.id changes
  useEffect(() => {
    log.debug(`Effect triggered - vault?.id: ${vault?.id}`);
    if (!vault?.id) {
      log.debug("No vault.id, skipping data load");
      return;
    }

    log.debug(`Loading data for vault: ${vault.id}`);

    // Reset loading states for new vault
    setActivityLoading(true);
    setGoalsLoading(true);
    setInspirationLoading(true);
    setDailyPrepLoading(true);

    // Load recent activity
    getRecentActivity()
      .then((activity) => {
        log.debug("Recent activity loaded");
        if (activity) {
          setRecentNotes(activity.captures);
          setRecentDiscussions(activity.discussions);
        }
        setActivityLoading(false);
      })
      .catch((err) => {
        log.error("Failed to load activity", err);
        setActivityLoading(false);
      });

    // Load goals (only if vault has goalsPath)
    if (vault.goalsPath) {
      getGoals()
        .then((content) => {
          log.debug("Goals loaded");
          if (content !== null) {
            setGoals(content);
          }
          setGoalsLoading(false);
        })
        .catch((err) => {
          log.error("Failed to load goals", err);
          setGoalsLoading(false);
        });
    } else {
      setGoalsLoading(false);
    }

    // Load inspiration
    getInspiration()
      .then((result) => {
        log.debug("Inspiration loaded");
        if (result) {
          setInspirationContextual(result.contextual);
          setInspirationQuote(result.quote);
        }
        setInspirationLoading(false);
      })
      .catch((err) => {
        log.error("Failed to load inspiration", err);
        setInspirationLoading(false);
      });

    // Load daily prep status
    getDailyPrepStatus()
      .then((status) => {
        log.debug("Daily prep status loaded");
        setDailyPrepStatus(status);
        setDailyPrepLoading(false);
      })
      .catch((err) => {
        log.error("Failed to load daily prep status", err);
        setDailyPrepLoading(false);
      });
  }, [
    vault?.id,
    vault?.goalsPath,
    getRecentActivity,
    getGoals,
    getInspiration,
    getDailyPrepStatus,
    setRecentNotes,
    setRecentDiscussions,
    setGoals,
  ]);

  return (
    <div className="home-view">
      {/* Context Cards Row - VaultInfo + SessionActions */}
      <div className="home-view__context-row">
        <VaultInfoCard name={vault?.name} subtitle={vault?.subtitle} />
        <SessionActionsCard
          dailyPrepStatus={dailyPrepStatus}
          isLoading={dailyPrepLoading}
        />
      </div>

      {/* Inspiration - always rendered, shows skeleton when loading */}
      <InspirationCard
        contextual={inspirationContextual}
        quote={inspirationQuote}
        isLoading={inspirationLoading}
      />

      {/* Spaced Repetition - shows idle state when no cards due */}
      <SpacedRepetitionWidget vaultId={vault?.id} />

      {/* Goals */}
      <GoalsCard isLoading={goalsLoading} />

      {/* Recent Activity */}
      <RecentActivity isLoading={activityLoading} onDeleteSession={handleDeleteSession} />
    </div>
  );
}

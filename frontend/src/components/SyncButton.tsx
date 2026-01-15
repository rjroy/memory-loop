/**
 * SyncButton Component
 *
 * Button to trigger external data sync and display sync status.
 * REQ-F-30: Sync button in Ground tab
 * REQ-F-31: Button shows sync status: idle, syncing, success, error
 * REQ-F-32: Error state shows brief message (e.g., "3 files failed to sync")
 */

import React, { useCallback } from "react";
import { useSession, type SyncStatusValue } from "../contexts/SessionContext";
import { useWebSocket } from "../hooks/useWebSocket";
import "./SyncButton.css";

/**
 * Gets the display label for a sync status.
 */
function getStatusLabel(
  status: SyncStatusValue,
  progress: { current: number; total: number; currentFile?: string } | null,
  errorCount: number
): string {
  switch (status) {
    case "syncing":
      if (progress && progress.total > 0) {
        return `Syncing... ${progress.current}/${progress.total}`;
      }
      return "Syncing...";
    case "success":
      return "Synced";
    case "error":
      if (errorCount > 0) {
        return `${errorCount} file${errorCount > 1 ? "s" : ""} failed`;
      }
      return "Sync failed";
    case "idle":
    default:
      return "Sync External Data";
  }
}

/**
 * Gets the aria-label for accessibility based on sync status.
 */
function getAriaLabel(
  status: SyncStatusValue,
  progress: { current: number; total: number; currentFile?: string } | null,
  errorCount: number
): string {
  switch (status) {
    case "syncing":
      if (progress && progress.total > 0) {
        const fileInfo = progress.currentFile
          ? `, currently processing ${progress.currentFile}`
          : "";
        return `Syncing external data, ${progress.current} of ${progress.total} files processed${fileInfo}`;
      }
      return "Syncing external data";
    case "success":
      return "External data sync completed successfully";
    case "error":
      if (errorCount > 0) {
        return `External data sync completed with ${errorCount} error${errorCount > 1 ? "s" : ""}. Click to retry.`;
      }
      return "External data sync failed. Click to retry.";
    case "idle":
    default:
      return "Click to sync external data from configured pipelines";
  }
}

/**
 * SyncButton displays sync status and triggers manual sync.
 *
 * - Shows different visual states for idle, syncing, success, error
 * - Disabled during active sync
 * - Touch-friendly with 44px minimum tap target
 */
export function SyncButton(): React.ReactNode {
  const { sync } = useSession();
  const { sendMessage } = useWebSocket();

  const handleClick = useCallback(() => {
    // Don't trigger if already syncing
    if (sync.status === "syncing") {
      return;
    }

    // Trigger incremental sync by default
    // Full sync could be triggered with a long-press or menu option in future
    sendMessage({ type: "trigger_sync", mode: "incremental" });
  }, [sync.status, sendMessage]);

  const isSyncing = sync.status === "syncing";
  const label = getStatusLabel(sync.status, sync.progress, sync.errorCount);
  const ariaLabel = getAriaLabel(sync.status, sync.progress, sync.errorCount);

  return (
    <button
      type="button"
      className={`sync-button sync-button--${sync.status}`}
      onClick={handleClick}
      disabled={isSyncing}
      aria-label={ariaLabel}
      aria-busy={isSyncing}
    >
      <span className="sync-button__icon" aria-hidden="true">
        {sync.status === "syncing" ? "⟳" : sync.status === "success" ? "✓" : sync.status === "error" ? "!" : "↻"}
      </span>
      <span className="sync-button__label">{label}</span>
      {isSyncing && sync.progress && sync.progress.total > 0 && (
        <span
          className="sync-button__progress"
          role="progressbar"
          aria-valuenow={sync.progress.current}
          aria-valuemin={0}
          aria-valuemax={sync.progress.total}
          style={
            {
              "--progress-percent": `${(sync.progress.current / sync.progress.total) * 100}%`,
            } as React.CSSProperties
          }
        />
      )}
    </button>
  );
}

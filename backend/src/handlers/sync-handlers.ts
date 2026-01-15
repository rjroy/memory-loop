/**
 * Sync Pipeline Handlers
 *
 * Handles external data sync operations:
 * - trigger_sync: Manual trigger for sync pipelines
 *
 * Spec Requirements:
 * - REQ-F-16: User triggers sync via button press (manual only)
 * - REQ-F-17: No automatic/scheduled sync
 * - REQ-F-30: Status messages include: idle, syncing, success, error
 * - REQ-F-31: "syncing" status includes progress (X/Y files, current file name)
 * - REQ-F-32: "error" status lists which files failed
 */

import type { HandlerContext } from "./types.js";
import { requireVault } from "./types.js";
import { createSyncPipelineManager, type SyncMode, type SyncProgress } from "../sync/sync-pipeline.js";
import { wsLog as log } from "../logger.js";

/** Health issue ID for sync errors */
const SYNC_ERROR_ID = "sync_error";

/**
 * Handles trigger_sync message.
 * Initiates a sync of external data pipelines for the selected vault.
 *
 * @param ctx - Handler context with connection state and send utilities
 * @param mode - Sync mode: "full" re-syncs all, "incremental" skips recent
 * @param pipeline - Optional specific pipeline to sync (omit for all)
 */
export async function handleTriggerSync(
  ctx: HandlerContext,
  mode: SyncMode,
  pipeline?: string
): Promise<void> {
  log.info(`Triggering ${mode} sync${pipeline ? ` for pipeline: ${pipeline}` : ""}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for sync");
    return;
  }

  // Send initial syncing status
  ctx.send({
    type: "sync_status",
    status: "syncing",
    progress: { current: 0, total: 0 },
    message: "Starting sync...",
  });

  try {
    const manager = createSyncPipelineManager();

    // Progress callback sends updates to client
    const onProgress = (progress: SyncProgress): void => {
      ctx.send({
        type: "sync_status",
        status: progress.status === "success" || progress.status === "error" ? progress.status : "syncing",
        progress: {
          current: progress.current,
          total: progress.total,
          currentFile: progress.currentFile,
        },
        message:
          progress.status === "syncing"
            ? `Processing ${progress.current}/${progress.total}${progress.currentFile ? `: ${progress.currentFile}` : ""}`
            : undefined,
        errors:
          progress.errors.length > 0
            ? progress.errors.map((e) => ({ file: e.file, error: e.message }))
            : undefined,
      });
    };

    const result = await manager.sync({
      vaultRoot: ctx.state.currentVault.path,
      mode,
      pipeline,
      onProgress,
    });

    // Send final status
    const hasErrors = result.errors.length > 0;
    const status = hasErrors ? "error" : "success";
    const message = hasErrors
      ? `Synced with ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`
      : `Synced ${result.filesUpdated} of ${result.filesProcessed} files`;

    log.info(`Sync completed: ${message} (${result.duration}ms)`);

    // Report to health collector on errors, resolve on success
    if (hasErrors) {
      const errorDetails = result.errors
        .map((e) => `${e.file || "Pipeline"}: ${e.message}`)
        .join("\n");
      ctx.state.healthCollector?.report({
        id: SYNC_ERROR_ID,
        severity: "error",
        category: "sync",
        message: `External data sync failed for ${result.errors.length} file${result.errors.length === 1 ? "" : "s"}`,
        details: errorDetails,
        dismissible: true,
      });
    } else {
      // Resolve any previous sync error on success
      ctx.state.healthCollector?.resolve(SYNC_ERROR_ID);
    }

    ctx.send({
      type: "sync_status",
      status,
      progress: {
        current: result.filesProcessed,
        total: result.filesProcessed,
      },
      message,
      errors:
        hasErrors
          ? result.errors.map((e) => ({ file: e.file, error: e.message }))
          : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed unexpectedly";
    log.error(`Sync failed: ${message}`);

    // Report critical sync failure to health collector
    ctx.state.healthCollector?.report({
      id: SYNC_ERROR_ID,
      severity: "error",
      category: "sync",
      message: "External data sync failed",
      details: message,
      dismissible: true,
    });

    ctx.send({
      type: "sync_status",
      status: "error",
      message: `Sync failed: ${message}`,
      errors: [{ file: "", error: message }],
    });
  }
}

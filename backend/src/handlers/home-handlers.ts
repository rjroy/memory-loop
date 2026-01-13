/**
 * Home/Dashboard Handlers
 *
 * Handles home screen and dashboard data operations:
 * - capture_note: Capture text to daily note
 * - get_recent_notes: Recent captured notes
 * - get_recent_activity: Combined notes and discussions
 * - get_goals: Vault goals from goals.md
 * - get_inspiration: Contextual prompts and quotes
 * - get_tasks: Tasks from configured directories
 * - toggle_task: Toggle task completion state
 */

import type { HandlerContext } from "./types.js";
import { requireVault } from "./types.js";
import { captureToDaily, getRecentNotes } from "../note-capture.js";
import { getVaultGoals } from "../vault-manager.js";
import { getInspiration } from "../inspiration-manager.js";
import { getAllTasks, toggleTask } from "../task-manager.js";
import { getRecentSessions } from "../session-manager.js";
import {
  loadVaultConfig,
  resolveRecentCaptures,
  resolveRecentDiscussions,
} from "../vault-config.js";
import { FileBrowserError } from "../file-browser.js";
import { wsLog as log } from "../logger.js";

/**
 * Handles capture_note message.
 * Captures text to the daily note in the selected vault.
 */
export async function handleCaptureNote(
  ctx: HandlerContext,
  text: string
): Promise<void> {
  log.info(`Capturing note (${text.length} chars)`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for note capture");
    return;
  }

  try {
    const result = await captureToDaily(ctx.state.currentVault, text);

    if (!result.success) {
      log.error("Note capture failed", result.error);
      ctx.sendError("NOTE_CAPTURE_FAILED", result.error ?? "Failed to capture note");
      return;
    }

    log.info(`Note captured at ${result.timestamp}`);
    ctx.send({
      type: "note_captured",
      timestamp: result.timestamp,
    });
  } catch (error) {
    log.error("Note capture threw", error);
    const message = error instanceof Error ? error.message : "Failed to capture note";
    ctx.sendError("NOTE_CAPTURE_FAILED", message);
  }
}

/**
 * Handles get_recent_notes message.
 * Returns recent captured notes from the vault inbox.
 */
export async function handleGetRecentNotes(ctx: HandlerContext): Promise<void> {
  log.info("Getting recent notes");

  if (!requireVault(ctx)) {
    log.warn("No vault selected for recent notes");
    return;
  }

  try {
    const notes = await getRecentNotes(ctx.state.currentVault, 5);
    log.info(`Found ${notes.length} recent notes`);
    ctx.send({
      type: "recent_notes",
      notes,
    });
  } catch (error) {
    log.error("Failed to get recent notes", error);
    const message = error instanceof Error ? error.message : "Failed to get recent notes";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles get_recent_activity message.
 * Returns both recent captured notes and recent discussions.
 */
export async function handleGetRecentActivity(ctx: HandlerContext): Promise<void> {
  log.info("Getting recent activity");

  if (!requireVault(ctx)) {
    log.warn("No vault selected for recent activity");
    return;
  }

  try {
    const config = await loadVaultConfig(ctx.state.currentVault.path);
    const capturesLimit = resolveRecentCaptures(config);
    const discussionsLimit = resolveRecentDiscussions(config);

    const [captures, discussions] = await Promise.all([
      getRecentNotes(ctx.state.currentVault, capturesLimit),
      getRecentSessions(ctx.state.currentVault.path, discussionsLimit),
    ]);
    log.info(`Found ${captures.length} captures and ${discussions.length} discussions`);
    ctx.send({
      type: "recent_activity",
      captures,
      discussions,
    });
  } catch (error) {
    log.error("Failed to get recent activity", error);
    const message = error instanceof Error ? error.message : "Failed to get recent activity";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles get_goals message.
 * Returns goals from the vault's goals.md file.
 */
export async function handleGetGoals(ctx: HandlerContext): Promise<void> {
  log.info("Getting goals");

  if (!requireVault(ctx)) {
    log.warn("No vault selected for goals");
    return;
  }

  try {
    const content = await getVaultGoals(ctx.state.currentVault);
    log.info(`Goals content: ${content ? `${content.length} chars` : "null"}`);
    ctx.send({
      type: "goals",
      content,
    });
  } catch (error) {
    log.error("Failed to get goals", error);
    const message = error instanceof Error ? error.message : "Failed to get goals";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles get_inspiration message.
 * Returns contextual prompt and inspirational quote.
 * Errors are logged but not sent to client (inspiration is optional).
 */
export async function handleGetInspiration(ctx: HandlerContext): Promise<void> {
  log.info("Getting inspiration");

  if (!requireVault(ctx)) {
    log.warn("No vault selected for inspiration");
    return;
  }

  try {
    const result = await getInspiration(ctx.state.currentVault);
    log.info(
      `Inspiration fetched: contextual=${result.contextual !== null}, quote="${result.quote.text.slice(0, 30)}..."`
    );
    ctx.send({
      type: "inspiration",
      contextual: result.contextual,
      quote: result.quote,
    });
  } catch (error) {
    // Log errors but don't send error response - inspiration is optional
    log.error("Failed to get inspiration (continuing silently)", error);
    // Don't send error to client per REQ-NF-3 (graceful degradation)
  }
}

/**
 * Handles get_tasks message.
 * Returns all tasks from configured directories (inbox, projects, areas).
 */
export async function handleGetTasks(ctx: HandlerContext): Promise<void> {
  log.info("Getting tasks");

  if (!requireVault(ctx)) {
    log.warn("No vault selected for tasks");
    return;
  }

  try {
    const config = await loadVaultConfig(ctx.state.currentVault.path);
    const result = await getAllTasks(ctx.state.currentVault.contentRoot, config);
    log.info(`Found ${result.total} tasks (${result.incomplete} incomplete)`);
    ctx.send({
      type: "tasks",
      tasks: result.tasks,
      incomplete: result.incomplete,
      total: result.total,
    });
  } catch (error) {
    log.error("Failed to get tasks", error);
    const message = error instanceof Error ? error.message : "Failed to get tasks";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles toggle_task message.
 * If newState is provided, sets to that state. Otherwise cycles through states.
 */
export async function handleToggleTask(
  ctx: HandlerContext,
  filePath: string,
  lineNumber: number,
  newState?: string
): Promise<void> {
  log.info(`Toggling task: ${filePath}:${lineNumber}${newState ? ` -> '${newState}'` : ""}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for task toggle");
    return;
  }

  try {
    const result = await toggleTask(
      ctx.state.currentVault.contentRoot,
      filePath,
      lineNumber,
      newState
    );

    if (!result.success) {
      log.warn(`Task toggle failed: ${result.error}`);
      let errorCode: "PATH_TRAVERSAL" | "FILE_NOT_FOUND" | "INTERNAL_ERROR" = "INTERNAL_ERROR";
      if (result.error?.includes("Path outside") || result.error?.includes("path traversal")) {
        errorCode = "PATH_TRAVERSAL";
      } else if (result.error?.includes("not found") || result.error?.includes("File not found")) {
        errorCode = "FILE_NOT_FOUND";
      }
      ctx.sendError(errorCode, result.error ?? "Failed to toggle task");
      return;
    }

    log.info(`Task toggled: ${filePath}:${lineNumber} -> '${result.newState}'`);
    ctx.send({
      type: "task_toggled",
      filePath,
      lineNumber,
      newState: result.newState!,
    });
  } catch (error) {
    log.error("Failed to toggle task", error);
    if (error instanceof FileBrowserError) {
      ctx.sendError(error.code, error.message);
    } else {
      const message = error instanceof Error ? error.message : "Failed to toggle task";
      ctx.sendError("INTERNAL_ERROR", message);
    }
  }
}

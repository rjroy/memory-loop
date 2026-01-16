/**
 * Meeting Capture Handlers
 *
 * Handles meeting capture operations:
 * - start_meeting: Start a new meeting capture session
 * - stop_meeting: End the current meeting and return content
 * - get_meeting_state: Query current meeting state
 *
 * Also integrates with capture_note to route to meeting file when active.
 *
 * Meeting state is stored globally per-vault (not per-connection) so it
 * persists across WebSocket reconnections when users switch tabs.
 */

import type { HandlerContext } from "./types.js";
import { requireVault } from "./types.js";
import {
  startMeeting,
  stopMeeting,
  captureToMeeting,
  toMeetingState,
} from "../meeting-capture.js";
import {
  getActiveMeeting,
  setActiveMeeting,
  clearActiveMeeting,
  incrementMeetingEntryCount,
} from "../meeting-store.js";
import { wsLog as log } from "../logger.js";

/**
 * Handles start_meeting message.
 * Creates a new meeting file and activates meeting capture mode.
 */
export async function handleStartMeeting(
  ctx: HandlerContext,
  title: string
): Promise<void> {
  log.info(`Starting meeting: "${title}"`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for start_meeting");
    return;
  }

  const vaultId = ctx.state.currentVault.id;

  // Check if a meeting is already active (check global store)
  const existingMeeting = getActiveMeeting(vaultId);
  if (existingMeeting) {
    log.warn("Meeting already in progress");
    ctx.sendError(
      "VALIDATION_ERROR",
      `A meeting is already in progress: "${existingMeeting.title}". Stop it first.`
    );
    return;
  }

  try {
    const result = await startMeeting(ctx.state.currentVault, title);

    if (!result.success || !result.meeting) {
      log.error("Failed to start meeting", result.error);
      ctx.sendError("INTERNAL_ERROR", result.error ?? "Failed to start meeting");
      return;
    }

    // Store active meeting in global store (persists across reconnections)
    setActiveMeeting(vaultId, result.meeting);
    // Also cache in connection state for quick access
    ctx.state.activeMeeting = result.meeting;

    log.info(`Meeting started: ${result.meeting.relativePath}`);
    ctx.send({
      type: "meeting_started",
      title: result.meeting.title,
      filePath: result.meeting.relativePath,
      startedAt: result.meeting.startedAt,
    });
  } catch (error) {
    log.error("start_meeting threw", error);
    const message = error instanceof Error ? error.message : "Failed to start meeting";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles stop_meeting message.
 * Ends the current meeting and returns file content for Claude Code.
 */
export async function handleStopMeeting(ctx: HandlerContext): Promise<void> {
  log.info("Stopping meeting");

  if (!requireVault(ctx)) {
    log.warn("No vault selected for stop_meeting");
    return;
  }

  const vaultId = ctx.state.currentVault.id;

  // Check if a meeting is active (check global store, fall back to connection state)
  const activeMeeting = getActiveMeeting(vaultId) ?? ctx.state.activeMeeting;
  if (!activeMeeting) {
    log.warn("No meeting in progress");
    ctx.sendError("VALIDATION_ERROR", "No meeting is currently in progress.");
    return;
  }

  try {
    const result = await stopMeeting(activeMeeting);

    if (!result.success) {
      log.error("Failed to stop meeting", result.error);
      ctx.sendError("INTERNAL_ERROR", result.error ?? "Failed to stop meeting");
      return;
    }

    const filePath = activeMeeting.relativePath;

    // Clear active meeting from global store and connection state
    clearActiveMeeting(vaultId);
    ctx.state.activeMeeting = null;

    log.info(`Meeting stopped: ${filePath} (${result.entryCount} entries)`);
    ctx.send({
      type: "meeting_stopped",
      filePath,
      content: result.content ?? "",
      entryCount: result.entryCount ?? 0,
    });
  } catch (error) {
    log.error("stop_meeting threw", error);
    const message = error instanceof Error ? error.message : "Failed to stop meeting";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles get_meeting_state message.
 * Returns current meeting state (active or inactive).
 */
export function handleGetMeetingState(ctx: HandlerContext): void {
  log.info("Getting meeting state");

  if (!requireVault(ctx)) {
    log.warn("No vault selected for get_meeting_state");
    return;
  }

  const vaultId = ctx.state.currentVault.id;

  // Check global store for meeting state (persists across reconnections)
  const activeMeeting = getActiveMeeting(vaultId);

  // Sync connection state with global store
  if (activeMeeting && !ctx.state.activeMeeting) {
    ctx.state.activeMeeting = activeMeeting;
  }

  const state = toMeetingState(activeMeeting);
  log.info(`Meeting state: isActive=${state.isActive}`);

  ctx.send({
    type: "meeting_state",
    state,
  });
}

/**
 * Handles capture_note when a meeting is active.
 * Routes the capture to the meeting file instead of daily note.
 *
 * @returns true if capture was handled (meeting active), false otherwise
 */
export async function handleMeetingCapture(
  ctx: HandlerContext,
  text: string
): Promise<boolean> {
  if (!ctx.state.currentVault) {
    return false;
  }

  const vaultId = ctx.state.currentVault.id;

  // Check global store for active meeting (persists across reconnections)
  const activeMeeting = getActiveMeeting(vaultId) ?? ctx.state.activeMeeting;

  // Not in meeting mode, let normal capture handle it
  if (!activeMeeting) {
    return false;
  }

  // Sync connection state with global store
  if (!ctx.state.activeMeeting) {
    ctx.state.activeMeeting = activeMeeting;
  }

  log.info(`Capturing to meeting (${text.length} chars)`);

  try {
    const result = await captureToMeeting(activeMeeting, text);

    if (!result.success) {
      log.error("Meeting capture failed", result.error);
      ctx.sendError("NOTE_CAPTURE_FAILED", result.error ?? "Failed to capture note");
      return true; // We handled it, even though it failed
    }

    // Update entry count in global store
    incrementMeetingEntryCount(vaultId);

    log.info(`Note captured to meeting at ${result.timestamp}`);
    ctx.send({
      type: "note_captured",
      timestamp: result.timestamp ?? new Date().toISOString(),
    });

    return true;
  } catch (error) {
    log.error("Meeting capture threw", error);
    const message = error instanceof Error ? error.message : "Failed to capture note";
    ctx.sendError("NOTE_CAPTURE_FAILED", message);
    return true;
  }
}

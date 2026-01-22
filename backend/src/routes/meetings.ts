/**
 * Meeting REST Routes
 *
 * REST endpoints for meeting management. Allows starting, stopping, and
 * querying meeting state via REST API instead of WebSocket.
 *
 * Routes:
 * - POST /api/vaults/:vaultId/meetings → Start a new meeting (REQ-F-23)
 * - DELETE /api/vaults/:vaultId/meetings/current → Stop current meeting (REQ-F-24)
 * - GET /api/vaults/:vaultId/meetings/current → Get meeting state (REQ-F-25)
 *
 * All routes use vault resolution middleware for :vaultId parameter.
 */

import { Hono } from "hono";
import { z } from "zod";
import { getVaultFromContext, jsonError } from "../middleware/vault-resolution";
import {
  startMeeting,
  stopMeeting,
  toMeetingState,
} from "../meeting-capture";
import {
  getActiveMeeting,
  setActiveMeeting,
  clearActiveMeeting,
} from "../meeting-store";
import { createLogger } from "../logger";

const log = createLogger("MeetingRoutes");

/**
 * Schema for POST /meetings request body.
 * Requires a meeting title to start a new meeting.
 */
const StartMeetingRequestSchema = z.object({
  title: z.string().min(1, "Meeting title is required"),
});

/**
 * Response type for successful meeting start.
 */
interface MeetingStartedResponse {
  title: string;
  filePath: string;
  startedAt: string;
}

/**
 * Response type for successful meeting stop.
 */
interface MeetingStoppedResponse {
  filePath: string;
  content: string;
  entryCount: number;
}

/**
 * Response type for meeting state query.
 */
interface MeetingStateResponse {
  isActive: boolean;
  title?: string;
  filePath?: string;
  startedAt?: string;
}

/**
 * Hono router for meeting management endpoints.
 *
 * These routes are mounted under /api/vaults/:vaultId/meetings
 * with vault resolution middleware already applied.
 */
const meetingRoutes = new Hono();

/**
 * POST /meetings - Start a new meeting
 *
 * Creates a new meeting file and sets the vault to meeting capture mode.
 * Subsequent captures will route to the meeting file instead of daily notes.
 *
 * Request body:
 * - title: string (required) - Meeting title for filename and frontmatter
 *
 * Response:
 * - 200: Meeting started successfully
 * - 400: Invalid request (missing title or meeting already active)
 * - 500: Internal error (filesystem failure)
 */
meetingRoutes.post("/", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`POST /meetings for vault ${vault.id}`);

  // Parse and validate request body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const parseResult = StartMeetingRequestSchema.safeParse(body);
  if (!parseResult.success) {
    const errorMessage = parseResult.error.issues
      .map((issue) => issue.message)
      .join(", ");
    return jsonError(c, 400, "VALIDATION_ERROR", errorMessage);
  }

  const { title } = parseResult.data;

  // Check if a meeting is already active for this vault
  const existingMeeting = getActiveMeeting(vault.id);
  if (existingMeeting) {
    log.warn(`Meeting already in progress for vault ${vault.id}`);
    return jsonError(
      c,
      400,
      "VALIDATION_ERROR",
      `A meeting is already in progress: "${existingMeeting.title}". Stop it first.`
    );
  }

  // Start the meeting
  try {
    const result = await startMeeting(vault, title);

    if (!result.success || !result.meeting) {
      log.error(`Failed to start meeting: ${result.error}`);
      return jsonError(
        c,
        500,
        "INTERNAL_ERROR",
        result.error ?? "Failed to start meeting"
      );
    }

    // Store active meeting in global store
    setActiveMeeting(vault.id, result.meeting);

    log.info(`Meeting started: ${result.meeting.relativePath}`);

    const response: MeetingStartedResponse = {
      title: result.meeting.title,
      filePath: result.meeting.relativePath,
      startedAt: result.meeting.startedAt,
    };

    return c.json(response, 200);
  } catch (error) {
    log.error("start_meeting threw", error);
    const message =
      error instanceof Error ? error.message : "Failed to start meeting";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * DELETE /meetings/current - Stop the current meeting
 *
 * Ends the current meeting capture session and returns to normal daily note mode.
 * Returns the full file content for Claude Code integration.
 *
 * Response:
 * - 200: Meeting stopped successfully (includes file content)
 * - 404: No meeting in progress
 * - 500: Internal error (filesystem failure)
 */
meetingRoutes.delete("/current", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`DELETE /meetings/current for vault ${vault.id}`);

  // Check if a meeting is active for this vault
  const activeMeeting = getActiveMeeting(vault.id);
  if (!activeMeeting) {
    log.warn(`No meeting in progress for vault ${vault.id}`);
    return jsonError(
      c,
      404,
      "VALIDATION_ERROR",
      "No meeting is currently in progress."
    );
  }

  // Stop the meeting
  try {
    const result = await stopMeeting(activeMeeting);

    if (!result.success) {
      log.error(`Failed to stop meeting: ${result.error}`);
      return jsonError(
        c,
        500,
        "INTERNAL_ERROR",
        result.error ?? "Failed to stop meeting"
      );
    }

    const filePath = activeMeeting.relativePath;

    // Clear active meeting from global store
    clearActiveMeeting(vault.id);

    log.info(`Meeting stopped: ${filePath} (${result.entryCount} entries)`);

    const response: MeetingStoppedResponse = {
      filePath,
      content: result.content ?? "",
      entryCount: result.entryCount ?? 0,
    };

    return c.json(response, 200);
  } catch (error) {
    log.error("stop_meeting threw", error);
    const message =
      error instanceof Error ? error.message : "Failed to stop meeting";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * GET /meetings/current - Get current meeting state
 *
 * Returns the current meeting state for the vault. Used to sync
 * state after reconnection or to check if a meeting is active.
 *
 * Response:
 * - 200: Meeting state (isActive: true/false with optional details)
 */
meetingRoutes.get("/current", (c) => {
  const vault = getVaultFromContext(c);
  log.info(`GET /meetings/current for vault ${vault.id}`);

  // Get meeting state from global store
  const activeMeeting = getActiveMeeting(vault.id);
  const state = toMeetingState(activeMeeting);

  log.info(`Meeting state for vault ${vault.id}: isActive=${state.isActive}`);

  const response: MeetingStateResponse = {
    isActive: state.isActive,
    ...(state.title && { title: state.title }),
    ...(state.filePath && { filePath: state.filePath }),
    ...(state.startedAt && { startedAt: state.startedAt }),
  };

  return c.json(response, 200);
});

export { meetingRoutes };

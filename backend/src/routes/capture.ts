/**
 * Capture REST Routes
 *
 * REST endpoints for note capture and recent activity operations.
 * Wraps existing note-capture.ts and session-manager.ts functions.
 *
 * Requirements:
 * - REQ-F-16: `POST /api/vaults/:vaultId/capture` for note capture
 * - REQ-F-17: `GET /api/vaults/:vaultId/recent-notes` for recent notes list
 * - REQ-F-18: `GET /api/vaults/:vaultId/recent-activity` for combined activity
 * - REQ-F-64: Share business logic with WebSocket handlers (no duplication)
 * - REQ-NF-3: Response schemas match existing WebSocket response schemas
 */

import { Hono } from "hono";
import { z } from "zod";
import { getVaultFromContext, jsonError } from "../middleware/vault-resolution";
import { captureToDaily, getRecentNotes, NoteCaptureError } from "../note-capture";
import { captureToMeeting, MeetingCaptureError } from "../meeting-capture";
import { getActiveMeeting, incrementMeetingEntryCount } from "../meeting-store";
import { getRecentSessions } from "../session-manager";
import { loadVaultConfig, resolveRecentCaptures, resolveRecentDiscussions } from "../vault-config";
import { createLogger } from "../logger";

const log = createLogger("CaptureRoutes");

/**
 * Request body schema for POST /capture
 */
const CaptureRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
});

/**
 * Hono router for capture-related REST endpoints.
 *
 * All routes expect vault resolution middleware to have run,
 * setting vault info in context.
 */
const captureRoutes = new Hono();

/**
 * POST /capture
 *
 * Captures text to today's daily note in the vault.
 * Request body: { text: string }
 * Response: { success: boolean, timestamp: string, notePath: string }
 *
 * Implements REQ-F-16.
 */
captureRoutes.post("/capture", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`Capture request for vault ${vault.id}`);

  // Parse and validate request body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const parseResult = CaptureRequestSchema.safeParse(body);
  if (!parseResult.success) {
    const errorMessage = parseResult.error.issues.map((e) => e.message).join(", ");
    return jsonError(c, 400, "VALIDATION_ERROR", errorMessage);
  }

  const { text } = parseResult.data;

  // Check for active meeting - route to meeting file if one exists
  const activeMeeting = getActiveMeeting(vault.id);

  try {
    if (activeMeeting) {
      // Capture to meeting file
      log.info(`Routing capture to meeting: ${activeMeeting.title}`);
      const result = await captureToMeeting(activeMeeting, text);

      if (!result.success) {
        log.error(`Meeting capture failed for vault ${vault.id}: ${result.error}`);
        return jsonError(c, 500, "NOTE_CAPTURE_FAILED", result.error ?? "Failed to capture note");
      }

      // Keep global meeting state in sync
      incrementMeetingEntryCount(vault.id);

      log.info(`Note captured to meeting in vault ${vault.id} at ${result.timestamp}`);
      return c.json({
        success: true,
        timestamp: result.timestamp,
        notePath: activeMeeting.relativePath,
      });
    } else {
      // Capture to daily note
      const result = await captureToDaily(vault, text);

      if (!result.success) {
        log.error(`Capture failed for vault ${vault.id}: ${result.error}`);
        return jsonError(c, 500, "NOTE_CAPTURE_FAILED", result.error ?? "Failed to capture note");
      }

      log.info(`Note captured in vault ${vault.id} at ${result.timestamp}`);
      return c.json({
        success: result.success,
        timestamp: result.timestamp,
        notePath: result.notePath,
      });
    }
  } catch (error) {
    log.error(`Capture threw for vault ${vault.id}`, error);
    if (error instanceof NoteCaptureError || error instanceof MeetingCaptureError) {
      return jsonError(c, 500, "NOTE_CAPTURE_FAILED", error.message);
    }
    const message = error instanceof Error ? error.message : "Failed to capture note";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * GET /recent-notes
 *
 * Returns recent captured notes from the vault inbox.
 * Query params: limit (optional, default 5)
 * Response: { notes: RecentNoteEntry[] }
 *
 * Implements REQ-F-17.
 */
captureRoutes.get("/recent-notes", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`Recent notes request for vault ${vault.id}`);

  // Parse optional limit query param
  const limitParam = c.req.query("limit");
  let limit = 5;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 100) {
      return jsonError(c, 400, "VALIDATION_ERROR", "limit must be a number between 1 and 100");
    }
    limit = parsed;
  }

  try {
    const notes = await getRecentNotes(vault, limit);
    log.info(`Found ${notes.length} recent notes in vault ${vault.id}`);
    return c.json({ notes });
  } catch (error) {
    log.error(`Failed to get recent notes for vault ${vault.id}`, error);
    const message = error instanceof Error ? error.message : "Failed to get recent notes";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * GET /recent-activity
 *
 * Returns combined recent activity: captures and discussions.
 * Uses vault config for limit settings.
 * Response: { captures: RecentNoteEntry[], discussions: RecentDiscussionEntry[] }
 *
 * Implements REQ-F-18.
 */
captureRoutes.get("/recent-activity", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`Recent activity request for vault ${vault.id}`);

  try {
    // Load vault config for limit settings
    const config = await loadVaultConfig(vault.path);
    const capturesLimit = resolveRecentCaptures(config);
    const discussionsLimit = resolveRecentDiscussions(config);

    // Fetch captures and discussions in parallel
    const [captures, discussions] = await Promise.all([
      getRecentNotes(vault, capturesLimit),
      getRecentSessions(vault.path, discussionsLimit),
    ]);

    log.info(
      `Found ${captures.length} captures and ${discussions.length} discussions in vault ${vault.id}`
    );

    return c.json({ captures, discussions });
  } catch (error) {
    log.error(`Failed to get recent activity for vault ${vault.id}`, error);
    const message = error instanceof Error ? error.message : "Failed to get recent activity";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

export { captureRoutes };

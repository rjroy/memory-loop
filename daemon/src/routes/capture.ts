/**
 * Capture API route handlers.
 *
 * Handles text capture (to daily notes or active meetings),
 * recent notes retrieval, and recent activity.
 */

import { createLogger } from "@memory-loop/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getCachedVaultById } from "../vault";
import { captureToDaily, getRecentNotes } from "../files/note-capture";
import { captureToMeeting } from "../files/meeting-capture";
import { getActiveMeeting, incrementMeetingEntryCount } from "../files/meeting-store";

const log = createLogger("capture-routes");

function jsonError(
  c: Context,
  error: string,
  code: string,
  status: ContentfulStatusCode,
  detail?: string,
): Response {
  return c.json({ error, code, ...(detail ? { detail } : {}) }, status);
}

/**
 * POST /vaults/:id/capture - Capture text.
 *
 * If a meeting is active for this vault, routes to the meeting file.
 * Otherwise captures to the daily note.
 */
export async function captureHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null || !("text" in body)) {
    return jsonError(c, "Missing required field: text", "INVALID_REQUEST", 400);
  }

  const { text } = body as { text: unknown };
  if (typeof text !== "string" || text.trim().length === 0) {
    return jsonError(c, "text must be a non-empty string", "INVALID_REQUEST", 400);
  }

  // Check for active meeting
  const activeMeeting = getActiveMeeting(vaultId);
  if (activeMeeting) {
    const result = await captureToMeeting(activeMeeting, text);
    if (!result.success) {
      return jsonError(c, result.error ?? "Capture failed", "CAPTURE_FAILED", 500);
    }
    incrementMeetingEntryCount(vaultId);
    return c.json({ ...result, target: "meeting" });
  }

  // Capture to daily note
  const result = await captureToDaily(vault, text);
  if (!result.success) {
    return jsonError(c, result.error ?? "Capture failed", "CAPTURE_FAILED", 500);
  }

  return c.json({ ...result, target: "daily" });
}

/**
 * GET /vaults/:id/recent-notes - Get recent captured notes.
 */
export async function recentNotesHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 5;

  const notes = await getRecentNotes(vault, limit);
  return c.json({ notes });
}

/**
 * GET /vaults/:id/recent-activity - Get recent activity.
 *
 * Returns recent captures and empty discussions list (placeholder
 * until discussion sessions are tracked in the daemon).
 */
export async function recentActivityHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const notes = await getRecentNotes(vault, 5);
  return c.json({
    captures: notes,
    discussions: [],
  });
}

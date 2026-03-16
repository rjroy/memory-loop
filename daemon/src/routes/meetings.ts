/**
 * Meeting API route handlers.
 *
 * Handles meeting lifecycle: start, get current state, and stop.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getCachedVaultById } from "../vault";
import { startMeeting, stopMeeting, toMeetingState } from "../files/meeting-capture";
import {
  getActiveMeeting,
  setActiveMeeting,
  clearActiveMeeting,
} from "../files/meeting-store";

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
 * POST /vaults/:id/meetings - Start a new meeting.
 */
export async function startMeetingHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  // Check if there's already an active meeting
  const existing = getActiveMeeting(vaultId);
  if (existing) {
    return jsonError(
      c,
      "A meeting is already active",
      "MEETING_ACTIVE",
      409,
      `Active meeting: "${existing.title}"`,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null || !("title" in body)) {
    return jsonError(c, "Missing required field: title", "INVALID_REQUEST", 400);
  }

  const { title } = body as { title: unknown };
  if (typeof title !== "string" || title.trim().length === 0) {
    return jsonError(c, "Title must be a non-empty string", "INVALID_REQUEST", 400);
  }

  const result = await startMeeting(vault, title);
  if (!result.success || !result.meeting) {
    return jsonError(c, result.error ?? "Failed to start meeting", "MEETING_FAILED", 500);
  }

  setActiveMeeting(vaultId, result.meeting);

  return c.json({
    meeting: toMeetingState(result.meeting),
  }, 201);
}

/**
 * GET /vaults/:id/meetings/current - Get current meeting state.
 */
export async function getCurrentMeetingHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const meeting = getActiveMeeting(vaultId);
  return c.json({ meeting: toMeetingState(meeting) });
}

/**
 * DELETE /vaults/:id/meetings/current - Stop the current meeting.
 */
export async function stopMeetingHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const meeting = getActiveMeeting(vaultId);
  if (!meeting) {
    return jsonError(c, "No active meeting", "NO_MEETING", 404);
  }

  const result = await stopMeeting(meeting);
  clearActiveMeeting(vaultId);

  if (!result.success) {
    return jsonError(c, result.error ?? "Failed to stop meeting", "MEETING_FAILED", 500);
  }

  return c.json({
    content: result.content,
    entryCount: result.entryCount,
    filePath: result.filePath,
  });
}

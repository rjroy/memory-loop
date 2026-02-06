/**
 * Current Meeting API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/meetings/current - Get meeting state
 * DELETE /api/vaults/:vaultId/meetings/current - Stop current meeting
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { stopMeeting, toMeetingState } from "@memory-loop/backend/meeting-capture";
import { getActiveMeeting, clearActiveMeeting } from "@memory-loop/backend/meeting-store";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/meetings/current
 *
 * Returns the current meeting state for the vault.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const activeMeeting = getActiveMeeting(vault.id);
  const state = toMeetingState(activeMeeting);

  return NextResponse.json({
    isActive: state.isActive,
    ...(state.title && { title: state.title }),
    ...(state.filePath && { filePath: state.filePath }),
    ...(state.startedAt && { startedAt: state.startedAt }),
  });
}

/**
 * DELETE /api/vaults/:vaultId/meetings/current
 *
 * Ends the current meeting capture session and returns to normal daily note mode.
 * Returns the full file content for Claude Code integration.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const activeMeeting = getActiveMeeting(vault.id);
  if (!activeMeeting) {
    return jsonError("VALIDATION_ERROR", "No meeting is currently in progress.", 404);
  }

  try {
    const result = await stopMeeting(activeMeeting);

    if (!result.success) {
      return jsonError("INTERNAL_ERROR", result.error ?? "Failed to stop meeting", 500);
    }

    const filePath = activeMeeting.relativePath;

    // Clear active meeting from global store
    clearActiveMeeting(vault.id);

    return NextResponse.json({
      filePath,
      content: result.content ?? "",
      entryCount: result.entryCount ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stop meeting";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

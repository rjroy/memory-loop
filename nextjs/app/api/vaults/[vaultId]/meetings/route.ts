/**
 * Meetings API Route (Vault-Scoped)
 *
 * POST /api/vaults/:vaultId/meetings - Start a new meeting
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { startMeeting } from "@/lib/meeting-capture";
import { getActiveMeeting, setActiveMeeting } from "@/lib/meeting-store";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

const StartMeetingSchema = z.object({
  title: z.string().min(1, "Meeting title is required"),
});

/**
 * POST /api/vaults/:vaultId/meetings
 *
 * Creates a new meeting file and sets the vault to meeting capture mode.
 * Subsequent captures will route to the meeting file instead of daily notes.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const parseResult = StartMeetingSchema.safeParse(body);
  if (!parseResult.success) {
    const errorMessage = parseResult.error.issues.map((e) => e.message).join(", ");
    return jsonError("VALIDATION_ERROR", errorMessage);
  }

  const { title } = parseResult.data;

  // Check if a meeting is already active for this vault
  const existingMeeting = getActiveMeeting(vault.id);
  if (existingMeeting) {
    return jsonError(
      "VALIDATION_ERROR",
      `A meeting is already in progress: "${existingMeeting.title}". Stop it first.`
    );
  }

  try {
    const result = await startMeeting(vault, title);

    if (!result.success || !result.meeting) {
      return jsonError("INTERNAL_ERROR", result.error ?? "Failed to start meeting", 500);
    }

    // Store active meeting in global store
    setActiveMeeting(vault.id, result.meeting);

    return NextResponse.json({
      title: result.meeting.title,
      filePath: result.meeting.relativePath,
      startedAt: result.meeting.startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start meeting";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

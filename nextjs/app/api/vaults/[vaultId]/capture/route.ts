/**
 * Capture API Routes (Vault-Scoped)
 *
 * POST /api/vaults/:vaultId/capture - Capture text to daily/meeting note
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { captureToDaily, NoteCaptureError } from "@memory-loop/backend/note-capture";
import { captureToMeeting, MeetingCaptureError } from "@memory-loop/backend/meeting-capture";
import { getActiveMeeting, incrementMeetingEntryCount } from "@memory-loop/backend/meeting-store";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

const CaptureRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
});

/**
 * POST /api/vaults/:vaultId/capture
 *
 * Captures text to today's daily note or active meeting.
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

  const parseResult = CaptureRequestSchema.safeParse(body);
  if (!parseResult.success) {
    const errorMessage = parseResult.error.issues.map((e) => e.message).join(", ");
    return jsonError("VALIDATION_ERROR", errorMessage);
  }

  const { text } = parseResult.data;

  // Check for active meeting - route to meeting file if one exists
  const activeMeeting = getActiveMeeting(vault.id);

  try {
    if (activeMeeting) {
      // Capture to meeting file
      const result = await captureToMeeting(activeMeeting, text);

      if (!result.success) {
        return jsonError("NOTE_CAPTURE_FAILED", result.error ?? "Failed to capture note", 500);
      }

      // Keep global meeting state in sync
      incrementMeetingEntryCount(vault.id);

      return NextResponse.json({
        success: true,
        timestamp: result.timestamp,
        notePath: activeMeeting.relativePath,
      });
    } else {
      // Capture to daily note
      const result = await captureToDaily(vault, text);

      if (!result.success) {
        return jsonError("NOTE_CAPTURE_FAILED", result.error ?? "Failed to capture note", 500);
      }

      return NextResponse.json({
        success: result.success,
        timestamp: result.timestamp,
        notePath: result.notePath,
      });
    }
  } catch (error) {
    if (error instanceof NoteCaptureError || error instanceof MeetingCaptureError) {
      return jsonError("NOTE_CAPTURE_FAILED", error.message, 500);
    }
    const message = error instanceof Error ? error.message : "Failed to capture note";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

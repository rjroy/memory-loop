/**
 * Session API Route (Vault-Scoped)
 *
 * DELETE /api/vaults/:vaultId/sessions/:sessionId - Delete a session
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { deleteSession, validateSessionId, SessionError } from "@/lib/session-manager";

interface RouteParams {
  params: Promise<{ vaultId: string; sessionId: string }>;
}

/**
 * DELETE /api/vaults/:vaultId/sessions/:sessionId
 *
 * Deletes the session metadata file from the vault's sessions directory.
 * Returns success: true with deleted: false if the session doesn't exist.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { vaultId, sessionId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  // Validate session ID format
  try {
    validateSessionId(sessionId);
  } catch (error) {
    if (error instanceof SessionError && error.code === "SESSION_INVALID") {
      return jsonError("VALIDATION_ERROR", error.message);
    }
    throw error;
  }

  try {
    const deleted = await deleteSession(vault.path, sessionId);

    return NextResponse.json({
      success: true,
      deleted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete session";
    return NextResponse.json(
      {
        success: false,
        deleted: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

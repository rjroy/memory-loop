/**
 * Session Lookup API Route
 *
 * GET /api/sessions/:vaultId - Get existing session ID for a vault
 */

import { NextResponse } from "next/server";
import { getSessionForVault } from "@memory-loop/backend/session-manager";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/sessions/:vaultId
 *
 * Returns the session ID if one exists for the given vault.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const sessionId = await getSessionForVault(vaultId);
  return NextResponse.json({ sessionId });
}

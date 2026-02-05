/**
 * Daily Prep Status Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/daily-prep/today - Get today's prep status
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { getDailyPrepStatus } from "@memory-loop/backend/daily-prep-manager";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/daily-prep/today
 *
 * Returns the daily prep status for today.
 * Used by Ground tab to determine button visibility and show commitment.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  try {
    const status = await getDailyPrepStatus(vault);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get daily prep status";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

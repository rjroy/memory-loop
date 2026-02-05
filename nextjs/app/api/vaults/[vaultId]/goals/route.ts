/**
 * Goals API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/goals - Get vault goals
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { getVaultGoals } from "@memory-loop/backend/vault-manager";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/goals
 *
 * Returns the vault's goals content from goals.md.
 * Returns null content if no goals file exists.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  try {
    const content = await getVaultGoals(vault);
    return NextResponse.json({ content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get goals";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

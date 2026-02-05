/**
 * Health Issues API Route (Vault-Scoped)
 *
 * DELETE /api/vaults/:vaultId/health-issues/:issueId - Dismiss a health issue
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";

interface RouteParams {
  params: Promise<{ vaultId: string; issueId: string }>;
}

/**
 * DELETE /api/vaults/:vaultId/health-issues/:issueId
 *
 * Dismiss a health issue.
 *
 * Note: Health issues are per-WebSocket session (HealthCollector instances).
 * This REST endpoint acknowledges the dismiss request but health state
 * is managed by the WebSocket session that runs health checks.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { vaultId, issueId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  if (!issueId) {
    return jsonError("VALIDATION_ERROR", "Issue ID is required");
  }

  // Note: Health collectors are per-WebSocket session, so we can't dismiss
  // from REST directly. The client should use WebSocket for health management.
  // We return success to acknowledge the request.
  return NextResponse.json({
    success: true,
    issueId,
    note: "Dismiss via WebSocket for immediate effect",
  });
}

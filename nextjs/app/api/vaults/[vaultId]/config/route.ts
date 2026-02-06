/**
 * Config API Route (Vault-Scoped)
 *
 * PATCH /api/vaults/:vaultId/config - Update vault configuration
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { handleUpdateVaultConfig } from "@/lib/handlers";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * PATCH /api/vaults/:vaultId/config
 *
 * Update vault configuration.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "Invalid JSON in request body");
  }

  try {
    const result = await handleUpdateVaultConfig(
      vault.path,
      body as Parameters<typeof handleUpdateVaultConfig>[1]
    );

    if (!result.success) {
      return jsonError("VALIDATION_ERROR", result.error ?? "Failed to update config");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update config";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

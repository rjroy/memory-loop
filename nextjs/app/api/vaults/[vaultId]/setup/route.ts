/**
 * Setup API Route (Vault-Scoped)
 *
 * POST /api/vaults/:vaultId/setup - Setup vault (create directories, install commands)
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { ensureSdk } from "@/lib/controller";
import {
  handleSetupVault,
  ConfigValidationError,
  VaultNotFoundError,
} from "@memory-loop/backend/handlers";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * POST /api/vaults/:vaultId/setup
 *
 * Setup vault (create directories, install commands).
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  ensureSdk();

  try {
    const result = await handleSetupVault(vault.id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof VaultNotFoundError) {
      return jsonError("VAULT_NOT_FOUND", error.message, 404);
    }
    if (error instanceof ConfigValidationError) {
      return jsonError("VALIDATION_ERROR", error.message);
    }
    const message = error instanceof Error ? error.message : "Failed to setup vault";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

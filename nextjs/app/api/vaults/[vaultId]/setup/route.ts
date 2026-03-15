/**
 * Setup API Route (Vault-Scoped)
 *
 * POST /api/vaults/:vaultId/setup - Setup vault (create directories, install commands)
 *
 * Inlines the setup handler logic directly. vault-setup.ts remains in
 * nextjs until Stage 5 moves it to the daemon.
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { ensureSdk } from "@/lib/controller";
import { getVaultById } from "@/lib/vault-client";
import { runVaultSetup } from "@/lib/vault-setup";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  ensureSdk();

  // Verify vault exists via vault-client
  const resolvedVault = await getVaultById(vault.id);
  if (!resolvedVault) {
    return jsonError("VAULT_NOT_FOUND", `Vault "${vault.id}" not found`, 404);
  }

  if (!resolvedVault.hasClaudeMd) {
    return jsonError(
      "VALIDATION_ERROR",
      `Vault "${resolvedVault.name}" is missing CLAUDE.md at root`,
    );
  }

  try {
    const result = await runVaultSetup(vault.id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to setup vault";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

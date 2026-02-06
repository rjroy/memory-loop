/**
 * Vault Helper Functions for Next.js API Routes
 *
 * Provides common utilities for vault-scoped API routes.
 */

import { NextResponse } from "next/server";
import { getVaultById } from "@memory-loop/backend/vault-manager";
import type { VaultInfo } from "@memory-loop/shared";

/**
 * Gets a vault by ID and returns it, or returns an error response.
 */
export async function getVaultOrError(
  vaultId: string
): Promise<VaultInfo | NextResponse> {
  const vault = await getVaultById(vaultId);
  if (!vault) {
    return NextResponse.json(
      { error: { code: "VAULT_NOT_FOUND", message: "Vault not found" } },
      { status: 404 }
    );
  }
  return vault;
}

/**
 * Type guard to check if a value is a NextResponse (error).
 */
export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

/**
 * Creates a JSON error response.
 */
export function jsonError(
  code: string,
  message: string,
  status: number = 400
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

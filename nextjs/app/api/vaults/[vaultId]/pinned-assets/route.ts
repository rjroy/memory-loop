/**
 * Pinned Assets API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/pinned-assets - Get pinned asset paths
 * PUT /api/vaults/:vaultId/pinned-assets - Set pinned asset paths
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import {
  handleGetPinnedAssets,
  handleSetPinnedAssets,
  ConfigValidationError,
} from "@/lib/handlers";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

const SetPinnedAssetsSchema = z.object({
  paths: z.array(z.string()),
});

/**
 * GET /api/vaults/:vaultId/pinned-assets
 *
 * Get pinned asset paths.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  try {
    const result = await handleGetPinnedAssets(vault.path);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get pinned assets";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

/**
 * PUT /api/vaults/:vaultId/pinned-assets
 *
 * Set pinned asset paths.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const parseResult = SetPinnedAssetsSchema.safeParse(body);
  if (!parseResult.success) {
    return jsonError("VALIDATION_ERROR", "paths is required and must be an array");
  }

  try {
    const result = await handleSetPinnedAssets(vault.path, parseResult.data.paths);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return jsonError("VALIDATION_ERROR", error.message);
    }
    const message = error instanceof Error ? error.message : "Failed to set pinned assets";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

/**
 * Inspiration API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/inspiration - Get inspiration data
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse } from "@/lib/vault-helpers";
import { ensureSdk } from "@/lib/controller";
import { getInspiration } from "@memory-loop/backend/inspiration-manager";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/inspiration
 *
 * Returns contextual prompt and inspirational quote.
 * Triggers generation if needed (daily for prompts, weekly for quotes).
 * Errors are logged but don't fail the request (graceful degradation).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  ensureSdk();

  try {
    const result = await getInspiration(vault);
    return NextResponse.json({
      contextual: result.contextual,
      quote: result.quote,
    });
  } catch {
    // Log errors but don't fail the request (graceful degradation)
    // Return fallback response rather than error
    return NextResponse.json({
      contextual: null,
      quote: {
        text: "The only way to do great work is to love what you do.",
        attribution: "Steve Jobs",
      },
    });
  }
}

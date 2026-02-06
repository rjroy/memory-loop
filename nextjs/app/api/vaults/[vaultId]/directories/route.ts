/**
 * Directories API Route (Vault-Scoped)
 *
 * POST /api/vaults/:vaultId/directories - Create a new directory
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { createDirectory } from "@memory-loop/backend/file-browser";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

const CreateDirectoryBodySchema = z.object({
  path: z.string(),
  name: z.string().min(1, "Directory name is required"),
});

/**
 * POST /api/vaults/:vaultId/directories
 *
 * Creates a new directory. Body: { path: string, name: string }
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const body: unknown = await request.json();
  const parsed = CreateDirectoryBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      `Invalid request: ${parsed.error.issues[0]?.message ?? "Unknown validation error"}`
    );
  }

  const { path, name } = parsed.data;
  const decodedPath = decodeURIComponent(path);

  const createdPath = await createDirectory(vault.contentRoot, decodedPath, name);

  return NextResponse.json({ path: createdPath }, { status: 201 });
}

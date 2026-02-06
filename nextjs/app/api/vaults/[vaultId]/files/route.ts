/**
 * Files API Routes (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/files - List directory contents
 * POST /api/vaults/:vaultId/files - Create a new file
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { listDirectory, createFile } from "@memory-loop/backend/file-browser";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

const CreateFileBodySchema = z.object({
  path: z.string(),
  name: z.string().min(1, "File name is required"),
});

/**
 * GET /api/vaults/:vaultId/files
 *
 * Lists directory contents. Query param `path` specifies directory (empty for root).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const path = request.nextUrl.searchParams.get("path") ?? "";
  const decodedPath = decodeURIComponent(path);

  const entries = await listDirectory(vault.contentRoot, decodedPath);

  return NextResponse.json({
    path: decodedPath,
    entries,
  });
}

/**
 * POST /api/vaults/:vaultId/files
 *
 * Creates a new markdown file. Body: { path: string, name: string }
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const body: unknown = await request.json();
  const parsed = CreateFileBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      `Invalid request: ${parsed.error.issues[0]?.message ?? "Unknown validation error"}`
    );
  }

  const { path, name } = parsed.data;
  const decodedPath = decodeURIComponent(path);

  const createdPath = await createFile(vault.contentRoot, decodedPath, name);

  return NextResponse.json({ path: createdPath }, { status: 201 });
}

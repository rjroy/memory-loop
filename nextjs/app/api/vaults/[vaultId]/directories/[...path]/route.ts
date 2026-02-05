/**
 * Directories API Route (Vault-Scoped, Path-Based)
 *
 * DELETE /api/vaults/:vaultId/directories/:path - Delete directory and contents
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse } from "@/lib/vault-helpers";
import { deleteDirectory } from "@memory-loop/backend/file-browser";

interface RouteParams {
  params: Promise<{ vaultId: string; path: string[] }>;
}

/**
 * DELETE /api/vaults/:vaultId/directories/:path
 *
 * Deletes a directory and all its contents.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const dirPath = path.map(decodeURIComponent).join("/");

  const result = await deleteDirectory(vault.contentRoot, dirPath);

  return NextResponse.json({
    path: result.path,
    filesDeleted: result.filesDeleted,
    directoriesDeleted: result.directoriesDeleted,
  });
}

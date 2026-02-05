/**
 * Directories API Route (Vault-Scoped, Path-Based)
 *
 * GET /api/vaults/:vaultId/directories/:path/contents - Get directory contents for delete preview
 * DELETE /api/vaults/:vaultId/directories/:path - Delete directory and contents
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse } from "@/lib/vault-helpers";
import { deleteDirectory, getDirectoryContents } from "@memory-loop/backend/file-browser";

interface RouteParams {
  params: Promise<{ vaultId: string; path: string[] }>;
}

/**
 * GET /api/vaults/:vaultId/directories/:path
 *
 * Gets directory contents for deletion preview.
 * The last segment must be "contents" (matching the Hono pattern /directories/:path/contents).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  // The catch-all captures "some/dir/contents" - strip trailing "contents" segment
  const segments = path.map(decodeURIComponent);
  if (segments[segments.length - 1] !== "contents") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const dirPath = segments.slice(0, -1).join("/");

  const result = await getDirectoryContents(vault.contentRoot, dirPath);

  return NextResponse.json({
    path: dirPath,
    files: result.files,
    directories: result.directories,
    totalFiles: result.totalFiles,
    totalDirectories: result.totalDirectories,
    truncated: result.truncated,
  });
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

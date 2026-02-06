/**
 * Files API Routes (Vault-Scoped, Path-Based)
 *
 * GET /api/vaults/:vaultId/files/:path - Read file content
 * PUT /api/vaults/:vaultId/files/:path - Write file content
 * PATCH /api/vaults/:vaultId/files/:path - Rename/move file
 * DELETE /api/vaults/:vaultId/files/:path - Delete file
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import {
  readMarkdownFile,
  writeMarkdownFile,
  deleteFile,
  renameFile,
  moveFile,
} from "@memory-loop/backend/file-browser";
import { updateReferences } from "@memory-loop/backend/reference-updater";

interface RouteParams {
  params: Promise<{ vaultId: string; path: string[] }>;
}

const WriteFileBodySchema = z.object({
  content: z.string(),
});

const RenameFileBodySchema = z.object({
  newName: z.string().min(1, "New name is required"),
});

const MoveFileBodySchema = z.object({
  newPath: z.string().min(1, "New path is required"),
});

function hasExtension(filePath: string): boolean {
  const lastSlash = filePath.lastIndexOf("/");
  const lastDot = filePath.lastIndexOf(".");
  return lastDot > lastSlash && lastDot !== filePath.length - 1;
}

/**
 * GET /api/vaults/:vaultId/files/:path
 *
 * Reads file content.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const filePath = path.map(decodeURIComponent).join("/");

  const result = await readMarkdownFile(vault.contentRoot, filePath);

  return NextResponse.json({
    path: filePath,
    content: result.content,
    truncated: result.truncated,
  });
}

/**
 * PUT /api/vaults/:vaultId/files/:path
 *
 * Writes content to existing file. Body: { content: string }
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const body: unknown = await request.json();
  const parsed = WriteFileBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      `Invalid request: ${parsed.error.issues[0]?.message ?? "Unknown validation error"}`
    );
  }

  const filePath = path.map(decodeURIComponent).join("/");

  await writeMarkdownFile(vault.contentRoot, filePath, parsed.data.content);

  return NextResponse.json({
    path: filePath,
    success: true,
  });
}

/**
 * PATCH /api/vaults/:vaultId/files/:path
 *
 * Renames or moves a file/directory.
 * Body: { newName: string } for rename, { newPath: string } for move
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const body: unknown = await request.json();
  const filePath = path.map(decodeURIComponent).join("/");

  // Check if this is a rename or move operation
  const renameResult = RenameFileBodySchema.safeParse(body);
  const moveResult = MoveFileBodySchema.safeParse(body);

  if (renameResult.success) {
    // Rename operation
    const { newName } = renameResult.data;

    const result = await renameFile(vault.contentRoot, filePath, newName);

    // Update references
    const isDirectory = !hasExtension(result.newPath);
    const refResult = await updateReferences(
      vault.contentRoot,
      result.oldPath,
      result.newPath,
      isDirectory
    );

    return NextResponse.json({
      oldPath: result.oldPath,
      newPath: result.newPath,
      referencesUpdated: refResult.referencesUpdated,
    });
  } else if (moveResult.success) {
    // Move operation
    const { newPath } = moveResult.data;

    const result = await moveFile(vault.contentRoot, filePath, newPath);

    // Update references
    const refResult = await updateReferences(
      vault.contentRoot,
      result.oldPath,
      result.newPath,
      result.isDirectory
    );

    return NextResponse.json({
      oldPath: result.oldPath,
      newPath: result.newPath,
      referencesUpdated: refResult.referencesUpdated,
    });
  } else {
    return jsonError(
      "VALIDATION_ERROR",
      "Request body must contain either 'newName' (for rename) or 'newPath' (for move)"
    );
  }
}

/**
 * DELETE /api/vaults/:vaultId/files/:path
 *
 * Deletes a file.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  const filePath = path.map(decodeURIComponent).join("/");

  await deleteFile(vault.contentRoot, filePath);

  return NextResponse.json({ path: filePath });
}

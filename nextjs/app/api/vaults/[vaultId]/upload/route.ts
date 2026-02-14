/**
 * Upload API Route (Vault-Scoped)
 *
 * POST /api/vaults/:vaultId/upload - Upload a file to the vault's attachment directory
 */

import { NextResponse } from "next/server";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { uploadFile } from "@/lib/file-upload";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * POST /api/vaults/:vaultId/upload
 *
 * Accepts multipart form data with a "file" field.
 * Validates, generates a unique filename, and writes to the vault's attachment directory.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("VALIDATION_ERROR", "Invalid multipart form data");
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return jsonError("VALIDATION_ERROR", "No file provided");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await uploadFile(
    vault.path,
    vault.contentRoot,
    vault.attachmentPath,
    buffer,
    file.name
  );

  if (!result.success) {
    return jsonError("UPLOAD_FAILED", result.error ?? "Upload failed", 400);
  }

  return NextResponse.json({
    success: true,
    path: result.path,
    converted: result.converted,
    originalFormat: result.originalFormat,
  });
}

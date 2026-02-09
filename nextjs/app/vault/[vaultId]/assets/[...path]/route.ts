/**
 * Asset Serving Route (Vault-Scoped)
 *
 * GET /vault/:vaultId/assets/:path - Serve binary files from vault
 *
 * Serves images, videos, PDFs, and other files from the vault's content root.
 * Used by ImageViewer, VideoViewer, PdfViewer, MarkdownViewer, and MessageBubble.
 */

import { NextResponse } from "next/server";
import { readFile, lstat } from "node:fs/promises";
import { join, extname } from "node:path";
import { getVaultById } from "@/lib/vault-manager";
import { isPathWithinVault } from "@/lib/file-browser";

interface RouteParams {
  params: Promise<{ vaultId: string; path: string[] }>;
}

const MIME_TYPES: Record<string, string> = {
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  // Video
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".m4v": "video/mp4",
  // Documents
  ".pdf": "application/pdf",
  // Text
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
};

/**
 * GET /vault/:vaultId/assets/*
 *
 * Serves a file from the vault's content root with the correct Content-Type.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId, path: pathSegments } = await params;

  const vault = await getVaultById(vaultId);
  if (!vault) {
    return NextResponse.json(
      { error: { code: "VAULT_NOT_FOUND", message: "Vault not found" } },
      { status: 404 }
    );
  }

  const relativePath = pathSegments.map(decodeURIComponent).join("/");
  const fullPath = join(vault.contentRoot, relativePath);

  // Security: ensure path stays within vault
  if (!(await isPathWithinVault(vault.path, fullPath))) {
    return NextResponse.json(
      { error: { code: "PATH_TRAVERSAL", message: "Invalid path" } },
      { status: 403 }
    );
  }

  // Check file exists and is a regular file (not symlink)
  try {
    const stats = await lstat(fullPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return NextResponse.json(
        { error: { code: "FILE_NOT_FOUND", message: "File not found" } },
        { status: 404 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: { code: "FILE_NOT_FOUND", message: "File not found" } },
      { status: 404 }
    );
  }

  const buffer = await readFile(fullPath);
  const ext = extname(relativePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

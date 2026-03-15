/**
 * Asset serving route handler.
 *
 * GET /vaults/:id/assets/* - Serve binary files from vault content root.
 * Used by the Next.js asset proxy to serve images, videos, PDFs, etc.
 */

import { readFile, lstat } from "node:fs/promises";
import { join, extname } from "node:path";
import type { Context } from "hono";
import { getCachedVaultById } from "../vault";
import { isPathWithinVault } from "../files/file-browser";

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
 * Extracts the asset path from the URL after /vaults/:id/assets/.
 */
function extractAssetPath(c: Context): string {
  const vaultId = c.req.param("id") ?? "";
  const prefix = `/vaults/${vaultId}/assets/`;
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith(prefix)) return "";
  return decodeURIComponent(path.slice(prefix.length));
}

/**
 * GET /vaults/:id/assets/*
 *
 * Serves a file from the vault's content root with the correct Content-Type.
 * Validates the path stays within the vault boundary and rejects symlinks.
 */
export async function assetHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return c.json(
      { error: { code: "VAULT_NOT_FOUND", message: "Vault not found" } },
      404,
    );
  }

  const relativePath = extractAssetPath(c);
  if (!relativePath) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "Asset path is required" } },
      400,
    );
  }

  const fullPath = join(vault.contentRoot, relativePath);

  // Security: ensure path stays within vault
  if (!(await isPathWithinVault(vault.path, fullPath))) {
    return c.json(
      { error: { code: "PATH_TRAVERSAL", message: "Invalid path" } },
      403,
    );
  }

  // Check file exists and is a regular file (not symlink)
  try {
    const stats = await lstat(fullPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return c.json(
        { error: { code: "FILE_NOT_FOUND", message: "File not found" } },
        404,
      );
    }
  } catch {
    return c.json(
      { error: { code: "FILE_NOT_FOUND", message: "File not found" } },
      404,
    );
  }

  const buffer = await readFile(fullPath);
  const ext = extname(relativePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  return new Response(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

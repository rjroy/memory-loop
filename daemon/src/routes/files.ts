/**
 * File API route handlers.
 *
 * Handles file and directory CRUD, file upload, and goals retrieval.
 * All operations go through the vault cache and file browser module.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@memory-loop/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getCachedVaultById } from "../vault";
import {
  listDirectory,
  createFile,
  readMarkdownFile,
  writeMarkdownFile,
  deleteFile,
  renameFile,
  moveFile,
  createDirectory,
  getDirectoryContents,
  deleteDirectory,
  FileBrowserError,
} from "../files/file-browser";
import { uploadFile } from "../files/file-upload";
import { updateReferences } from "../files/reference-updater";

const log = createLogger("file-routes");

// =============================================================================
// Error Mapping
// =============================================================================

/** Maps FileBrowserError codes to HTTP status codes. */
const ERROR_CODE_TO_STATUS: Record<string, ContentfulStatusCode> = {
  PATH_TRAVERSAL: 403,
  FILE_NOT_FOUND: 404,
  DIRECTORY_NOT_FOUND: 404,
  INVALID_FILE_TYPE: 400,
  INVALID_FILE_NAME: 400,
  INVALID_DIRECTORY_NAME: 400,
  VALIDATION_ERROR: 400,
  FILE_EXISTS: 409,
  DIRECTORY_EXISTS: 409,
};

function jsonError(
  c: Context,
  error: string,
  code: string,
  status: ContentfulStatusCode,
  detail?: string,
): Response {
  return c.json({ error, code, ...(detail ? { detail } : {}) }, status);
}

/**
 * Extracts the wildcard portion of the URL path after /vaults/:id/<resource>/.
 * Hono v4 does not populate c.req.param("0") for wildcard routes,
 * so we extract it from the URL path directly.
 */
function extractWildcardPath(c: Context, resource: string): string {
  const vaultId = c.req.param("id") ?? "";
  const prefix = `/vaults/${vaultId}/${resource}/`;
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith(prefix)) return "";
  return decodeURIComponent(path.slice(prefix.length));
}

function handleFileBrowserError(c: Context, error: unknown): Response {
  if (error instanceof FileBrowserError) {
    const status = ERROR_CODE_TO_STATUS[error.code] ?? 500;
    return jsonError(c, error.message, error.code, status);
  }
  const message = error instanceof Error ? error.message : String(error);
  log.error(`Unexpected error: ${message}`);
  return jsonError(c, "Internal server error", "INTERNAL_ERROR", 500);
}

async function resolveVault(c: Context) {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return { vault: null, error: jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404) };
  }
  return { vault, error: null };
}

// =============================================================================
// File Handlers
// =============================================================================

/**
 * GET /vaults/:id/files - List directory contents.
 */
export async function listFilesHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  const path = c.req.query("path") ?? "";

  try {
    const entries = await listDirectory(vault.contentRoot, path);
    return c.json({ path, entries });
  } catch (err) {
    return handleFileBrowserError(c, err);
  }
}

/**
 * POST /vaults/:id/files - Create a new file.
 */
export async function createFileHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError(c, "Request body must be an object", "INVALID_REQUEST", 400);
  }

  const { path: dirPath, name } = body as { path?: string; name?: string };
  if (typeof dirPath !== "string" || typeof name !== "string") {
    return jsonError(c, "Missing required fields: path, name", "INVALID_REQUEST", 400);
  }

  try {
    const result = await createFile(vault.contentRoot, dirPath, name);
    return c.json(result, 201);
  } catch (err) {
    return handleFileBrowserError(c, err);
  }
}

/**
 * GET /vaults/:id/files/* - Read a file.
 */
export async function readFileHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  const filePath = extractWildcardPath(c, "files");
  if (!filePath) {
    return jsonError(c, "File path is required", "INVALID_REQUEST", 400);
  }

  try {
    const result = await readMarkdownFile(vault.contentRoot, filePath);
    return c.json(result);
  } catch (err) {
    return handleFileBrowserError(c, err);
  }
}

/**
 * PUT /vaults/:id/files/* - Write file content.
 */
export async function writeFileHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  const filePath = extractWildcardPath(c, "files");
  if (!filePath) {
    return jsonError(c, "File path is required", "INVALID_REQUEST", 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null || !("content" in body)) {
    return jsonError(c, "Missing required field: content", "INVALID_REQUEST", 400);
  }

  const { content } = body as { content: unknown };
  if (typeof content !== "string") {
    return jsonError(c, "content must be a string", "INVALID_REQUEST", 400);
  }

  try {
    await writeMarkdownFile(vault.contentRoot, filePath, content);
    return c.json({ success: true });
  } catch (err) {
    return handleFileBrowserError(c, err);
  }
}

/**
 * PATCH /vaults/:id/files/* - Rename or move a file.
 */
export async function patchFileHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  const filePath = extractWildcardPath(c, "files");
  if (!filePath) {
    return jsonError(c, "File path is required", "INVALID_REQUEST", 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError(c, "Request body must be an object", "INVALID_REQUEST", 400);
  }

  const { newName, newPath } = body as { newName?: string; newPath?: string };

  try {
    let result: { oldPath: string; newPath: string };

    if (newPath !== undefined) {
      result = await moveFile(vault.contentRoot, filePath, newPath);
    } else if (newName !== undefined) {
      result = await renameFile(vault.contentRoot, filePath, newName);
    } else {
      return jsonError(c, "Must provide newName or newPath", "INVALID_REQUEST", 400);
    }

    // Update references across the vault
    await updateReferences(vault.contentRoot, result.oldPath, result.newPath, false);

    return c.json(result);
  } catch (err) {
    return handleFileBrowserError(c, err);
  }
}

/**
 * DELETE /vaults/:id/files/* - Delete a file.
 */
export async function deleteFileHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  const filePath = extractWildcardPath(c, "files");
  if (!filePath) {
    return jsonError(c, "File path is required", "INVALID_REQUEST", 400);
  }

  try {
    await deleteFile(vault.contentRoot, filePath);
    return c.json({ success: true });
  } catch (err) {
    return handleFileBrowserError(c, err);
  }
}

// =============================================================================
// Directory Handlers
// =============================================================================

/**
 * POST /vaults/:id/directories - Create a directory.
 */
export async function createDirectoryHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError(c, "Request body must be an object", "INVALID_REQUEST", 400);
  }

  const { path: dirPath, name } = body as { path?: string; name?: string };
  if (typeof dirPath !== "string" || typeof name !== "string") {
    return jsonError(c, "Missing required fields: path, name", "INVALID_REQUEST", 400);
  }

  try {
    const result = await createDirectory(vault.contentRoot, dirPath, name);
    return c.json(result, 201);
  } catch (err) {
    return handleFileBrowserError(c, err);
  }
}

/**
 * GET /vaults/:id/directories/* - Get directory contents.
 */
export async function getDirectoryContentsHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  const dirPath = extractWildcardPath(c, "directories");

  try {
    const entries = await getDirectoryContents(vault.contentRoot, dirPath);
    return c.json({ entries });
  } catch (err) {
    return handleFileBrowserError(c, err);
  }
}

/**
 * DELETE /vaults/:id/directories/* - Delete a directory.
 */
export async function deleteDirectoryHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  const dirPath = extractWildcardPath(c, "directories");
  if (!dirPath) {
    return jsonError(c, "Directory path is required", "INVALID_REQUEST", 400);
  }

  try {
    await deleteDirectory(vault.contentRoot, dirPath);
    return c.json({ success: true });
  } catch (err) {
    return handleFileBrowserError(c, err);
  }
}

// =============================================================================
// Upload Handler
// =============================================================================

/**
 * POST /vaults/:id/upload - Upload a file (multipart).
 */
export async function uploadFileHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  let formData: Record<string, string | File>;
  try {
    formData = await c.req.parseBody();
  } catch {
    return jsonError(c, "Invalid multipart form data", "INVALID_REQUEST", 400);
  }

  const file = formData.file;
  if (!(file instanceof File)) {
    return jsonError(c, "Missing required file field", "INVALID_REQUEST", 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await uploadFile(
    vault.path,
    vault.contentRoot,
    vault.attachmentPath,
    buffer,
    file.name,
  );

  if (!result.success) {
    return jsonError(c, result.error ?? "Upload failed", "UPLOAD_FAILED", 400);
  }

  return c.json(result, 201);
}

// =============================================================================
// Goals Handler
// =============================================================================

/**
 * GET /vaults/:id/goals - Read the goals file.
 */
export async function getGoalsHandler(c: Context): Promise<Response> {
  const { vault, error } = await resolveVault(c);
  if (error) return error;

  if (!vault.goalsPath) {
    return jsonError(c, "No goals file configured", "NOT_FOUND", 404);
  }

  const goalsFullPath = join(vault.contentRoot, vault.goalsPath);

  try {
    const content = await readFile(goalsFullPath, "utf-8");
    return c.json({ content, path: vault.goalsPath });
  } catch {
    return jsonError(c, "Goals file not found", "FILE_NOT_FOUND", 404);
  }
}

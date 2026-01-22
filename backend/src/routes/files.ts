/**
 * File Browser REST Routes
 *
 * Provides REST endpoints for file browser operations within a vault.
 * Wraps existing file-browser.ts functions with HTTP semantics.
 *
 * Requirements:
 * - REQ-F-5: GET /files?path= -> directory listing
 * - REQ-F-6: GET /files/* -> file content
 * - REQ-F-7: PUT /files/* -> write file
 * - REQ-F-8: DELETE /files/* -> delete file
 * - REQ-F-9: POST /files -> create file
 * - REQ-F-10: POST /directories -> create directory
 * - REQ-F-11: DELETE /directories/* -> delete directory
 * - REQ-F-12, REQ-F-13: PATCH /files/* -> rename/move file
 * - REQ-F-14: POST /files/ * /archive -> archive file
 * - REQ-F-15: GET /directories/ * /contents -> directory contents
 * - REQ-F-60: URL-encoded paths handled correctly
 */

import { Hono } from "hono";
import { z } from "zod";
import { getVaultFromContext, jsonError } from "../middleware/vault-resolution";
import {
  listDirectory,
  readMarkdownFile,
  writeMarkdownFile,
  deleteFile,
  deleteDirectory,
  getDirectoryContents,
  archiveFile,
  createDirectory,
  createFile,
  renameFile,
  moveFile,
} from "../file-browser";
import { updateReferences } from "../reference-updater";
import { createLogger } from "../logger";

const log = createLogger("FilesRoutes");

/**
 * Hono router for file browser operations.
 * All routes assume vault resolution middleware has run.
 */
const filesRoutes = new Hono();

// =============================================================================
// Request Body Schemas
// =============================================================================

const CreateFileBodySchema = z.object({
  path: z.string(), // Parent directory path (empty string for root)
  name: z.string().min(1, "File name is required"),
});

const CreateDirectoryBodySchema = z.object({
  path: z.string(), // Parent directory path (empty string for root)
  name: z.string().min(1, "Directory name is required"),
});

const WriteFileBodySchema = z.object({
  content: z.string(),
});

const RenameFileBodySchema = z.object({
  newName: z.string().min(1, "New name is required"),
});

const MoveFileBodySchema = z.object({
  newPath: z.string().min(1, "New path is required"),
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extracts file path from wildcard route parameter.
 * Handles URL decoding for special characters and spaces.
 */
function extractFilePath(c: { req: { param: (name: string) => string | undefined } }): string {
  // Hono uses a wildcard param that captures the rest of the path
  const rawPath = c.req.param("path") ?? "";
  // Decode URL-encoded characters
  return decodeURIComponent(rawPath);
}

/**
 * Determines if a path refers to a directory (no extension or has trailing slash).
 */
function hasExtension(filePath: string): boolean {
  const lastSlash = filePath.lastIndexOf("/");
  const lastDot = filePath.lastIndexOf(".");
  return lastDot > lastSlash && lastDot !== filePath.length - 1;
}

// =============================================================================
// Directory Listing (REQ-F-5)
// =============================================================================

/**
 * GET /files
 * Lists directory contents. Query param `path` specifies directory (empty for root).
 */
filesRoutes.get("/", async (c) => {
  const vault = getVaultFromContext(c);
  const path = c.req.query("path") ?? "";
  const decodedPath = decodeURIComponent(path);

  log.info(`Listing directory: ${decodedPath || "/"} in vault ${vault.id}`);

  const entries = await listDirectory(vault.contentRoot, decodedPath);

  return c.json({
    path: decodedPath,
    entries,
  });
});

// =============================================================================
// File Creation (REQ-F-9)
// =============================================================================

/**
 * POST /files
 * Creates a new markdown file. Body: { path: string, name: string }
 */
filesRoutes.post("/", async (c) => {
  const vault = getVaultFromContext(c);
  const body: unknown = await c.req.json();

  const parsed = CreateFileBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      "VALIDATION_ERROR",
      `Invalid request: ${parsed.error.issues[0]?.message ?? "Unknown validation error"}`
    );
  }

  const { path, name } = parsed.data;
  const decodedPath = decodeURIComponent(path);

  log.info(`Creating file: ${name}.md in ${decodedPath || "/"} in vault ${vault.id}`);

  const createdPath = await createFile(vault.contentRoot, decodedPath, name);

  return c.json({ path: createdPath }, 201);
});

// =============================================================================
// File Content (REQ-F-6)
// =============================================================================

/**
 * GET /files/*
 * Reads file content. Path is URL-encoded in URL.
 */
filesRoutes.get("/:path{.+}", async (c) => {
  const vault = getVaultFromContext(c);
  const filePath = extractFilePath(c);

  log.info(`Reading file: ${filePath} in vault ${vault.id}`);

  const result = await readMarkdownFile(vault.contentRoot, filePath);

  return c.json({
    path: filePath,
    content: result.content,
    truncated: result.truncated,
  });
});

// =============================================================================
// File Write (REQ-F-7)
// =============================================================================

/**
 * PUT /files/*
 * Writes content to existing file. Body: { content: string }
 */
filesRoutes.put("/:path{.+}", async (c) => {
  const vault = getVaultFromContext(c);
  const filePath = extractFilePath(c);

  const body: unknown = await c.req.json();
  const parsed = WriteFileBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      "VALIDATION_ERROR",
      `Invalid request: ${parsed.error.issues[0]?.message ?? "Unknown validation error"}`
    );
  }

  log.info(`Writing file: ${filePath} in vault ${vault.id}`);

  await writeMarkdownFile(vault.contentRoot, filePath, parsed.data.content);

  return c.json({
    path: filePath,
    success: true,
  });
});

// =============================================================================
// File Rename/Move (REQ-F-12, REQ-F-13)
// =============================================================================

/**
 * PATCH /files/*
 * Renames or moves a file/directory.
 * Body: { newName: string } for rename, { newPath: string } for move
 */
filesRoutes.patch("/:path{.+}", async (c) => {
  const vault = getVaultFromContext(c);
  const filePath = extractFilePath(c);

  const body: unknown = await c.req.json();

  // Check if this is a rename or move operation
  const renameResult = RenameFileBodySchema.safeParse(body);
  const moveResult = MoveFileBodySchema.safeParse(body);

  if (renameResult.success) {
    // Rename operation
    const { newName } = renameResult.data;
    log.info(`Renaming: ${filePath} to ${newName} in vault ${vault.id}`);

    const result = await renameFile(vault.contentRoot, filePath, newName);

    // Update references
    const isDirectory = !hasExtension(result.newPath);
    const refResult = await updateReferences(
      vault.contentRoot,
      result.oldPath,
      result.newPath,
      isDirectory
    );

    return c.json({
      oldPath: result.oldPath,
      newPath: result.newPath,
      referencesUpdated: refResult.referencesUpdated,
    });
  } else if (moveResult.success) {
    // Move operation
    const { newPath } = moveResult.data;
    log.info(`Moving: ${filePath} to ${newPath} in vault ${vault.id}`);

    const result = await moveFile(vault.contentRoot, filePath, newPath);

    // Update references
    const refResult = await updateReferences(
      vault.contentRoot,
      result.oldPath,
      result.newPath,
      result.isDirectory
    );

    return c.json({
      oldPath: result.oldPath,
      newPath: result.newPath,
      referencesUpdated: refResult.referencesUpdated,
    });
  } else {
    return jsonError(
      c,
      400,
      "VALIDATION_ERROR",
      "Request body must contain either 'newName' (for rename) or 'newPath' (for move)"
    );
  }
});

// =============================================================================
// File Delete (REQ-F-8)
// =============================================================================

/**
 * DELETE /files/*
 * Deletes a file. Path is URL-encoded in URL.
 */
filesRoutes.delete("/:path{.+}", async (c) => {
  const vault = getVaultFromContext(c);
  const filePath = extractFilePath(c);

  log.info(`Deleting file: ${filePath} in vault ${vault.id}`);

  await deleteFile(vault.contentRoot, filePath);

  return c.json({ path: filePath });
});

// =============================================================================
// Directory Routes
// =============================================================================

const directoriesRoutes = new Hono();

// =============================================================================
// Directory Creation (REQ-F-10)
// =============================================================================

/**
 * POST /directories
 * Creates a new directory. Body: { path: string, name: string }
 */
directoriesRoutes.post("/", async (c) => {
  const vault = getVaultFromContext(c);
  const body: unknown = await c.req.json();

  const parsed = CreateDirectoryBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      "VALIDATION_ERROR",
      `Invalid request: ${parsed.error.issues[0]?.message ?? "Unknown validation error"}`
    );
  }

  const { path, name } = parsed.data;
  const decodedPath = decodeURIComponent(path);

  log.info(`Creating directory: ${name} in ${decodedPath || "/"} in vault ${vault.id}`);

  const createdPath = await createDirectory(vault.contentRoot, decodedPath, name);

  return c.json({ path: createdPath }, 201);
});

// =============================================================================
// Directory Contents (REQ-F-15)
// =============================================================================

/**
 * GET /directories/:path/contents
 * Gets directory contents for deletion preview.
 */
directoriesRoutes.get("/:path{.+}/contents", async (c) => {
  const vault = getVaultFromContext(c);
  const dirPath = extractFilePath(c);

  log.info(`Getting directory contents: ${dirPath} in vault ${vault.id}`);

  const result = await getDirectoryContents(vault.contentRoot, dirPath);

  return c.json({
    path: dirPath,
    files: result.files,
    directories: result.directories,
    totalFiles: result.totalFiles,
    totalDirectories: result.totalDirectories,
    truncated: result.truncated,
  });
});

// =============================================================================
// Directory Delete (REQ-F-11)
// =============================================================================

/**
 * DELETE /directories/*
 * Deletes a directory and all its contents.
 */
directoriesRoutes.delete("/:path{.+}", async (c) => {
  const vault = getVaultFromContext(c);
  const dirPath = extractFilePath(c);

  log.info(`Deleting directory: ${dirPath} in vault ${vault.id}`);

  const result = await deleteDirectory(vault.contentRoot, dirPath);

  return c.json({
    path: result.path,
    filesDeleted: result.filesDeleted,
    directoriesDeleted: result.directoriesDeleted,
  });
});

// =============================================================================
// Archive Route (REQ-F-14)
// =============================================================================

/**
 * POST /files/:path/archive
 * Archives a file/directory to the archive folder.
 * Note: This route is registered separately due to wildcard path handling.
 */
const archiveRoutes = new Hono();

archiveRoutes.post("/:path{.+}/archive", async (c) => {
  const vault = getVaultFromContext(c);
  const filePath = extractFilePath(c);

  log.info(`Archiving: ${filePath} in vault ${vault.id}`);

  const result = await archiveFile(vault.contentRoot, filePath, "04_Archive");

  return c.json({
    path: result.originalPath,
    archivePath: result.archivePath,
  });
});

export { filesRoutes, directoriesRoutes, archiveRoutes };

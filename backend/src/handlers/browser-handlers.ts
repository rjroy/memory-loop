/**
 * File Browser Handlers
 *
 * Handles file system operations within the selected vault:
 * - list_directory: List directory contents
 * - read_file: Read markdown file content
 * - write_file: Write content to a markdown file
 * - delete_file: Delete a file
 * - archive_file: Archive a directory
 */

import type { HandlerContext } from "./types.js";
import { requireVault, isFileBrowserError } from "./types.js";
import { wsLog as log } from "../logger.js";

/**
 * Handles list_directory message.
 * Lists contents of a directory within the selected vault.
 */
export async function handleListDirectory(
  ctx: HandlerContext,
  path: string
): Promise<void> {
  log.info(`Listing directory: ${path || "/"}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for directory listing");
    return;
  }

  try {
    const entries = await ctx.deps.listDirectory(ctx.state.currentVault.contentRoot, path);
    log.info(`Found ${entries.length} entries in ${path || "/"}`);
    ctx.send({
      type: "directory_listing",
      path,
      entries,
    });
  } catch (error) {
    log.error("Directory listing failed", error);
    if (isFileBrowserError(error)) {
      ctx.sendError(error.code, error.message);
    } else {
      const message =
        error instanceof Error ? error.message : "Failed to list directory";
      ctx.sendError("INTERNAL_ERROR", message);
    }
  }
}

/**
 * Handles read_file message.
 * Reads a markdown file from the selected vault.
 */
export async function handleReadFile(
  ctx: HandlerContext,
  path: string
): Promise<void> {
  log.info(`Reading file: ${path}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for file reading");
    return;
  }

  try {
    const result = await ctx.deps.readMarkdownFile(ctx.state.currentVault.contentRoot, path);
    log.info(`File read: ${path} (truncated: ${result.truncated})`);
    ctx.send({
      type: "file_content",
      path,
      content: result.content,
      truncated: result.truncated,
    });
  } catch (error) {
    log.error("File reading failed", error);
    if (isFileBrowserError(error)) {
      ctx.sendError(error.code, error.message);
    } else {
      const message =
        error instanceof Error ? error.message : "Failed to read file";
      ctx.sendError("INTERNAL_ERROR", message);
    }
  }
}

/**
 * Handles write_file message.
 * Writes content to a markdown file in the selected vault.
 */
export async function handleWriteFile(
  ctx: HandlerContext,
  path: string,
  content: string
): Promise<void> {
  log.info(`Writing file: ${path}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for file writing");
    return;
  }

  try {
    await ctx.deps.writeMarkdownFile(ctx.state.currentVault.contentRoot, path, content);
    log.info(`File written: ${path} (${content.length} bytes)`);
    ctx.send({
      type: "file_written",
      path,
      success: true,
    });
  } catch (error) {
    log.error("File writing failed", error);
    if (isFileBrowserError(error)) {
      ctx.sendError(error.code, error.message);
    } else {
      const message =
        error instanceof Error ? error.message : "Failed to write file";
      ctx.sendError("INTERNAL_ERROR", message);
    }
  }
}

/**
 * Handles delete_file message.
 * Deletes a file from the selected vault.
 */
export async function handleDeleteFile(
  ctx: HandlerContext,
  path: string
): Promise<void> {
  log.info(`Deleting file: ${path}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for file deletion");
    return;
  }

  try {
    await ctx.deps.deleteFile(ctx.state.currentVault.contentRoot, path);
    log.info(`File deleted: ${path}`);
    ctx.send({
      type: "file_deleted",
      path,
    });
  } catch (error) {
    log.error("File deletion failed", error);
    if (isFileBrowserError(error)) {
      ctx.sendError(error.code, error.message);
    } else {
      const message =
        error instanceof Error ? error.message : "Failed to delete file";
      ctx.sendError("INTERNAL_ERROR", message);
    }
  }
}

/**
 * Handles archive_file message.
 * Archives a directory from the selected vault to the archive folder.
 */
export async function handleArchiveFile(
  ctx: HandlerContext,
  path: string
): Promise<void> {
  log.info(`Archiving directory: ${path}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for archive");
    return;
  }

  try {
    const result = await ctx.deps.archiveFile(ctx.state.currentVault.contentRoot, path, "04_Archive");
    log.info(`Directory archived: ${path} -> ${result.archivePath}`);
    ctx.send({
      type: "file_archived",
      path,
      archivePath: result.archivePath,
    });
  } catch (error) {
    log.error("Archive failed", error);
    if (isFileBrowserError(error)) {
      ctx.sendError(error.code, error.message);
    } else {
      const message =
        error instanceof Error ? error.message : "Failed to archive directory";
      ctx.sendError("INTERNAL_ERROR", message);
    }
  }
}

/**
 * Handles create_directory message.
 * Creates a new directory in the selected vault.
 */
export async function handleCreateDirectory(
  ctx: HandlerContext,
  parentPath: string,
  name: string
): Promise<void> {
  log.info(`Creating directory: ${name} in ${parentPath || "/"}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for directory creation");
    return;
  }

  try {
    const createdPath = await ctx.deps.createDirectory(ctx.state.currentVault.contentRoot, parentPath, name);
    log.info(`Directory created: ${createdPath}`);
    ctx.send({
      type: "directory_created",
      path: createdPath,
    });
  } catch (error) {
    log.error("Directory creation failed", error);
    if (isFileBrowserError(error)) {
      ctx.sendError(error.code, error.message);
    } else {
      const message =
        error instanceof Error ? error.message : "Failed to create directory";
      ctx.sendError("INTERNAL_ERROR", message);
    }
  }
}

/**
 * Handles create_file message.
 * Creates a new empty markdown file in the selected vault.
 */
export async function handleCreateFile(
  ctx: HandlerContext,
  parentPath: string,
  name: string
): Promise<void> {
  log.info(`Creating file: ${name}.md in ${parentPath || "/"}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for file creation");
    return;
  }

  try {
    const createdPath = await ctx.deps.createFile(ctx.state.currentVault.contentRoot, parentPath, name);
    log.info(`File created: ${createdPath}`);
    ctx.send({
      type: "file_created",
      path: createdPath,
    });
  } catch (error) {
    log.error("File creation failed", error);
    if (isFileBrowserError(error)) {
      ctx.sendError(error.code, error.message);
    } else {
      const message =
        error instanceof Error ? error.message : "Failed to create file";
      ctx.sendError("INTERNAL_ERROR", message);
    }
  }
}

/**
 * File Browser Handlers
 *
 * Handles file system operations within the selected vault:
 * - list_directory: List directory contents
 * - read_file: Read markdown file content
 * - write_file: Write content to a markdown file
 * - delete_file: Delete a file
 */

import type { HandlerContext } from "./types.js";
import { requireVault } from "./types.js";
import {
  listDirectory,
  readMarkdownFile,
  writeMarkdownFile,
  deleteFile,
  FileBrowserError,
} from "../file-browser.js";
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
    const entries = await listDirectory(ctx.state.currentVault.contentRoot, path);
    log.info(`Found ${entries.length} entries in ${path || "/"}`);
    ctx.send({
      type: "directory_listing",
      path,
      entries,
    });
  } catch (error) {
    log.error("Directory listing failed", error);
    if (error instanceof FileBrowserError) {
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
    const result = await readMarkdownFile(ctx.state.currentVault.contentRoot, path);
    log.info(`File read: ${path} (truncated: ${result.truncated})`);
    ctx.send({
      type: "file_content",
      path,
      content: result.content,
      truncated: result.truncated,
    });
  } catch (error) {
    log.error("File reading failed", error);
    if (error instanceof FileBrowserError) {
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
    await writeMarkdownFile(ctx.state.currentVault.contentRoot, path, content);
    log.info(`File written: ${path} (${content.length} bytes)`);
    ctx.send({
      type: "file_written",
      path,
      success: true,
    });
  } catch (error) {
    log.error("File writing failed", error);
    if (error instanceof FileBrowserError) {
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
    await deleteFile(ctx.state.currentVault.contentRoot, path);
    log.info(`File deleted: ${path}`);
    ctx.send({
      type: "file_deleted",
      path,
    });
  } catch (error) {
    log.error("File deletion failed", error);
    if (error instanceof FileBrowserError) {
      ctx.sendError(error.code, error.message);
    } else {
      const message =
        error instanceof Error ? error.message : "Failed to delete file";
      ctx.sendError("INTERNAL_ERROR", message);
    }
  }
}

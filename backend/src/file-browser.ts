/**
 * File Browser
 *
 * Provides secure directory listing and file reading for the vault browser feature.
 * All operations are restricted to the vault boundary to prevent path traversal attacks.
 */

import { readdir, readFile, lstat, realpath } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import type { FileEntry } from "@memory-loop/shared";
import type { ErrorCode } from "@memory-loop/shared";
import { createLogger } from "./logger";

const log = createLogger("FileBrowser");

/**
 * Maximum file size to read before truncation (1MB).
 * Files larger than this will be truncated with a flag set.
 */
export const MAX_FILE_SIZE = 1024 * 1024; // 1MB

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base error for file browser operations.
 */
export class FileBrowserError extends Error {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode) {
    super(message);
    this.name = "FileBrowserError";
    this.code = code;
  }
}

/**
 * Error thrown when a path attempts to escape the vault boundary.
 */
export class PathTraversalError extends FileBrowserError {
  constructor(message: string) {
    super(message, "PATH_TRAVERSAL");
    this.name = "PathTraversalError";
  }
}

/**
 * Error thrown when a requested directory does not exist.
 */
export class DirectoryNotFoundError extends FileBrowserError {
  constructor(message: string) {
    super(message, "DIRECTORY_NOT_FOUND");
    this.name = "DirectoryNotFoundError";
  }
}

/**
 * Error thrown when a requested file does not exist.
 */
export class FileNotFoundError extends FileBrowserError {
  constructor(message: string) {
    super(message, "FILE_NOT_FOUND");
    this.name = "FileNotFoundError";
  }
}

/**
 * Error thrown when a non-.md file is requested for reading.
 */
export class InvalidFileTypeError extends FileBrowserError {
  constructor(message: string) {
    super(message, "INVALID_FILE_TYPE");
    this.name = "InvalidFileTypeError";
  }
}

// =============================================================================
// Path Validation
// =============================================================================

/**
 * Checks if a target path is within the vault boundary.
 * Uses realpath resolution for existing paths, or path.resolve for non-existent paths.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param targetPath - Absolute path to validate
 * @returns true if targetPath is within vaultPath
 */
export async function isPathWithinVault(
  vaultPath: string,
  targetPath: string
): Promise<boolean> {
  try {
    // Get real path of vault (must exist)
    const realVaultPath = await realpath(vaultPath);

    // Try to get real path of target (may not exist)
    let realTargetPath: string;
    try {
      realTargetPath = await realpath(targetPath);
    } catch {
      // Target doesn't exist - use resolved path for boundary check
      // This is safe because we're just checking the path string,
      // not accessing the filesystem at this location
      realTargetPath = resolve(targetPath);
    }

    // Check if target starts with vault path
    // Add trailing separator to prevent partial matches (e.g., /vault vs /vault2)
    const normalizedVault = realVaultPath.endsWith("/")
      ? realVaultPath
      : realVaultPath + "/";

    return (
      realTargetPath === realVaultPath ||
      realTargetPath.startsWith(normalizedVault)
    );
  } catch {
    // If vault realpath fails, vault itself is invalid
    return false;
  }
}

/**
 * Validates and resolves a relative path within a vault.
 * Throws PathTraversalError if the path escapes the vault boundary.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param relativePath - Path relative to vault root
 * @returns The validated absolute path
 * @throws PathTraversalError if path escapes vault boundary
 */
export async function validatePath(
  vaultPath: string,
  relativePath: string
): Promise<string> {
  // Construct the target path
  const targetPath = resolve(vaultPath, relativePath);

  // Check if target is within vault
  if (!(await isPathWithinVault(vaultPath, targetPath))) {
    log.warn(`Path traversal attempt: ${relativePath}`);
    throw new PathTraversalError(
      `Path "${relativePath}" is outside the vault boundary`
    );
  }

  return targetPath;
}

// =============================================================================
// Directory Listing
// =============================================================================

/**
 * Lists the contents of a directory within a vault.
 * Returns entries sorted with directories first, then files, alphabetically.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param relativePath - Path relative to vault root (empty string for root)
 * @returns Array of FileEntry objects sorted by type and name
 * @throws PathTraversalError if path escapes vault boundary
 * @throws DirectoryNotFoundError if directory does not exist
 */
export async function listDirectory(
  vaultPath: string,
  relativePath: string
): Promise<FileEntry[]> {
  log.debug(`Listing directory: ${relativePath || "/"} in ${vaultPath}`);

  // Handle empty path as root
  const targetPath =
    relativePath === "" ? vaultPath : await validatePath(vaultPath, relativePath);

  // Check if directory exists and is not a symlink
  try {
    const stats = await lstat(targetPath);

    if (stats.isSymbolicLink()) {
      log.warn(`Symlink rejected: ${relativePath}`);
      throw new PathTraversalError(
        `Path "${relativePath}" is a symbolic link and cannot be accessed`
      );
    }

    if (!stats.isDirectory()) {
      throw new DirectoryNotFoundError(
        `Path "${relativePath}" is not a directory`
      );
    }
  } catch (error) {
    if (error instanceof FileBrowserError) {
      throw error;
    }
    throw new DirectoryNotFoundError(
      `Directory "${relativePath}" does not exist`
    );
  }

  // Read directory entries
  const entries = await readdir(targetPath, { withFileTypes: true });

  // Filter and map entries
  const fileEntries: FileEntry[] = [];

  for (const entry of entries) {
    // Skip hidden files (starting with .)
    if (entry.name.startsWith(".")) {
      continue;
    }

    // Check if entry is a symlink
    const entryPath = join(targetPath, entry.name);
    const entryStats = await lstat(entryPath);

    if (entryStats.isSymbolicLink()) {
      log.debug(`Skipping symlink: ${entry.name}`);
      continue;
    }

    // Determine type
    if (entryStats.isDirectory()) {
      fileEntries.push({
        name: entry.name,
        type: "directory",
        path: relativePath === "" ? entry.name : `${relativePath}/${entry.name}`,
      });
    } else if (entryStats.isFile()) {
      fileEntries.push({
        name: entry.name,
        type: "file",
        path: relativePath === "" ? entry.name : `${relativePath}/${entry.name}`,
      });
    }
    // Skip other types (sockets, devices, etc.)
  }

  // Sort: directories first, then files, alphabetically within each group
  fileEntries.sort((a, b) => {
    // Directories before files
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    // Alphabetical within same type (case-insensitive)
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  log.debug(`Found ${fileEntries.length} entries`);
  return fileEntries;
}

// =============================================================================
// File Reading
// =============================================================================

/**
 * Result of reading a markdown file.
 */
export interface FileReadResult {
  /** The file content (may be truncated) */
  content: string;
  /** Whether the content was truncated due to size limit */
  truncated: boolean;
}

/**
 * Reads a markdown file from the vault.
 * Files larger than 1MB are truncated.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param relativePath - Path relative to vault root
 * @returns FileReadResult with content and truncation status
 * @throws PathTraversalError if path escapes vault boundary
 * @throws FileNotFoundError if file does not exist
 * @throws InvalidFileTypeError if file is not a .md file
 */
export async function readMarkdownFile(
  vaultPath: string,
  relativePath: string
): Promise<FileReadResult> {
  log.debug(`Reading file: ${relativePath} in ${vaultPath}`);

  // Validate file extension
  const ext = extname(relativePath).toLowerCase();
  if (ext !== ".md") {
    throw new InvalidFileTypeError(
      `Only markdown (.md) files can be read. Requested: ${ext || "(no extension)"}`
    );
  }

  // Validate path is within vault
  const targetPath = await validatePath(vaultPath, relativePath);

  // Check if file exists and is not a symlink
  try {
    const stats = await lstat(targetPath);

    if (stats.isSymbolicLink()) {
      log.warn(`Symlink rejected: ${relativePath}`);
      throw new PathTraversalError(
        `Path "${relativePath}" is a symbolic link and cannot be accessed`
      );
    }

    if (!stats.isFile()) {
      throw new FileNotFoundError(`Path "${relativePath}" is not a file`);
    }
  } catch (error) {
    if (error instanceof FileBrowserError) {
      throw error;
    }
    throw new FileNotFoundError(`File "${relativePath}" does not exist`);
  }

  // Read file content
  const buffer = await readFile(targetPath);

  // Check for truncation
  if (buffer.length > MAX_FILE_SIZE) {
    log.info(
      `File truncated: ${relativePath} (${buffer.length} bytes > ${MAX_FILE_SIZE})`
    );
    return {
      content: buffer.subarray(0, MAX_FILE_SIZE).toString("utf-8"),
      truncated: true,
    };
  }

  return {
    content: buffer.toString("utf-8"),
    truncated: false,
  };
}

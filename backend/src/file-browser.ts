/**
 * File Browser
 *
 * Provides secure directory listing and file reading for the vault browser feature.
 * All operations are restricted to the vault boundary to prevent path traversal attacks.
 */

import { readdir, readFile, writeFile, lstat, realpath, unlink, rename, mkdir, stat } from "node:fs/promises";
import { join, resolve, extname, basename } from "node:path";
import type { FileEntry } from "@memory-loop/shared";
import type { ErrorCode } from "@memory-loop/shared";
import { createLogger } from "./logger";

const log = createLogger("FileBrowser");

/**
 * Maximum file size to read before truncation (1MB).
 * Files larger than this will be truncated with a flag set.
 */
export const MAX_FILE_SIZE = 1024 * 1024; // 1MB

/**
 * Allowed file extensions for text file reading/writing.
 * Lowercase, including the leading dot.
 */
const ALLOWED_TEXT_EXTENSIONS = new Set([".md", ".json", ".txt", ".csv", ".tsv"]);

/**
 * Checks if a file path has an allowed text extension.
 */
function isAllowedTextFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ALLOWED_TEXT_EXTENSIONS.has(ext);
}

/**
 * Formats the allowed extensions for error messages.
 */
function formatAllowedExtensions(): string {
  return Array.from(ALLOWED_TEXT_EXTENSIONS).join(", ");
}

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
 * Reads a text file from the vault.
 * Supports .md and .json files. Files larger than 1MB are truncated.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param relativePath - Path relative to vault root
 * @returns FileReadResult with content and truncation status
 * @throws PathTraversalError if path escapes vault boundary
 * @throws FileNotFoundError if file does not exist
 * @throws InvalidFileTypeError if file is not an allowed text file (.md, .json)
 */
export async function readMarkdownFile(
  vaultPath: string,
  relativePath: string
): Promise<FileReadResult> {
  log.debug(`Reading file: ${relativePath} in ${vaultPath}`);

  // Validate file extension
  if (!isAllowedTextFile(relativePath)) {
    const ext = extname(relativePath).toLowerCase();
    throw new InvalidFileTypeError(
      `Only ${formatAllowedExtensions()} files can be read. Requested: ${ext || "(no extension)"}`
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

// =============================================================================
// File Writing
// =============================================================================

/**
 * Writes content to a text file in the vault.
 * Supports .md and .json files. Only allows writing to existing files.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param relativePath - Path relative to vault root
 * @param content - Content to write to the file
 * @throws PathTraversalError if path escapes vault boundary
 * @throws FileNotFoundError if file does not exist (no new file creation)
 * @throws InvalidFileTypeError if file is not an allowed text file (.md, .json)
 */
export async function writeMarkdownFile(
  vaultPath: string,
  relativePath: string,
  content: string
): Promise<void> {
  log.debug(`Writing file: ${relativePath} in ${vaultPath}`);

  // Validate file extension
  if (!isAllowedTextFile(relativePath)) {
    const ext = extname(relativePath).toLowerCase();
    throw new InvalidFileTypeError(
      `Only ${formatAllowedExtensions()} files can be written. Requested: ${ext || "(no extension)"}`
    );
  }

  // Validate path is within vault
  const targetPath = await validatePath(vaultPath, relativePath);

  // Check if file exists and is not a symlink
  try {
    const stats = await lstat(targetPath);

    if (stats.isSymbolicLink()) {
      log.warn(`Symlink rejected for write: ${relativePath}`);
      throw new PathTraversalError(
        `Path "${relativePath}" is a symbolic link and cannot be written`
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

  // Write content to file
  await writeFile(targetPath, content, "utf-8");
  log.debug(`Successfully wrote ${content.length} bytes to ${relativePath}`);
}

// =============================================================================
// File Deletion
// =============================================================================

/**
 * Deletes a file from the vault.
 * Only allows deleting files (not directories) for safety.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param relativePath - Path relative to vault root
 * @throws PathTraversalError if path escapes vault boundary or is a symlink
 * @throws FileNotFoundError if file does not exist
 * @throws InvalidFileTypeError if target is a directory (not a file)
 */
export async function deleteFile(
  vaultPath: string,
  relativePath: string
): Promise<void> {
  log.info(`Deleting file: ${relativePath} in ${vaultPath}`);

  // Validate path is within vault
  const targetPath = await validatePath(vaultPath, relativePath);

  // Check if target exists and is a file (not symlink or directory)
  try {
    const stats = await lstat(targetPath);

    if (stats.isSymbolicLink()) {
      log.warn(`Symlink rejected for delete: ${relativePath}`);
      throw new PathTraversalError(
        `Path "${relativePath}" is a symbolic link and cannot be deleted`
      );
    }

    if (!stats.isFile()) {
      throw new InvalidFileTypeError(
        `Can only delete files, not directories. Path "${relativePath}" is a directory`
      );
    }
  } catch (error) {
    if (error instanceof FileBrowserError) {
      throw error;
    }
    throw new FileNotFoundError(`File "${relativePath}" does not exist`);
  }

  // Delete the file
  await unlink(targetPath);
  log.info(`Successfully deleted file: ${relativePath}`);
}

// =============================================================================
// Directory Archiving
// =============================================================================

/**
 * Result of archiving a directory.
 */
export interface ArchiveResult {
  /** The original path that was archived */
  originalPath: string;
  /** The destination path in the archive */
  archivePath: string;
}

/**
 * Gets the newest modification time of any file within a directory (recursive).
 * Used to determine the YYYY-MM archive folder.
 *
 * @param dirPath - Absolute path to the directory
 * @returns Date of the newest file modification, or current date if empty
 */
async function getNewestFileDate(dirPath: string): Promise<Date> {
  let newestTime = 0;

  async function scanDir(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name);

      try {
        const stats = await lstat(entryPath);

        if (stats.isSymbolicLink()) {
          continue; // Skip symlinks
        }

        if (stats.isFile()) {
          if (stats.mtimeMs > newestTime) {
            newestTime = stats.mtimeMs;
          }
        } else if (stats.isDirectory()) {
          await scanDir(entryPath);
        }
      } catch {
        // Skip entries we can't stat
      }
    }
  }

  await scanDir(dirPath);

  // If no files found, use current date
  return newestTime > 0 ? new Date(newestTime) : new Date();
}

/**
 * Formats a date as YYYY-MM for archive folder naming.
 */
function formatArchiveMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Archives a directory by moving it to the archive folder.
 * The archive folder is organized by YYYY-MM based on the newest file modification date.
 *
 * For "chats" directories (detected by name), they are archived to archive/YYYY-MM/chats/
 * For other directories (projects, areas), they are archived to archive/YYYY-MM/
 *
 * @param vaultPath - Absolute path to the vault root (content root)
 * @param relativePath - Path relative to vault root
 * @param archiveRoot - Relative path to archive directory (default: "07_Archive")
 * @returns ArchiveResult with original and destination paths
 * @throws PathTraversalError if path escapes vault boundary or is a symlink
 * @throws DirectoryNotFoundError if directory does not exist
 * @throws InvalidFileTypeError if target is a file (not a directory)
 */
export async function archiveFile(
  vaultPath: string,
  relativePath: string,
  archiveRoot: string = "07_Archive"
): Promise<ArchiveResult> {
  log.info(`Archiving directory: ${relativePath} in ${vaultPath}`);

  // Validate path is within vault
  const targetPath = await validatePath(vaultPath, relativePath);

  // Check if target exists and is a directory (not symlink or file)
  try {
    const stats = await lstat(targetPath);

    if (stats.isSymbolicLink()) {
      log.warn(`Symlink rejected for archive: ${relativePath}`);
      throw new PathTraversalError(
        `Path "${relativePath}" is a symbolic link and cannot be archived`
      );
    }

    if (!stats.isDirectory()) {
      throw new InvalidFileTypeError(
        `Can only archive directories, not files. Path "${relativePath}" is a file`
      );
    }
  } catch (error) {
    if (error instanceof FileBrowserError) {
      throw error;
    }
    throw new DirectoryNotFoundError(`Directory "${relativePath}" does not exist`);
  }

  // Get the newest file date for YYYY-MM determination
  const newestDate = await getNewestFileDate(targetPath);
  const archiveMonth = formatArchiveMonth(newestDate);

  // Determine if this is a "chats" directory
  const dirName = basename(relativePath);
  const isChatsDir = dirName.toLowerCase() === "chats";

  // Build the archive destination path
  let archiveDestDir: string;
  let archiveDestRelative: string;

  if (isChatsDir) {
    // Chats go to archive/YYYY-MM/chats/
    archiveDestDir = join(vaultPath, archiveRoot, archiveMonth, "chats");
    archiveDestRelative = `${archiveRoot}/${archiveMonth}/chats`;
  } else {
    // Projects/areas go to archive/YYYY-MM/
    archiveDestDir = join(vaultPath, archiveRoot, archiveMonth);
    archiveDestRelative = `${archiveRoot}/${archiveMonth}`;
  }

  // Create the archive destination directory if it doesn't exist
  await mkdir(archiveDestDir, { recursive: true });

  // Final destination for the directory itself
  const finalDestPath = join(archiveDestDir, dirName);
  const finalDestRelative = `${archiveDestRelative}/${dirName}`;

  // Check if destination already exists
  try {
    await stat(finalDestPath);
    // If we get here, destination exists
    throw new FileBrowserError(
      `Archive destination already exists: ${finalDestRelative}`,
      "INTERNAL_ERROR"
    );
  } catch (error) {
    if (error instanceof FileBrowserError) {
      throw error;
    }
    // Good - destination doesn't exist, we can proceed
  }

  // Move the directory to the archive
  await rename(targetPath, finalDestPath);
  log.info(`Successfully archived ${relativePath} to ${finalDestRelative}`);

  return {
    originalPath: relativePath,
    archivePath: finalDestRelative,
  };
}

// =============================================================================
// Directory Creation
// =============================================================================

/**
 * Allowed characters for directory names: alphanumeric, hyphen, underscore.
 */
const DIRECTORY_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Error thrown when a directory name contains invalid characters.
 */
export class InvalidDirectoryNameError extends FileBrowserError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "InvalidDirectoryNameError";
  }
}

/**
 * Error thrown when attempting to create a directory that already exists.
 */
export class DirectoryExistsError extends FileBrowserError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "DirectoryExistsError";
  }
}

/**
 * Creates a new directory within the vault.
 *
 * @param vaultPath - Absolute path to the vault root (content root)
 * @param parentPath - Parent directory path relative to vault root (empty string for root)
 * @param name - Name of the new directory (alphanumeric with - and _ only)
 * @returns The full relative path of the created directory
 * @throws InvalidDirectoryNameError if name contains invalid characters
 * @throws DirectoryExistsError if directory already exists
 * @throws PathTraversalError if path escapes vault boundary
 * @throws DirectoryNotFoundError if parent directory does not exist
 */
export async function createDirectory(
  vaultPath: string,
  parentPath: string,
  name: string
): Promise<string> {
  log.info(`Creating directory: ${name} in ${parentPath || "/"}`);

  // Validate directory name
  if (!DIRECTORY_NAME_PATTERN.test(name)) {
    throw new InvalidDirectoryNameError(
      `Directory name "${name}" contains invalid characters. Only alphanumeric, hyphen, and underscore are allowed.`
    );
  }

  // Validate parent path is within vault
  const parentAbsolute = parentPath === ""
    ? vaultPath
    : await validatePath(vaultPath, parentPath);

  // Check parent exists and is a directory
  try {
    const parentStats = await lstat(parentAbsolute);

    if (parentStats.isSymbolicLink()) {
      log.warn(`Symlink rejected for parent: ${parentPath}`);
      throw new PathTraversalError(
        `Parent path "${parentPath}" is a symbolic link and cannot be used`
      );
    }

    if (!parentStats.isDirectory()) {
      throw new DirectoryNotFoundError(
        `Parent path "${parentPath}" is not a directory`
      );
    }
  } catch (error) {
    if (error instanceof FileBrowserError) {
      throw error;
    }
    throw new DirectoryNotFoundError(
      `Parent directory "${parentPath}" does not exist`
    );
  }

  // Build the new directory path
  const newDirAbsolute = join(parentAbsolute, name);
  const newDirRelative = parentPath === "" ? name : `${parentPath}/${name}`;

  // Validate the new path is within vault (defense in depth)
  if (!(await isPathWithinVault(vaultPath, newDirAbsolute))) {
    throw new PathTraversalError(
      `Path "${newDirRelative}" would escape the vault boundary`
    );
  }

  // Check if directory already exists
  try {
    await stat(newDirAbsolute);
    // If we get here, something exists at this path
    throw new DirectoryExistsError(
      `Directory "${newDirRelative}" already exists`
    );
  } catch (error) {
    if (error instanceof DirectoryExistsError) {
      throw error;
    }
    // Good - directory doesn't exist, we can create it
  }

  // Create the directory
  await mkdir(newDirAbsolute);
  log.info(`Successfully created directory: ${newDirRelative}`);

  return newDirRelative;
}

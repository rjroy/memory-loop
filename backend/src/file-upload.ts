/**
 * File Upload Handler
 *
 * Handles secure file upload to vault attachments directory.
 * Validates file types, generates unique filenames, and creates directories as needed.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { isPathWithinVault } from "./file-browser";
import { directoryExists } from "./vault-manager";
import { createLogger } from "./logger";

const log = createLogger("FileUpload");

/**
 * Allowed file extensions for upload, organized by category.
 */
export const ALLOWED_FILE_EXTENSIONS = {
  image: new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"]),
  video: new Set([".mp4", ".mov", ".webm", ".ogg", ".m4v"]),
  document: new Set([".pdf"]),
  text: new Set([".txt", ".md", ".csv", ".tsv", ".json"]),
} as const;

/**
 * All allowed extensions as a flat set for validation.
 */
export const ALL_ALLOWED_EXTENSIONS = new Set([
  ...ALLOWED_FILE_EXTENSIONS.image,
  ...ALLOWED_FILE_EXTENSIONS.video,
  ...ALLOWED_FILE_EXTENSIONS.document,
  ...ALLOWED_FILE_EXTENSIONS.text,
]);

/**
 * Maximum file size in bytes by category.
 * Images: 10MB, Videos: 100MB, Documents: 25MB, Text: 5MB
 */
export const MAX_FILE_SIZES: Record<string, number> = {
  image: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  document: 25 * 1024 * 1024,
  text: 5 * 1024 * 1024,
};

/**
 * Default max size if category not found (10MB).
 */
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

/**
 * Result of a file upload operation.
 */
export interface FileUploadResult {
  success: boolean;
  /** Relative path from content root (on success) */
  path?: string;
  /** Error message (on failure) */
  error?: string;
}

/**
 * Gets the file category for an extension.
 *
 * @param extension - File extension including dot (e.g., ".png")
 * @returns Category name or null if not allowed
 */
export function getFileCategory(extension: string): string | null {
  const ext = extension.toLowerCase();
  for (const [category, extensions] of Object.entries(ALLOWED_FILE_EXTENSIONS)) {
    if (extensions.has(ext)) {
      return category;
    }
  }
  return null;
}

/**
 * Gets the maximum file size for an extension.
 *
 * @param extension - File extension including dot (e.g., ".png")
 * @returns Maximum size in bytes
 */
export function getMaxFileSize(extension: string): number {
  const category = getFileCategory(extension);
  return category ? (MAX_FILE_SIZES[category] ?? DEFAULT_MAX_SIZE) : DEFAULT_MAX_SIZE;
}

/**
 * Generates a unique filename for an uploaded file.
 * Format: YYYY-MM-DD-{category}-XXXXX.ext where XXXXX is random hex.
 *
 * @param extension - File extension including dot (e.g., ".png")
 * @returns Generated filename
 */
export function generateFilename(extension: string): string {
  const date = new Date().toISOString().split("T")[0];
  const randomPart = randomBytes(3).toString("hex").toUpperCase().slice(0, 5);
  const category = getFileCategory(extension) ?? "file";
  return `${date}-${category}-${randomPart}${extension.toLowerCase()}`;
}

/**
 * Validates a file extension.
 *
 * @param extension - File extension including dot (e.g., ".png")
 * @returns true if valid, false otherwise
 */
export function isValidFileExtension(extension: string): boolean {
  return ALL_ALLOWED_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * Uploads a file to the vault's attachment directory.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param contentRoot - Absolute path to the content root
 * @param attachmentPath - Relative attachment directory path (from content root)
 * @param fileBuffer - File data as Buffer
 * @param originalFilename - Original filename (used to extract extension)
 * @returns FileUploadResult with success status and path or error
 */
export async function uploadFile(
  vaultPath: string,
  contentRoot: string,
  attachmentPath: string,
  fileBuffer: Buffer,
  originalFilename: string
): Promise<FileUploadResult> {
  log.info(`Uploading file: ${originalFilename} (${fileBuffer.length} bytes)`);

  // Validate extension
  const ext = extname(originalFilename).toLowerCase();
  if (!isValidFileExtension(ext)) {
    const allowedList = Array.from(ALL_ALLOWED_EXTENSIONS).join(", ");
    log.warn(`Invalid file type: ${ext}`);
    return {
      success: false,
      error: `Invalid file type: ${ext}. Allowed: ${allowedList}`,
    };
  }

  // Validate size based on file category
  const maxSize = getMaxFileSize(ext);
  if (fileBuffer.length > maxSize) {
    const maxMB = maxSize / 1024 / 1024;
    const category = getFileCategory(ext) ?? "file";
    log.warn(`File too large: ${fileBuffer.length} bytes (max ${maxSize} for ${category})`);
    return {
      success: false,
      error: `File too large. Maximum size for ${category} files: ${maxMB}MB`,
    };
  }

  // Generate unique filename
  const filename = generateFilename(ext);
  const relativePath = join(attachmentPath, filename);
  const fullPath = join(contentRoot, relativePath);

  log.debug(`Generated filename: ${filename}`);
  log.debug(`Full path: ${fullPath}`);

  // Validate path is within vault boundary
  if (!(await isPathWithinVault(vaultPath, fullPath))) {
    log.error(`Path traversal detected: ${fullPath}`);
    return {
      success: false,
      error: "Path traversal detected",
    };
  }

  // Ensure attachment directory exists
  const attachmentFullPath = join(contentRoot, attachmentPath);
  if (!(await directoryExists(attachmentFullPath))) {
    log.info(`Creating attachment directory: ${attachmentFullPath}`);
    try {
      await mkdir(attachmentFullPath, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to create attachment directory: ${message}`);
      return {
        success: false,
        error: `Failed to create attachment directory: ${message}`,
      };
    }
  }

  // Write file
  try {
    await writeFile(fullPath, fileBuffer);
    log.info(`File uploaded successfully: ${relativePath}`);
    return {
      success: true,
      path: relativePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to write file: ${message}`);
    return {
      success: false,
      error: `Failed to write file: ${message}`,
    };
  }
}

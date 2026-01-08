/**
 * Image Upload Handler
 *
 * Handles secure image upload to vault attachments directory.
 * Validates file types, generates unique filenames, and creates directories as needed.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { isPathWithinVault } from "./file-browser";
import { directoryExists } from "./vault-manager";
import { createLogger } from "./logger";

const log = createLogger("ImageUpload");

/**
 * Allowed image file extensions for upload.
 */
export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

/**
 * Maximum image file size in bytes (10MB).
 */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/**
 * Result of an image upload operation.
 */
export interface ImageUploadResult {
  success: boolean;
  /** Relative path from content root (on success) */
  path?: string;
  /** Error message (on failure) */
  error?: string;
}

/**
 * Generates a unique filename for an uploaded image.
 * Format: YYYY-MM-DD-image-XXXXX.ext where XXXXX is random hex.
 *
 * @param extension - File extension including dot (e.g., ".png")
 * @returns Generated filename
 */
export function generateImageFilename(extension: string): string {
  const date = new Date().toISOString().split("T")[0];
  const randomPart = randomBytes(3).toString("hex").toUpperCase().slice(0, 5);
  return `${date}-image-${randomPart}${extension}`;
}

/**
 * Validates an image file extension.
 *
 * @param extension - File extension including dot (e.g., ".png")
 * @returns true if valid, false otherwise
 */
export function isValidImageExtension(extension: string): boolean {
  return ALLOWED_IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * Uploads an image to the vault's attachment directory.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param contentRoot - Absolute path to the content root
 * @param attachmentPath - Relative attachment directory path (from content root)
 * @param fileBuffer - Image file data as Buffer
 * @param originalFilename - Original filename (used to extract extension)
 * @returns ImageUploadResult with success status and path or error
 */
export async function uploadImage(
  vaultPath: string,
  contentRoot: string,
  attachmentPath: string,
  fileBuffer: Buffer,
  originalFilename: string
): Promise<ImageUploadResult> {
  log.info(`Uploading image: ${originalFilename} (${fileBuffer.length} bytes)`);

  // Validate extension
  const ext = extname(originalFilename).toLowerCase();
  if (!isValidImageExtension(ext)) {
    const allowedList = Array.from(ALLOWED_IMAGE_EXTENSIONS).join(", ");
    log.warn(`Invalid file type: ${ext}`);
    return {
      success: false,
      error: `Invalid file type: ${ext}. Allowed: ${allowedList}`,
    };
  }

  // Validate size
  if (fileBuffer.length > MAX_IMAGE_SIZE) {
    const maxMB = MAX_IMAGE_SIZE / 1024 / 1024;
    log.warn(`File too large: ${fileBuffer.length} bytes`);
    return {
      success: false,
      error: `File too large. Maximum size: ${maxMB}MB`,
    };
  }

  // Generate unique filename
  const filename = generateImageFilename(ext);
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
    log.info(`Image uploaded successfully: ${relativePath}`);
    return {
      success: true,
      path: relativePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to write image file: ${message}`);
    return {
      success: false,
      error: `Failed to write image file: ${message}`,
    };
  }
}

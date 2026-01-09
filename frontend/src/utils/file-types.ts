/**
 * File Type Utilities
 *
 * Helpers for detecting file types based on extension.
 */

/**
 * Supported image file extensions (lowercase, without dot).
 */
export const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "avif",
  "bmp",
  "ico",
]);

/**
 * Supported video file extensions (lowercase, without dot).
 */
export const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "ogg", "m4v"]);

/**
 * Checks if a file path is an image based on its extension.
 *
 * @param path - File path to check
 * @returns true if the file has a recognized image extension
 */
export function isImageFile(path: string): boolean {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) {
    return false;
  }
  const ext = path.slice(lastDot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Checks if a file path is a video based on its extension.
 *
 * @param path - File path to check
 * @returns true if the file has a recognized video extension
 */
export function isVideoFile(path: string): boolean {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) {
    return false;
  }
  const ext = path.slice(lastDot + 1).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Checks if a file path is a PDF file.
 *
 * @param path - File path to check
 * @returns true if the file has .pdf extension
 */
export function isPdfFile(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

/**
 * Checks if a file path is a markdown file.
 *
 * @param path - File path to check
 * @returns true if the file has .md extension
 */
export function isMarkdownFile(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

/**
 * Checks if a file path is a JSON file.
 *
 * @param path - File path to check
 * @returns true if the file has .json extension
 */
export function isJsonFile(path: string): boolean {
  return path.toLowerCase().endsWith(".json");
}

/**
 * Checks if a file path is a plain text file.
 *
 * @param path - File path to check
 * @returns true if the file has .txt extension
 */
export function isTxtFile(path: string): boolean {
  return path.toLowerCase().endsWith(".txt");
}

/**
 * Encodes a file path for use in URLs.
 * Encodes each path segment separately to preserve directory structure.
 *
 * @param path - File path to encode (e.g., "attachments/my file.png")
 * @returns URL-encoded path with separators preserved (e.g., "attachments/my%20file.png")
 */
export function encodeAssetPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

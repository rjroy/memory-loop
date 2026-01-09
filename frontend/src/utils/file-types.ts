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
 * Checks if a file path is a markdown file.
 *
 * @param path - File path to check
 * @returns true if the file has .md extension
 */
export function isMarkdownFile(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

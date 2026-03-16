/**
 * Filesystem utilities.
 *
 * General-purpose stat wrappers used across the codebase.
 * No domain-specific logic.
 */

import { access, stat } from "node:fs/promises";

/**
 * Checks if a directory exists and is accessible.
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath);
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Checks if a file exists and is accessible.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

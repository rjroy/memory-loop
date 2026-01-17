/**
 * Reference Updater
 *
 * Updates internal references in markdown files when a file or directory is renamed.
 * Supports two reference formats:
 * - Wikilinks: [[file-name]] or [[path/to/file-name]]
 * - Markdown links: [text](path/to/file-name.md)
 */

import { readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { createLogger } from "./logger";

const log = createLogger("ReferenceUpdater");

/**
 * Result of updating references across the vault.
 */
export interface ReferenceUpdateResult {
  /** Number of files that were modified */
  filesModified: number;
  /** Total number of references updated */
  referencesUpdated: number;
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Gets the name without extension from a path.
 */
function getNameWithoutExtension(filePath: string): string {
  const name = basename(filePath);
  const ext = extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/**
 * Recursively finds all markdown files in a directory.
 */
async function findMarkdownFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  async function scanDir(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith(".")) {
        continue;
      }

      const entryPath = join(currentPath, entry.name);

      try {
        const stats = await lstat(entryPath);

        if (stats.isSymbolicLink()) {
          continue; // Skip symlinks
        }

        if (stats.isDirectory()) {
          await scanDir(entryPath);
        } else if (stats.isFile() && entry.name.endsWith(".md")) {
          files.push(entryPath);
        }
      } catch {
        // Skip entries we can't stat
      }
    }
  }

  await scanDir(dirPath);
  return files;
}

/**
 * Updates references in a single markdown file.
 *
 * @param filePath - Absolute path to the markdown file
 * @param oldPath - Old relative path (from content root)
 * @param newPath - New relative path (from content root)
 * @param isDirectory - Whether the renamed item is a directory
 * @returns Number of references updated in this file
 */
async function updateFileReferences(
  filePath: string,
  oldPath: string,
  newPath: string,
  isDirectory: boolean
): Promise<number> {
  const content = await readFile(filePath, "utf-8");
  let updatedContent = content;
  let updateCount = 0;

  const oldName = getNameWithoutExtension(oldPath);
  const newName = getNameWithoutExtension(newPath);
  const oldBasename = basename(oldPath);
  const newBasename = basename(newPath);

  // Pattern 1: Wikilinks [[name]] or [[path/name]]
  // Match [[old-name]] (just the name, no path)
  const wikiLinkNamePattern = new RegExp(
    `\\[\\[${escapeRegex(oldName)}\\]\\]`,
    "g"
  );
  const wikiLinkNameMatches = updatedContent.match(wikiLinkNamePattern);
  if (wikiLinkNameMatches) {
    updatedContent = updatedContent.replace(wikiLinkNamePattern, `[[${newName}]]`);
    updateCount += wikiLinkNameMatches.length;
  }

  // Match [[path/old-name]] (full path without extension)
  const wikiLinkPathPattern = new RegExp(
    `\\[\\[${escapeRegex(oldPath.replace(/\.[^.]+$/, ""))}\\]\\]`,
    "g"
  );
  const wikiLinkPathMatches = updatedContent.match(wikiLinkPathPattern);
  if (wikiLinkPathMatches) {
    updatedContent = updatedContent.replace(
      wikiLinkPathPattern,
      `[[${newPath.replace(/\.[^.]+$/, "")}]]`
    );
    updateCount += wikiLinkPathMatches.length;
  }

  // For directories, also match wikilinks that reference files inside the directory
  if (isDirectory) {
    // Match [[old-dir/anything]] and replace with [[new-dir/anything]]
    const dirWikiLinkPattern = new RegExp(
      `\\[\\[${escapeRegex(oldPath)}/([^\\]]+)\\]\\]`,
      "g"
    );
    const dirMatches = updatedContent.match(dirWikiLinkPattern);
    if (dirMatches) {
      updatedContent = updatedContent.replace(
        dirWikiLinkPattern,
        `[[${newPath}/$1]]`
      );
      updateCount += dirMatches.length;
    }
  }

  // Pattern 2: Markdown links [text](path/name.ext)
  // Match [text](old-path) where old-path is the full path with extension
  const mdLinkPattern = new RegExp(
    `\\[([^\\]]+)\\]\\(${escapeRegex(oldPath)}\\)`,
    "g"
  );
  const mdLinkMatches = updatedContent.match(mdLinkPattern);
  if (mdLinkMatches) {
    updatedContent = updatedContent.replace(
      mdLinkPattern,
      `[$1](${newPath})`
    );
    updateCount += mdLinkMatches.length;
  }

  // Also match markdown links with just the filename (for files in same directory)
  const mdLinkNamePattern = new RegExp(
    `\\[([^\\]]+)\\]\\(${escapeRegex(oldBasename)}\\)`,
    "g"
  );
  const mdLinkNameMatches = updatedContent.match(mdLinkNamePattern);
  if (mdLinkNameMatches) {
    updatedContent = updatedContent.replace(
      mdLinkNamePattern,
      `[$1](${newBasename})`
    );
    updateCount += mdLinkNameMatches.length;
  }

  // For directories, update markdown links to files inside
  if (isDirectory) {
    const dirMdLinkPattern = new RegExp(
      `\\[([^\\]]+)\\]\\(${escapeRegex(oldPath)}/([^)]+)\\)`,
      "g"
    );
    const dirMdMatches = updatedContent.match(dirMdLinkPattern);
    if (dirMdMatches) {
      updatedContent = updatedContent.replace(
        dirMdLinkPattern,
        `[$1](${newPath}/$2)`
      );
      updateCount += dirMdMatches.length;
    }
  }

  // Write back if changed
  if (updateCount > 0) {
    await writeFile(filePath, updatedContent, "utf-8");
    log.debug(`Updated ${updateCount} references in ${filePath}`);
  }

  return updateCount;
}

/**
 * Updates all references to a renamed file or directory across the vault.
 *
 * @param vaultPath - Absolute path to the vault content root
 * @param oldPath - Old relative path (from content root)
 * @param newPath - New relative path (from content root)
 * @param isDirectory - Whether the renamed item is a directory
 * @returns Result with counts of files modified and references updated
 */
export async function updateReferences(
  vaultPath: string,
  oldPath: string,
  newPath: string,
  isDirectory: boolean
): Promise<ReferenceUpdateResult> {
  log.info(`Updating references: ${oldPath} -> ${newPath} (isDirectory: ${isDirectory})`);

  // Find all markdown files in the vault
  const mdFiles = await findMarkdownFiles(vaultPath);
  log.debug(`Found ${mdFiles.length} markdown files to scan`);

  let filesModified = 0;
  let referencesUpdated = 0;

  // Update references in each file
  for (const filePath of mdFiles) {
    try {
      const count = await updateFileReferences(filePath, oldPath, newPath, isDirectory);
      if (count > 0) {
        filesModified++;
        referencesUpdated += count;
      }
    } catch (error) {
      log.warn(`Failed to update references in ${filePath}:`, error);
      // Continue with other files
    }
  }

  log.info(`Updated ${referencesUpdated} references in ${filesModified} files`);
  return { filesModified, referencesUpdated };
}

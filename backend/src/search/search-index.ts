/**
 * Search Index Manager
 *
 * Manages per-vault search indexes for file name and content search.
 * Uses a custom fuzzy matcher for file names and MiniSearch for content indexing.
 *
 * Features:
 * - Lazy loading: index builds on first search, not vault select
 * - Scope enforcement: only indexes .md files within contentRoot
 * - Excludes hidden folders (starting with .)
 *
 * @see .sdd/plans/2026-01-07-recall-search-plan.md (TD-2, TD-3, TD-6)
 */

import { readdir, readFile, stat, lstat } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import MiniSearch from "minisearch";
import type { FileSearchResult, ContentSearchResult, ContextSnippet } from "@memory-loop/shared";
import { fuzzySearchFiles, escapeRegex, type FuzzyMatchFile } from "./fuzzy-matcher";
import { isPathWithinVault } from "../file-browser";
import { createLogger } from "../logger";

const log = createLogger("SearchIndex");

// =============================================================================
// Types
// =============================================================================

/**
 * Represents an indexed file with metadata for incremental updates.
 */
export interface IndexedFile {
  /** Relative path from content root */
  path: string;
  /** File name without path */
  name: string;
  /** Last modified timestamp (ms since epoch) */
  mtime: number;
}

/**
 * Document structure stored in MiniSearch content index.
 */
interface ContentDocument {
  /** Unique identifier (same as path) */
  id: string;
  /** Relative path from content root */
  path: string;
  /** Full file content */
  content: string;
}

/**
 * Options for search operations.
 */
export interface SearchOptions {
  /** Maximum number of results to return (default: 50) */
  limit?: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Default maximum search results */
const DEFAULT_LIMIT = 50;

/** Maximum number of snippets to return per file */
const MAX_SNIPPETS_PER_FILE = 10;

/** Number of context lines before and after a match */
const CONTEXT_LINES = 2;

// =============================================================================
// Search Index Manager
// =============================================================================

/**
 * Manages the search index for a single vault.
 *
 * The index is lazily loaded on the first search operation to avoid
 * slowing down vault selection. Index building crawls all .md files
 * within the contentRoot, excluding hidden folders like .obsidian.
 *
 * @example
 * ```typescript
 * const manager = new SearchIndexManager("/path/to/vault");
 * const files = await manager.searchFiles("test", { limit: 20 });
 * const content = await manager.searchContent("TODO", { limit: 20 });
 * ```
 */
export class SearchIndexManager {
  private readonly contentRoot: string;
  private fileList: IndexedFile[] = [];
  private contentIndex: MiniSearch<ContentDocument> | null = null;
  private indexBuilt = false;
  private buildingIndex = false;

  /**
   * Creates a new SearchIndexManager for a vault.
   *
   * @param contentRoot - Absolute path to the vault's content root directory
   */
  constructor(contentRoot: string) {
    this.contentRoot = contentRoot;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Searches for files by name using fuzzy subsequence matching.
   *
   * The search is case-insensitive and ranks results by:
   * - Consecutive character matches
   * - Match start position
   * - Word boundary matches
   *
   * @param query - Search query string
   * @param options - Search options (limit)
   * @returns Array of matching files sorted by relevance
   */
  async searchFiles(query: string, options: SearchOptions = {}): Promise<FileSearchResult[]> {
    const { limit = DEFAULT_LIMIT } = options;

    // Ensure index is built
    await this.ensureIndexBuilt();

    // Convert file list to fuzzy match format
    const fuzzyFiles: FuzzyMatchFile[] = this.fileList.map((f) => ({
      name: f.name,
      path: f.path,
    }));

    return fuzzySearchFiles(query, fuzzyFiles, { limit });
  }

  /**
   * Searches file contents using full-text search.
   *
   * Uses MiniSearch with prefix matching, fuzzy matching (0.2 threshold),
   * and AND combination for multi-term queries.
   *
   * @param query - Search query string
   * @param options - Search options (limit)
   * @returns Array of matching files with match counts, sorted by relevance
   */
  async searchContent(query: string, options: SearchOptions = {}): Promise<ContentSearchResult[]> {
    const { limit = DEFAULT_LIMIT } = options;

    // Handle empty query
    if (!query || query.trim() === "") {
      return [];
    }

    // Ensure index is built
    await this.ensureIndexBuilt();

    if (!this.contentIndex) {
      return [];
    }

    // Search using MiniSearch
    const searchResults = this.contentIndex.search(query, {
      prefix: true,
      fuzzy: 0.2,
      combineWith: "AND",
    });

    // Convert to ContentSearchResult format
    const results: ContentSearchResult[] = [];

    for (const result of searchResults.slice(0, limit)) {
      // MiniSearch returns id as type any, but we know it's a string (the path)
      const filePath = String(result.id);
      const fileName = basename(filePath);

      // Count actual matches in the file content
      const matchCount = await this.countMatches(filePath, query);

      results.push({
        path: filePath,
        name: fileName,
        matchCount,
      });
    }

    return results;
  }

  /**
   * Gets context snippets for a specific file matching a query.
   *
   * Returns up to 10 snippets per file, each containing the matched line
   * with 2 lines of context before and after.
   *
   * @param filePath - Relative path to the file
   * @param query - Search query to find matches
   * @returns Array of context snippets
   */
  async getSnippets(filePath: string, query: string): Promise<ContextSnippet[]> {
    // Handle empty query
    if (!query || query.trim() === "") {
      return [];
    }

    // Validate path is within content root
    const absolutePath = join(this.contentRoot, filePath);
    if (!(await isPathWithinVault(this.contentRoot, absolutePath))) {
      log.warn(`Path traversal attempt in getSnippets: ${filePath}`);
      return [];
    }

    // Read file content
    let content: string;
    try {
      content = await readFile(absolutePath, "utf-8");
    } catch {
      log.debug(`File not found for snippets: ${filePath}`);
      return [];
    }

    const lines = content.split("\n");
    const snippets: ContextSnippet[] = [];

    // Create case-insensitive regex for matching
    // Escape special characters to prevent regex injection
    const escapedQuery = escapeRegex(query);
    const queryRegex = new RegExp(escapedQuery, "gi");

    // Find all matching lines
    for (let i = 0; i < lines.length && snippets.length < MAX_SNIPPETS_PER_FILE; i++) {
      if (queryRegex.test(lines[i])) {
        // Reset regex lastIndex for next test
        queryRegex.lastIndex = 0;

        const lineNumber = i + 1; // 1-indexed
        const contextBefore: string[] = [];
        const contextAfter: string[] = [];

        // Get context before
        for (let j = Math.max(0, i - CONTEXT_LINES); j < i; j++) {
          contextBefore.push(lines[j]);
        }

        // Get context after
        for (let j = i + 1; j <= Math.min(lines.length - 1, i + CONTEXT_LINES); j++) {
          contextAfter.push(lines[j]);
        }

        snippets.push({
          lineNumber,
          line: lines[i],
          contextBefore,
          contextAfter,
        });
      }
    }

    return snippets;
  }

  /**
   * Returns the current file list.
   * Useful for testing and debugging.
   */
  getFileList(): IndexedFile[] {
    return [...this.fileList];
  }

  /**
   * Returns whether the index has been built.
   */
  isIndexBuilt(): boolean {
    return this.indexBuilt;
  }

  /**
   * Forces a rebuild of the index.
   * Useful when files have changed and you want to refresh without waiting.
   */
  async rebuildIndex(): Promise<void> {
    this.indexBuilt = false;
    this.buildingIndex = false;
    await this.buildIndex();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Ensures the index is built before performing a search.
   * If the index is already built, this is a no-op.
   * If another build is in progress, waits for it to complete.
   */
  private async ensureIndexBuilt(): Promise<void> {
    if (this.indexBuilt) {
      return;
    }

    // Wait if already building
    if (this.buildingIndex) {
      while (this.buildingIndex) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return;
    }

    await this.buildIndex();
  }

  /**
   * Builds the search index by crawling .md files in the content root.
   *
   * This method:
   * 1. Recursively finds all .md files within contentRoot
   * 2. Excludes hidden folders (starting with .)
   * 3. Builds both the file list (for name search) and content index (for content search)
   */
  private async buildIndex(): Promise<void> {
    if (this.buildingIndex) {
      return;
    }

    this.buildingIndex = true;
    log.info(`Building search index for: ${this.contentRoot}`);
    const startTime = Date.now();

    try {
      // Reset index state
      this.fileList = [];
      this.contentIndex = new MiniSearch<ContentDocument>({
        fields: ["content"],
        storeFields: ["path"],
      });

      // Crawl and index files
      await this.crawlDirectory("");

      this.indexBuilt = true;
      const duration = Date.now() - startTime;
      log.info(`Index built: ${this.fileList.length} files in ${duration}ms`);
    } catch (error) {
      log.error("Failed to build index", error);
      throw error;
    } finally {
      this.buildingIndex = false;
    }
  }

  /**
   * Recursively crawls a directory, indexing .md files.
   *
   * @param relativePath - Path relative to contentRoot
   */
  private async crawlDirectory(relativePath: string): Promise<void> {
    const absolutePath = relativePath === "" ? this.contentRoot : join(this.contentRoot, relativePath);

    let entries;
    try {
      entries = await readdir(absolutePath, { withFileTypes: true });
    } catch (error) {
      log.debug(`Cannot read directory: ${relativePath}`, error);
      return;
    }

    for (const entry of entries) {
      // Skip hidden files and directories (starting with .)
      if (entry.name.startsWith(".")) {
        continue;
      }

      const entryRelativePath = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
      const entryAbsolutePath = join(this.contentRoot, entryRelativePath);

      // Skip symlinks for security
      try {
        const lstats = await lstat(entryAbsolutePath);
        if (lstats.isSymbolicLink()) {
          log.debug(`Skipping symlink: ${entryRelativePath}`);
          continue;
        }
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        // Recursively crawl subdirectories
        await this.crawlDirectory(entryRelativePath);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
        // Index .md files
        await this.indexFile(entryRelativePath, entryAbsolutePath);
      }
    }
  }

  /**
   * Indexes a single .md file.
   *
   * @param relativePath - Path relative to contentRoot
   * @param absolutePath - Absolute path to the file
   */
  private async indexFile(relativePath: string, absolutePath: string): Promise<void> {
    try {
      // Get file stats for mtime
      const stats = await stat(absolutePath);

      // Add to file list
      this.fileList.push({
        path: relativePath,
        name: basename(relativePath),
        mtime: stats.mtimeMs,
      });

      // Read content for content index
      const content = await readFile(absolutePath, "utf-8");

      // Add to content index
      this.contentIndex?.add({
        id: relativePath,
        path: relativePath,
        content,
      });
    } catch (error) {
      log.debug(`Failed to index file: ${relativePath}`, error);
    }
  }

  /**
   * Counts the number of query matches in a file.
   *
   * @param filePath - Relative path to the file
   * @param query - Search query
   * @returns Number of matches found
   */
  private async countMatches(filePath: string, query: string): Promise<number> {
    const absolutePath = join(this.contentRoot, filePath);

    try {
      const content = await readFile(absolutePath, "utf-8");

      // Count case-insensitive matches
      const escapedQuery = escapeRegex(query);
      const regex = new RegExp(escapedQuery, "gi");
      const matches = content.match(regex);

      return matches ? matches.length : 0;
    } catch {
      return 0;
    }
  }
}

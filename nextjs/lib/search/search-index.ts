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

import { readdir, readFile, writeFile, stat, lstat, mkdir, rm } from "node:fs/promises";
import { join, basename, extname, dirname } from "node:path";
import MiniSearch from "minisearch";
import type { FileSearchResult, ContentSearchResult, ContextSnippet } from "@/lib/schemas";
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

/**
 * Persisted index data structure for JSON storage.
 */
export interface IndexData {
  /** Schema version for migration detection */
  version: string;
  /** Timestamp when the index was last updated (ms since epoch) */
  lastUpdated: number;
  /** List of indexed files with metadata */
  fileList: IndexedFile[];
  /** Serialized MiniSearch index state */
  contentIndex: object;
}

// =============================================================================
// Constants
// =============================================================================

/** Current index version for migration detection */
export const INDEX_VERSION = "1.0.0";

/** Metadata directory relative to content root */
const METADATA_DIR = "06_Metadata/memory-loop";

/** Index file name within metadata directory */
const INDEX_FILE = "search-index.json";

/** Default maximum search results */
const DEFAULT_LIMIT = 50;

/** Maximum number of snippets to return per file */
const MAX_SNIPPETS_PER_FILE = 10;

/** Batch size for parallel file reading during index build */
const FILE_READ_BATCH_SIZE = 50;

/** Number of context lines before and after a match */
const CONTEXT_LINES = 2;

/** Content search timeout in milliseconds (REQ-NF-9) */
const SEARCH_TIMEOUT_MS = 500;

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
   * Returns the content root path for this index.
   */
  getContentRoot(): string {
    return this.contentRoot;
  }

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
   * Includes timeout handling (REQ-NF-9): returns partial results after 500ms.
   * Excludes deleted files gracefully (REQ-F-28): files that no longer exist
   * are filtered from results.
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

    // Convert to ContentSearchResult format with timeout handling (REQ-NF-9)
    const results: ContentSearchResult[] = [];
    const startTime = Date.now();
    let timedOut = false;

    for (const result of searchResults.slice(0, limit)) {
      // Check timeout - return partial results if exceeded (REQ-NF-9)
      if (Date.now() - startTime > SEARCH_TIMEOUT_MS) {
        log.debug(`Content search timeout after ${results.length} results`);
        timedOut = true;
        break;
      }

      // MiniSearch returns id as type any, but we know it's a string (the path)
      const filePath = String(result.id);

      // Check if file still exists (REQ-F-28: exclude deleted files)
      const absolutePath = join(this.contentRoot, filePath);
      try {
        await stat(absolutePath);
      } catch {
        // File no longer exists, skip it gracefully
        log.debug(`Excluding deleted file from results: ${filePath}`);
        continue;
      }

      const fileName = basename(filePath);

      // Count actual matches in the file content
      // MiniSearch uses fuzzy matching, so a file might be returned even if
      // the exact query string doesn't appear in it. Skip such results.
      const matchCount = await this.countMatches(filePath, query);
      if (matchCount === 0) {
        log.debug(`Skipping fuzzy-only match (no exact matches): ${filePath}`);
        continue;
      }

      results.push({
        path: filePath,
        name: fileName,
        matchCount,
      });
    }

    if (timedOut) {
      log.info(`Content search timed out, returning ${results.length} partial results`);
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

  /**
   * Returns the path to the index file for this vault.
   */
  getIndexPath(): string {
    return join(this.contentRoot, METADATA_DIR, INDEX_FILE);
  }

  /**
   * Saves the current index to a JSON file.
   *
   * Creates the metadata directory if it doesn't exist.
   * The index is saved to {contentRoot}/06_Metadata/memory-loop/search-index.json
   *
   * @throws Error if index is not built or save fails
   */
  async saveIndex(): Promise<void> {
    if (!this.indexBuilt || !this.contentIndex) {
      throw new Error("Cannot save index: index not built");
    }

    const indexPath = this.getIndexPath();
    const indexDir = dirname(indexPath);

    // Create metadata directory if it doesn't exist
    await mkdir(indexDir, { recursive: true });

    const indexData: IndexData = {
      version: INDEX_VERSION,
      lastUpdated: Date.now(),
      fileList: this.fileList,
      contentIndex: this.contentIndex.toJSON(),
    };

    await writeFile(indexPath, JSON.stringify(indexData, null, 2), "utf-8");
    log.info(`Index saved to: ${indexPath}`);
  }

  /**
   * Loads the index from a JSON file.
   *
   * Returns false if the index file doesn't exist, version mismatches, or
   * the file is corrupted (REQ-F-27). On version mismatch or corruption,
   * the existing index file is deleted to allow a fresh rebuild.
   *
   * @returns true if index was loaded successfully, false otherwise
   */
  async loadIndex(): Promise<boolean> {
    const indexPath = this.getIndexPath();

    try {
      const content = await readFile(indexPath, "utf-8");
      let indexData: IndexData;

      // Parse JSON with explicit error handling for corruption (REQ-F-27)
      try {
        indexData = JSON.parse(content) as IndexData;
      } catch {
        log.warn(`Corrupted index file (invalid JSON), deleting and rebuilding: ${indexPath}`);
        try {
          await rm(indexPath);
        } catch {
          // Ignore delete errors
        }
        return false;
      }

      // Validate required fields exist (corruption check)
      if (
        !indexData ||
        typeof indexData.version !== "string" ||
        !Array.isArray(indexData.fileList) ||
        !indexData.contentIndex
      ) {
        log.warn(`Corrupted index file (missing required fields), deleting and rebuilding: ${indexPath}`);
        try {
          await rm(indexPath);
        } catch {
          // Ignore delete errors
        }
        return false;
      }

      // Check version compatibility
      if (indexData.version !== INDEX_VERSION) {
        log.warn(
          `Index version mismatch: found ${indexData.version}, expected ${INDEX_VERSION}. Rebuilding.`
        );
        // Delete the old index file
        await rm(indexPath);
        return false;
      }

      // Restore MiniSearch index with the same configuration
      try {
        this.contentIndex = MiniSearch.loadJSON<ContentDocument>(
          JSON.stringify(indexData.contentIndex),
          {
            fields: ["content"],
            storeFields: ["path"],
          }
        );
      } catch {
        log.warn(`Corrupted index file (invalid MiniSearch data), deleting and rebuilding: ${indexPath}`);
        try {
          await rm(indexPath);
        } catch {
          // Ignore delete errors
        }
        return false;
      }

      this.fileList = indexData.fileList;
      this.indexBuilt = true;

      log.info(
        `Index loaded from: ${indexPath} (${this.fileList.length} files, last updated: ${new Date(indexData.lastUpdated).toISOString()})`
      );
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        log.debug("No existing index file found");
      } else {
        log.warn("Failed to load index, will rebuild", error);
        // Try to delete corrupted file so rebuild can proceed
        try {
          await rm(indexPath);
        } catch {
          // Ignore delete errors
        }
      }
      return false;
    }
  }

  /**
   * Incrementally updates the index by comparing file mtimes.
   *
   * This method:
   * 1. Compares current files against the indexed file list
   * 2. Re-indexes files that have been modified (mtime changed)
   * 3. Adds new files that weren't in the index
   * 4. Removes entries for deleted files
   * 5. Saves the updated index
   *
   * @returns Object with counts of added, updated, and removed files
   */
  async updateIndex(): Promise<{ added: number; updated: number; removed: number }> {
    // Ensure we have an existing index to update
    if (!this.indexBuilt) {
      const loaded = await this.loadIndex();
      if (!loaded) {
        await this.buildIndex();
        await this.saveIndex();
        return { added: this.fileList.length, updated: 0, removed: 0 };
      }
    }

    log.info("Updating search index incrementally");
    const startTime = Date.now();

    // Create a map of existing files for quick lookup
    const existingFiles = new Map<string, IndexedFile>();
    for (const file of this.fileList) {
      existingFiles.set(file.path, file);
    }

    // Crawl current files to find changes
    const currentFiles: IndexedFile[] = [];
    await this.crawlDirectoryForMtime("", currentFiles);

    // Track changes
    let added = 0;
    let updated = 0;
    let removed = 0;

    const currentPaths = new Set<string>();

    // Process current files
    for (const file of currentFiles) {
      currentPaths.add(file.path);
      const existing = existingFiles.get(file.path);

      if (!existing) {
        // New file
        await this.indexFile(file.path, join(this.contentRoot, file.path));
        added++;
      } else if (file.mtime !== existing.mtime) {
        // Modified file: remove old entry and re-index
        if (this.contentIndex) {
          try {
            this.contentIndex.discard(file.path);
          } catch {
            // Ignore if document not found
          }
        }
        // Update mtime in file list
        const idx = this.fileList.findIndex((f) => f.path === file.path);
        if (idx !== -1) {
          this.fileList[idx].mtime = file.mtime;
        }
        // Re-read and index content
        await this.reindexFileContent(file.path, join(this.contentRoot, file.path));
        updated++;
      }
    }

    // Remove deleted files
    for (const [path] of existingFiles) {
      if (!currentPaths.has(path)) {
        // File was deleted
        if (this.contentIndex) {
          try {
            this.contentIndex.discard(path);
          } catch {
            // Ignore if document not found
          }
        }
        this.fileList = this.fileList.filter((f) => f.path !== path);
        removed++;
      }
    }

    // Save the updated index
    await this.saveIndex();

    const duration = Date.now() - startTime;
    log.info(
      `Index updated in ${duration}ms: ${added} added, ${updated} updated, ${removed} removed`
    );

    return { added, updated, removed };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Ensures the index is built before performing a search.
   * If the index is already built, this is a no-op.
   * If another build is in progress, waits for it to complete.
   *
   * First attempts to load a persisted index, falling back to a full build.
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

    // Try to load existing index first
    const loaded = await this.loadIndex();
    if (loaded) {
      return;
    }

    // Fall back to full build
    await this.buildIndex();
  }

  /**
   * Builds the search index by crawling .md files in the content root.
   *
   * This method:
   * 1. Recursively finds all .md files within contentRoot
   * 2. Excludes hidden folders (starting with .)
   * 3. Builds both the file list (for name search) and content index (for content search)
   * 4. Uses batch parallel file reading for performance (REQ-NF-5)
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

      // Phase 1: Crawl directory structure to collect file paths and mtimes
      // This is fast as it only reads directory entries, not file contents
      await this.crawlDirectoryForMtime("", this.fileList);

      // Phase 2: Batch read file contents in parallel for content indexing
      const documents: ContentDocument[] = [];

      for (let i = 0; i < this.fileList.length; i += FILE_READ_BATCH_SIZE) {
        const batch = this.fileList.slice(i, i + FILE_READ_BATCH_SIZE);
        const batchDocs = await Promise.all(
          batch.map(async (file) => {
            try {
              const content = await readFile(join(this.contentRoot, file.path), "utf-8");
              return {
                id: file.path,
                path: file.path,
                content,
              };
            } catch {
              // File may have been deleted between crawl and read
              log.debug(`Failed to read file for indexing: ${file.path}`);
              return null;
            }
          })
        );
        documents.push(...batchDocs.filter((d): d is ContentDocument => d !== null));
      }

      // Phase 3: Add all documents to the content index
      this.contentIndex.addAll(documents);

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
   * Recursively crawls a directory collecting file paths and mtimes only.
   * Used by updateIndex for incremental updates.
   *
   * @param relativePath - Path relative to contentRoot
   * @param files - Array to collect file info into
   */
  private async crawlDirectoryForMtime(relativePath: string, files: IndexedFile[]): Promise<void> {
    const absolutePath = relativePath === "" ? this.contentRoot : join(this.contentRoot, relativePath);

    let entries;
    try {
      entries = await readdir(absolutePath, { withFileTypes: true });
    } catch {
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
          continue;
        }
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        await this.crawlDirectoryForMtime(entryRelativePath, files);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
        try {
          const stats = await stat(entryAbsolutePath);
          files.push({
            path: entryRelativePath,
            name: basename(entryRelativePath),
            mtime: stats.mtimeMs,
          });
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }

  /**
   * Re-indexes file content without modifying the file list.
   * Used by updateIndex for modified files.
   *
   * @param relativePath - Path relative to contentRoot
   * @param absolutePath - Absolute path to the file
   */
  private async reindexFileContent(relativePath: string, absolutePath: string): Promise<void> {
    try {
      const content = await readFile(absolutePath, "utf-8");

      this.contentIndex?.add({
        id: relativePath,
        path: relativePath,
        content,
      });
    } catch (error) {
      log.debug(`Failed to re-index file content: ${relativePath}`, error);
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

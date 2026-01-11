/**
 * File Watcher
 *
 * Watches vault directories for file changes and triggers callbacks with debouncing.
 * Uses content hashing to detect actual changes and avoid spurious recomputation.
 *
 * Spec Requirements:
 * - REQ-F-24: File change detection with configurable debounce (default 500ms)
 *
 * Plan Reference:
 * - TD-3: File Watcher Implementation using chokidar
 */

import { watch, type FSWatcher } from "chokidar";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, join, extname } from "node:path";
import picomatch from "picomatch";
import { createLogger } from "../logger";

const log = createLogger("FileWatcher");

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration options for the FileWatcher.
 */
export interface FileWatcherOptions {
  /**
   * Debounce delay in milliseconds before triggering callback.
   * Default: 500ms per REQ-F-24
   */
  debounceMs?: number;

  /**
   * Callback invoked with changed file paths (relative to vault root).
   * Only files with actual content changes are included.
   */
  onFilesChanged: (paths: string[]) => void;

  /**
   * Callback invoked when an error occurs during watching.
   * Watcher continues operation; errors are logged.
   */
  onError?: (error: Error) => void;
}

/**
 * Internal state for tracking file changes.
 */
interface PendingChange {
  absolutePath: string;
  relativePath: string;
  eventType: "add" | "change" | "unlink";
}

// =============================================================================
// Content Hashing
// =============================================================================

/**
 * Compute SHA-256 hash of file content.
 * Returns null if file cannot be read (deleted, permission denied, etc.).
 */
async function computeContentHash(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    // File may have been deleted or is inaccessible
    return null;
  }
}

// =============================================================================
// FileWatcher Class
// =============================================================================

/**
 * Watches vault files for changes with debouncing and content hash comparison.
 *
 * Key features:
 * - Configurable debounce to batch rapid changes
 * - Content hash tracking to skip unchanged files
 * - Relative path reporting for consistency
 * - Resilient error handling (logs and continues)
 *
 * Usage:
 * ```typescript
 * const watcher = new FileWatcher('/path/to/vault', {
 *   debounceMs: 500,
 *   onFilesChanged: (paths) => {
 *     console.log('Changed files:', paths);
 *   },
 * });
 *
 * await watcher.start(['**\/*.md']);
 *
 * // Later...
 * await watcher.stop();
 * ```
 */
export class FileWatcher {
  private readonly vaultPath: string;
  private readonly debounceMs: number;
  private readonly onFilesChanged: (paths: string[]) => void;
  private readonly onError: (error: Error) => void;

  private watcher: FSWatcher | null = null;
  private contentHashes: Map<string, string> = new Map();
  private pendingChanges: Map<string, PendingChange> = new Map();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private isInitialScan = true;
  private patternMatcher: ((path: string) => boolean) | null = null;

  constructor(vaultPath: string, options: FileWatcherOptions) {
    this.vaultPath = vaultPath;
    this.debounceMs = options.debounceMs ?? 500;
    this.onFilesChanged = options.onFilesChanged;
    this.onError = options.onError ?? ((error) => log.error(`Watcher error: ${error.message}`));

    if (this.debounceMs < 0) {
      throw new Error("debounceMs must be non-negative");
    }
  }

  /**
   * Returns true if the watcher is currently active.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Returns the vault path being watched.
   */
  getVaultPath(): string {
    return this.vaultPath;
  }

  /**
   * Returns the current debounce delay in milliseconds.
   */
  getDebounceMs(): number {
    return this.debounceMs;
  }

  /**
   * Returns the number of files currently being tracked.
   */
  getTrackedFileCount(): number {
    return this.contentHashes.size;
  }

  /**
   * Start watching for file changes matching the given glob patterns.
   *
   * @param patterns - Glob patterns relative to vault root (e.g., ['**\/*.md', 'Games/**'])
   */
  async start(patterns: string[]): Promise<void> {
    if (this.isRunning) {
      log.warn("FileWatcher already running, ignoring start()");
      return;
    }

    if (patterns.length === 0) {
      log.info("No patterns provided, watcher will not start");
      return;
    }

    log.info(`Starting file watcher for ${patterns.length} pattern(s) in ${this.vaultPath}`);
    log.debug("Patterns:", patterns);

    // Create a combined matcher for all patterns
    // Patterns are relative to vault root
    this.patternMatcher = picomatch(patterns);

    // Watch the vault directory, filtering with the ignored option
    // This approach works better than glob patterns with chokidar
    this.watcher = watch(this.vaultPath, {
      persistent: true,
      ignoreInitial: false, // We want initial 'add' events to populate hashes
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
      // Do not use polling by default; fall back if needed
      usePolling: false,
      // Filter to only include files matching our patterns
      ignored: (absolutePath: string, stats?: { isDirectory?: () => boolean }) => {
        // Always include the vault root
        if (absolutePath === this.vaultPath) {
          return false;
        }
        // Always include directories (we need to traverse them)
        if (stats?.isDirectory?.()) {
          return false;
        }
        // When stats are unavailable, use heuristic: if no extension, likely a directory
        // This ensures we watch subdirectories that don't match file patterns
        if (stats === undefined && !extname(absolutePath)) {
          return false;
        }
        // For files, check if they match our patterns
        const relativePath = relative(this.vaultPath, absolutePath);
        const matches = this.patternMatcher!(relativePath);
        // Don't ignore if it matches our patterns
        return !matches;
      },
    });

    // During initial scan, we populate hashes synchronously without triggering callbacks
    this.isInitialScan = true;

    this.watcher.on("add", (path) => {
      log.debug(`Chokidar 'add' event: ${path}`);
      this.handleFileEvent("add", path);
    });
    this.watcher.on("change", (path) => {
      log.debug(`Chokidar 'change' event: ${path}`);
      this.handleFileEvent("change", path);
    });
    this.watcher.on("unlink", (path) => {
      log.debug(`Chokidar 'unlink' event: ${path}`);
      this.handleFileEvent("unlink", path);
    });
    this.watcher.on("error", (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err);
    });

    // Wait for initial scan to complete and hash population
    await new Promise<void>((resolve) => {
      this.watcher!.on("ready", () => {
        // Process any pending initial hashes
        // We need to do this synchronously in the promise chain
        this.processInitialHashes()
          .then(() => {
            this.isInitialScan = false;
            log.info(`Watcher ready, tracking ${this.contentHashes.size} file(s)`);
            resolve();
          })
          .catch((error) => {
            log.error(`Error processing initial hashes: ${error}`);
            this.isInitialScan = false;
            resolve(); // Still resolve to allow watcher to start
          });
      });
    });

    this.isRunning = true;
  }

  /**
   * Process initial file hashes during startup.
   * This is called when 'ready' fires to ensure all files are hashed.
   */
  private async processInitialHashes(): Promise<void> {
    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    // Clear any pending debounce timer from initial scan
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Hash all files without triggering callbacks
    for (const change of changes) {
      if (change.eventType === "add") {
        const hash = await computeContentHash(change.absolutePath);
        if (hash !== null) {
          this.contentHashes.set(change.absolutePath, hash);
        }
      }
    }
  }

  /**
   * Stop watching and clean up resources.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    log.info("Stopping file watcher");

    // Clear pending debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Close the watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Clear state
    this.pendingChanges.clear();
    this.contentHashes.clear();
    this.isRunning = false;
    this.isInitialScan = true;
    this.patternMatcher = null;

    log.info("File watcher stopped");
  }

  /**
   * Clear all tracked content hashes.
   * Useful for forcing recomputation on next change.
   */
  clearHashes(): void {
    this.contentHashes.clear();
    log.debug("Cleared all content hashes");
  }

  /**
   * Get the content hash for a specific file path (relative to vault).
   * Returns null if file is not tracked.
   */
  getContentHash(relativePath: string): string | null {
    const absolutePath = join(this.vaultPath, relativePath);
    return this.contentHashes.get(absolutePath) ?? null;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Handle a file system event.
   */
  private handleFileEvent(
    eventType: "add" | "change" | "unlink",
    absolutePath: string
  ): void {
    const relativePath = relative(this.vaultPath, absolutePath);

    log.debug(`File event: ${eventType} ${relativePath}`);

    // Track this change
    this.pendingChanges.set(absolutePath, {
      absolutePath,
      relativePath,
      eventType,
    });

    // Reset debounce timer
    this.scheduleProcessing();
  }

  /**
   * Schedule processing of pending changes after debounce delay.
   */
  private scheduleProcessing(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.processPendingChanges();
    }, this.debounceMs);
  }

  /**
   * Process all pending changes, comparing content hashes.
   */
  private async processPendingChanges(): Promise<void> {
    if (this.pendingChanges.size === 0) {
      return;
    }

    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    log.debug(`Processing ${changes.length} pending change(s)`);

    const actuallyChangedPaths: string[] = [];

    for (const change of changes) {
      const changed = await this.checkIfActuallyChanged(change);
      if (changed) {
        actuallyChangedPaths.push(change.relativePath);
      }
    }

    if (actuallyChangedPaths.length > 0) {
      log.info(`${actuallyChangedPaths.length} file(s) actually changed`);
      this.onFilesChanged(actuallyChangedPaths);
    } else {
      log.debug("No actual content changes detected");
    }
  }

  /**
   * Check if a file actually changed by comparing content hashes.
   * Updates the hash cache as a side effect.
   */
  private async checkIfActuallyChanged(change: PendingChange): Promise<boolean> {
    const { absolutePath, relativePath, eventType } = change;

    if (eventType === "unlink") {
      // File was deleted
      const hadHash = this.contentHashes.has(absolutePath);
      this.contentHashes.delete(absolutePath);
      log.debug(`File deleted: ${relativePath}`);
      return hadHash; // Only report if we were tracking it
    }

    // For add/change, compute new hash
    const newHash = await computeContentHash(absolutePath);

    if (newHash === null) {
      // File became unreadable; treat as deleted
      const hadHash = this.contentHashes.has(absolutePath);
      this.contentHashes.delete(absolutePath);
      return hadHash;
    }

    const oldHash = this.contentHashes.get(absolutePath);
    this.contentHashes.set(absolutePath, newHash);

    if (eventType === "add" && oldHash === undefined) {
      // New file, only report after initial scan (isRunning is true)
      // During initial scan, we just populate hashes without reporting
      return this.isRunning;
    }

    if (newHash === oldHash) {
      log.debug(`Content unchanged: ${relativePath}`);
      return false;
    }

    log.debug(`Content changed: ${relativePath}`);
    return true;
  }

  /**
   * Handle watcher errors.
   */
  private handleError(error: Error): void {
    log.error(`File watcher error: ${error.message}`);
    this.onError(error);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a FileWatcher for a vault with default options.
 *
 * @param vaultPath - Absolute path to vault root
 * @param onFilesChanged - Callback for changed file paths
 * @param options - Optional configuration overrides
 * @returns FileWatcher instance (not started)
 */
export function createFileWatcher(
  vaultPath: string,
  onFilesChanged: (paths: string[]) => void,
  options?: Partial<Omit<FileWatcherOptions, "onFilesChanged">>
): FileWatcher {
  return new FileWatcher(vaultPath, {
    ...options,
    onFilesChanged,
  });
}

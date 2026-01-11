/**
 * Widget Cache
 *
 * Persistent cache for widget computation results using SQLite with WAL mode.
 * Provides in-memory fallback when SQLite initialization fails.
 *
 * Spec Requirements:
 * - REQ-F-23: Cache stored at `.memory-loop/cache.db` in vault
 * - REQ-F-25: Cache keyed by vault ID + widget ID + content hash
 * - REQ-F-29: In-memory fallback when SQLite persistence fails
 * - REQ-F-31: WAL mode for crash resilience
 * - REQ-F-32: Integrity check on startup; corrupted DB deleted and rebuilt
 */

import { Database } from "bun:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createLogger } from "../logger";

const log = createLogger("WidgetCache");

// =============================================================================
// Types
// =============================================================================

/**
 * Cached widget computation result.
 */
export interface WidgetCacheEntry {
  resultJson: string;
  computedAt: number;
}

/**
 * Cached similarity computation result.
 */
export interface SimilarityCacheEntry {
  similarItemsJson: string;
  computedAt: number;
}

/**
 * In-memory cache entry (combines widget and similarity).
 */
interface MemoryCacheEntry {
  type: "widget" | "similarity";
  value: string;
  computedAt: number;
}

// =============================================================================
// Cache Key Builders
// =============================================================================

function buildWidgetKey(vaultId: string, widgetId: string, contentHash: string): string {
  return `widget:${vaultId}:${widgetId}:${contentHash}`;
}

function buildSimilarityKey(
  vaultId: string,
  widgetId: string,
  sourcePath: string,
  contentVersion: string
): string {
  return `similarity:${vaultId}:${widgetId}:${sourcePath}:${contentVersion}`;
}

// =============================================================================
// WidgetCache Class
// =============================================================================

/**
 * Manages widget computation caching with SQLite persistence and in-memory fallback.
 *
 * Usage:
 * ```typescript
 * const cache = new WidgetCache();
 * await cache.initialize('/path/to/vault/.memory-loop/cache.db');
 *
 * // Get/set widget results
 * const result = cache.getWidgetResult('vault1', 'widget1', 'abc123');
 * cache.setWidgetResult('vault1', 'widget1', 'abc123', { data: 'value' });
 *
 * // Clean up
 * cache.close();
 * ```
 */
export class WidgetCache {
  private db: Database | null = null;
  private memoryFallback: Map<string, MemoryCacheEntry> = new Map();
  private usingFallback = false;
  private dbPath: string | null = null;

  /**
   * Returns true if the cache is using in-memory fallback instead of SQLite.
   */
  isUsingFallback(): boolean {
    return this.usingFallback;
  }

  /**
   * Returns the database path, or null if not initialized.
   */
  getDatabasePath(): string | null {
    return this.dbPath;
  }

  /**
   * Initialize the cache with SQLite database.
   * Falls back to in-memory cache on failure.
   *
   * @param dbPath - Path to SQLite database file (e.g., '.memory-loop/cache.db')
   */
  async initialize(dbPath: string): Promise<void> {
    this.dbPath = dbPath;

    try {
      // Ensure parent directory exists
      await mkdir(dirname(dbPath), { recursive: true });

      // Attempt to open database
      this.db = new Database(dbPath, { create: true });

      // Configure pragmas for crash resilience (TD-2)
      this.configurePragmas();

      // Run integrity check (REQ-F-32)
      const isValid = this.checkIntegrity();
      if (!isValid) {
        log.warn("Database integrity check failed, rebuilding");
        await this.rebuildDatabase(dbPath);
        return;
      }

      // Create schema
      this.createSchema();

      log.info(`Initialized SQLite cache at ${dbPath}`);
    } catch (error) {
      log.error(`SQLite init failed, using memory fallback: ${String(error)}`);
      this.db = null;
      this.usingFallback = true;
    }
  }

  /**
   * Configure SQLite pragmas for crash resilience and performance.
   */
  private configurePragmas(): void {
    if (!this.db) return;

    // WAL mode for better crash resilience (REQ-F-31)
    this.db.exec("PRAGMA journal_mode = WAL");
    // NORMAL sync is sufficient with WAL
    this.db.exec("PRAGMA synchronous = NORMAL");
    // Wait up to 5 seconds for locks
    this.db.exec("PRAGMA busy_timeout = 5000");
  }

  /**
   * Check database integrity.
   * Returns false if integrity check fails.
   */
  private checkIntegrity(): boolean {
    if (!this.db) return false;

    try {
      const result = this.db.query<{ integrity_check: string }, []>(
        "PRAGMA integrity_check"
      ).get();

      return result?.integrity_check === "ok";
    } catch {
      return false;
    }
  }

  /**
   * Rebuild database after corruption detection.
   */
  private async rebuildDatabase(dbPath: string): Promise<void> {
    // Close existing connection
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore close errors on corrupted DB
      }
      this.db = null;
    }

    // Delete corrupted database files
    try {
      await rm(dbPath, { force: true });
      await rm(`${dbPath}-wal`, { force: true });
      await rm(`${dbPath}-shm`, { force: true });
      log.info("Deleted corrupted database files");
    } catch (error) {
      log.error(`Failed to delete corrupted database: ${String(error)}`);
      this.usingFallback = true;
      return;
    }

    // Reinitialize
    try {
      this.db = new Database(dbPath, { create: true });
      this.configurePragmas();
      this.createSchema();
      log.info("Rebuilt database successfully");
    } catch (error) {
      log.error(`Failed to rebuild database: ${String(error)}`);
      this.db = null;
      this.usingFallback = true;
    }
  }

  /**
   * Create database schema.
   */
  private createSchema(): void {
    if (!this.db) return;

    // Widget computation cache
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS widget_cache (
        id INTEGER PRIMARY KEY,
        vault_id TEXT NOT NULL,
        widget_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        computed_at INTEGER NOT NULL,
        UNIQUE(vault_id, widget_id, content_hash)
      )
    `);

    // Similarity cache (per-item)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS similarity_cache (
        id INTEGER PRIMARY KEY,
        vault_id TEXT NOT NULL,
        widget_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        content_version TEXT NOT NULL,
        similar_items_json TEXT NOT NULL,
        computed_at INTEGER NOT NULL,
        UNIQUE(vault_id, widget_id, source_path, content_version)
      )
    `);

    // Indexes for fast lookup
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_widget_cache_lookup
      ON widget_cache(vault_id, widget_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_similarity_lookup
      ON similarity_cache(vault_id, widget_id, source_path)
    `);
  }

  // ===========================================================================
  // Widget Cache Operations
  // ===========================================================================

  /**
   * Get cached widget computation result.
   *
   * @param vaultId - Vault identifier
   * @param widgetId - Widget identifier
   * @param contentHash - Hash of source content
   * @returns Cached entry or null if not found
   */
  getWidgetResult(
    vaultId: string,
    widgetId: string,
    contentHash: string
  ): WidgetCacheEntry | null {
    if (this.usingFallback) {
      const key = buildWidgetKey(vaultId, widgetId, contentHash);
      const entry = this.memoryFallback.get(key);
      if (entry && entry.type === "widget") {
        return {
          resultJson: entry.value,
          computedAt: entry.computedAt,
        };
      }
      return null;
    }

    if (!this.db) return null;

    try {
      const row = this.db
        .query<{ result_json: string; computed_at: number }, [string, string, string]>(
          `SELECT result_json, computed_at
           FROM widget_cache
           WHERE vault_id = ? AND widget_id = ? AND content_hash = ?`
        )
        .get(vaultId, widgetId, contentHash);

      if (!row) return null;

      return {
        resultJson: row.result_json,
        computedAt: row.computed_at,
      };
    } catch (error) {
      log.error(`Failed to get widget result: ${String(error)}`);
      return null;
    }
  }

  /**
   * Cache a widget computation result.
   *
   * @param vaultId - Vault identifier
   * @param widgetId - Widget identifier
   * @param contentHash - Hash of source content
   * @param result - Result object to cache (will be JSON stringified)
   */
  setWidgetResult(
    vaultId: string,
    widgetId: string,
    contentHash: string,
    result: unknown
  ): void {
    const resultJson = JSON.stringify(result);
    const computedAt = Date.now();

    if (this.usingFallback) {
      const key = buildWidgetKey(vaultId, widgetId, contentHash);
      this.memoryFallback.set(key, {
        type: "widget",
        value: resultJson,
        computedAt,
      });
      return;
    }

    if (!this.db) return;

    try {
      this.db
        .query(
          `INSERT INTO widget_cache (vault_id, widget_id, content_hash, result_json, computed_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(vault_id, widget_id, content_hash)
           DO UPDATE SET result_json = excluded.result_json, computed_at = excluded.computed_at`
        )
        .run(vaultId, widgetId, contentHash, resultJson, computedAt);
    } catch (error) {
      log.error(`Failed to set widget result: ${String(error)}`);
    }
  }

  // ===========================================================================
  // Similarity Cache Operations
  // ===========================================================================

  /**
   * Get cached similarity computation result.
   *
   * @param vaultId - Vault identifier
   * @param widgetId - Widget identifier
   * @param sourcePath - Path of source item
   * @param contentVersion - Version hash of collection content
   * @returns Cached entry or null if not found
   */
  getSimilarityResult(
    vaultId: string,
    widgetId: string,
    sourcePath: string,
    contentVersion: string
  ): SimilarityCacheEntry | null {
    if (this.usingFallback) {
      const key = buildSimilarityKey(vaultId, widgetId, sourcePath, contentVersion);
      const entry = this.memoryFallback.get(key);
      if (entry && entry.type === "similarity") {
        return {
          similarItemsJson: entry.value,
          computedAt: entry.computedAt,
        };
      }
      return null;
    }

    if (!this.db) return null;

    try {
      const row = this.db
        .query<
          { similar_items_json: string; computed_at: number },
          [string, string, string, string]
        >(
          `SELECT similar_items_json, computed_at
           FROM similarity_cache
           WHERE vault_id = ? AND widget_id = ? AND source_path = ? AND content_version = ?`
        )
        .get(vaultId, widgetId, sourcePath, contentVersion);

      if (!row) return null;

      return {
        similarItemsJson: row.similar_items_json,
        computedAt: row.computed_at,
      };
    } catch (error) {
      log.error(`Failed to get similarity result: ${String(error)}`);
      return null;
    }
  }

  /**
   * Cache a similarity computation result.
   *
   * @param vaultId - Vault identifier
   * @param widgetId - Widget identifier
   * @param sourcePath - Path of source item
   * @param contentVersion - Version hash of collection content
   * @param result - Result object to cache (will be JSON stringified)
   */
  setSimilarityResult(
    vaultId: string,
    widgetId: string,
    sourcePath: string,
    contentVersion: string,
    result: unknown
  ): void {
    const similarItemsJson = JSON.stringify(result);
    const computedAt = Date.now();

    if (this.usingFallback) {
      const key = buildSimilarityKey(vaultId, widgetId, sourcePath, contentVersion);
      this.memoryFallback.set(key, {
        type: "similarity",
        value: similarItemsJson,
        computedAt,
      });
      return;
    }

    if (!this.db) return;

    try {
      this.db
        .query(
          `INSERT INTO similarity_cache (vault_id, widget_id, source_path, content_version, similar_items_json, computed_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(vault_id, widget_id, source_path, content_version)
           DO UPDATE SET similar_items_json = excluded.similar_items_json, computed_at = excluded.computed_at`
        )
        .run(vaultId, widgetId, sourcePath, contentVersion, similarItemsJson, computedAt);
    } catch (error) {
      log.error(`Failed to set similarity result: ${String(error)}`);
    }
  }

  // ===========================================================================
  // Invalidation Operations
  // ===========================================================================

  /**
   * Invalidate all cached widget results for a specific widget.
   *
   * @param vaultId - Vault identifier
   * @param widgetId - Widget identifier
   * @returns Number of entries invalidated
   */
  invalidateWidget(vaultId: string, widgetId: string): number {
    if (this.usingFallback) {
      const prefix = `widget:${vaultId}:${widgetId}:`;
      let count = 0;
      for (const key of this.memoryFallback.keys()) {
        if (key.startsWith(prefix)) {
          this.memoryFallback.delete(key);
          count++;
        }
      }
      return count;
    }

    if (!this.db) return 0;

    try {
      const result = this.db
        .query(`DELETE FROM widget_cache WHERE vault_id = ? AND widget_id = ?`)
        .run(vaultId, widgetId);
      return result.changes;
    } catch (error) {
      log.error(`Failed to invalidate widget cache: ${String(error)}`);
      return 0;
    }
  }

  /**
   * Invalidate all cached similarity results for a specific widget.
   *
   * @param vaultId - Vault identifier
   * @param widgetId - Widget identifier
   * @returns Number of entries invalidated
   */
  invalidateSimilarity(vaultId: string, widgetId: string): number {
    if (this.usingFallback) {
      const prefix = `similarity:${vaultId}:${widgetId}:`;
      let count = 0;
      for (const key of this.memoryFallback.keys()) {
        if (key.startsWith(prefix)) {
          this.memoryFallback.delete(key);
          count++;
        }
      }
      return count;
    }

    if (!this.db) return 0;

    try {
      const result = this.db
        .query(`DELETE FROM similarity_cache WHERE vault_id = ? AND widget_id = ?`)
        .run(vaultId, widgetId);
      return result.changes;
    } catch (error) {
      log.error(`Failed to invalidate similarity cache: ${String(error)}`);
      return 0;
    }
  }

  /**
   * Invalidate all cached results for a vault.
   *
   * @param vaultId - Vault identifier
   * @returns Total number of entries invalidated
   */
  invalidateVault(vaultId: string): number {
    if (this.usingFallback) {
      const widgetPrefix = `widget:${vaultId}:`;
      const similarityPrefix = `similarity:${vaultId}:`;
      let count = 0;
      for (const key of this.memoryFallback.keys()) {
        if (key.startsWith(widgetPrefix) || key.startsWith(similarityPrefix)) {
          this.memoryFallback.delete(key);
          count++;
        }
      }
      return count;
    }

    if (!this.db) return 0;

    try {
      const widgetResult = this.db
        .query(`DELETE FROM widget_cache WHERE vault_id = ?`)
        .run(vaultId);
      const similarityResult = this.db
        .query(`DELETE FROM similarity_cache WHERE vault_id = ?`)
        .run(vaultId);
      return widgetResult.changes + similarityResult.changes;
    } catch (error) {
      log.error(`Failed to invalidate vault cache: ${String(error)}`);
      return 0;
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Close the cache connection.
   * Should be called during graceful shutdown.
   */
  close(): void {
    if (this.db) {
      try {
        // Checkpoint WAL before closing
        this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        this.db.close();
        log.info("Closed SQLite cache");
      } catch (error) {
        log.error(`Error closing cache: ${String(error)}`);
      }
      this.db = null;
    }
    this.memoryFallback.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    usingFallback: boolean;
    widgetEntries: number;
    similarityEntries: number;
  } {
    if (this.usingFallback) {
      let widgetCount = 0;
      let similarityCount = 0;
      for (const entry of this.memoryFallback.values()) {
        if (entry.type === "widget") widgetCount++;
        else similarityCount++;
      }
      return {
        usingFallback: true,
        widgetEntries: widgetCount,
        similarityEntries: similarityCount,
      };
    }

    if (!this.db) {
      return { usingFallback: true, widgetEntries: 0, similarityEntries: 0 };
    }

    try {
      const widgetCount = this.db
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM widget_cache")
        .get();
      const similarityCount = this.db
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM similarity_cache")
        .get();

      return {
        usingFallback: false,
        widgetEntries: widgetCount?.count ?? 0,
        similarityEntries: similarityCount?.count ?? 0,
      };
    } catch (error) {
      log.error(`Failed to get cache stats: ${String(error)}`);
      return { usingFallback: this.usingFallback, widgetEntries: 0, similarityEntries: 0 };
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Default cache database path relative to vault root.
 */
export const CACHE_DB_PATH = ".memory-loop/cache.db";

/**
 * Create and initialize a WidgetCache for a vault.
 *
 * @param vaultPath - Absolute path to vault root
 * @returns Initialized WidgetCache instance
 */
export async function createWidgetCache(vaultPath: string): Promise<WidgetCache> {
  const cache = new WidgetCache();
  const dbPath = `${vaultPath}/${CACHE_DB_PATH}`;
  await cache.initialize(dbPath);
  return cache;
}

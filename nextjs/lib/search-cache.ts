/**
 * Search Index Cache
 *
 * Caches SearchIndexManager instances per vault to avoid recreation
 * on each REST API call. Uses LRU eviction when cache exceeds threshold.
 *
 * @see .sdd/tasks/2026-01-21-rest-api-migration-tasks.md (TASK-009)
 */

import { SearchIndexManager } from "./search/search-index";
import { createLogger } from "./logger";

const log = createLogger("SearchCache");

// =============================================================================
// Types
// =============================================================================

/**
 * Cached entry with metadata for LRU eviction and TTL invalidation.
 */
interface CacheEntry {
  /** The search index manager instance */
  index: SearchIndexManager;
  /** Timestamp of last access (ms since epoch) for LRU tracking */
  lastAccess: number;
  /** Timestamp when the index was created (ms since epoch) for TTL */
  createdAt: number;
}

/**
 * Configuration options for the search cache.
 */
export interface SearchCacheConfig {
  /** Maximum number of vaults to cache (default: 10) */
  maxVaults?: number;
  /** TTL in milliseconds after which index is refreshed (default: 5 minutes) */
  ttlMs?: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Default maximum number of cached vaults */
const DEFAULT_MAX_VAULTS = 10;

/** Default TTL: 5 minutes */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

// =============================================================================
// Module State
// =============================================================================

/** Cache storage: Map<vaultId, CacheEntry> */
const cache = new Map<string, CacheEntry>();

/** Current configuration */
let config: Required<SearchCacheConfig> = {
  maxVaults: DEFAULT_MAX_VAULTS,
  ttlMs: DEFAULT_TTL_MS,
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Configures the search cache. Call before first use to customize behavior.
 *
 * @param newConfig - Configuration options to apply
 */
export function configureSearchCache(newConfig: SearchCacheConfig): void {
  config = {
    maxVaults: newConfig.maxVaults ?? DEFAULT_MAX_VAULTS,
    ttlMs: newConfig.ttlMs ?? DEFAULT_TTL_MS,
  };
  log.info(`Search cache configured: maxVaults=${config.maxVaults}, ttlMs=${config.ttlMs}`);
}

/**
 * Gets the current cache configuration.
 *
 * @returns Current configuration
 */
export function getSearchCacheConfig(): Required<SearchCacheConfig> {
  return { ...config };
}

/**
 * Gets or creates a SearchIndexManager for the specified vault.
 *
 * If the vault is already cached and not expired, returns the cached instance
 * (updating last access time for LRU tracking). If not cached or expired,
 * creates a new instance and caches it.
 *
 * Triggers LRU eviction if cache exceeds maxVaults after adding new entry.
 *
 * @param vaultId - Unique identifier for the vault
 * @param vaultPath - Absolute path to the vault's content root
 * @returns The SearchIndexManager for the vault
 */
export function getOrCreateIndex(vaultId: string, vaultPath: string): SearchIndexManager {
  const now = Date.now();
  const existing = cache.get(vaultId);

  if (existing) {
    // Check TTL expiration
    const age = now - existing.createdAt;
    if (age < config.ttlMs) {
      // Cache hit: update last access and return
      existing.lastAccess = now;
      log.debug(`Cache hit for vault ${vaultId} (age: ${Math.round(age / 1000)}s)`);
      return existing.index;
    }

    // TTL expired: remove and create new
    log.info(`Cache TTL expired for vault ${vaultId}, refreshing index`);
    cache.delete(vaultId);
  }

  // Create new index
  log.debug(`Creating new search index for vault ${vaultId} at ${vaultPath}`);
  const index = new SearchIndexManager(vaultPath);

  // Add to cache
  cache.set(vaultId, {
    index,
    lastAccess: now,
    createdAt: now,
  });

  // Evict if over capacity
  if (cache.size > config.maxVaults) {
    evictLRU();
  }

  return index;
}

/**
 * Invalidates the cached index for a specific vault.
 *
 * Call this when vault content changes and you want the next access
 * to create a fresh index.
 *
 * @param vaultId - Vault ID to invalidate
 * @returns true if entry was removed, false if not in cache
 */
export function invalidateCache(vaultId: string): boolean {
  const removed = cache.delete(vaultId);
  if (removed) {
    log.info(`Cache invalidated for vault ${vaultId}`);
  }
  return removed;
}

/**
 * Clears all cached indexes.
 *
 * Useful for testing or when you need to force refresh all indexes.
 */
export function clearCache(): void {
  const size = cache.size;
  cache.clear();
  log.info(`Cache cleared (${size} entries removed)`);
}

/**
 * Returns the current number of cached indexes.
 *
 * @returns Number of cached entries
 */
export function getCacheSize(): number {
  return cache.size;
}

/**
 * Returns cache statistics for monitoring.
 *
 * @returns Object with cache statistics
 */
export function getCacheStats(): {
  size: number;
  maxVaults: number;
  ttlMs: number;
  entries: Array<{
    vaultId: string;
    ageMs: number;
    lastAccessMs: number;
    isIndexBuilt: boolean;
  }>;
} {
  const now = Date.now();
  const entries = Array.from(cache.entries()).map(([vaultId, entry]) => ({
    vaultId,
    ageMs: now - entry.createdAt,
    lastAccessMs: now - entry.lastAccess,
    isIndexBuilt: entry.index.isIndexBuilt(),
  }));

  return {
    size: cache.size,
    maxVaults: config.maxVaults,
    ttlMs: config.ttlMs,
    entries,
  };
}

// =============================================================================
// Internal Functions
// =============================================================================

/**
 * Evicts the least recently used entry from the cache.
 *
 * Called when cache exceeds maxVaults after adding a new entry.
 */
function evictLRU(): void {
  let lruKey: string | null = null;
  let lruTime = Infinity;

  for (const [key, entry] of cache) {
    if (entry.lastAccess < lruTime) {
      lruTime = entry.lastAccess;
      lruKey = key;
    }
  }

  if (lruKey !== null) {
    cache.delete(lruKey);
    log.info(`LRU eviction: removed vault ${lruKey} (last access: ${new Date(lruTime).toISOString()})`);
  }
}

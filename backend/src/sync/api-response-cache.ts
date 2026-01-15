/**
 * API Response Cache
 *
 * In-memory cache for API responses during a sync run.
 * Cache is scoped per-run and cleared on full sync.
 *
 * Spec Requirements:
 * - REQ-F-25: Rate limiting (use cache to avoid redundant requests)
 *
 * Plan Reference:
 * - TD-3: Caching Strategy design
 */

import type { ApiResponse } from "./connector-interface.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Cache key format: "connector:id"
 */
type CacheKey = string;

/**
 * Cached entry with response and timestamp.
 */
interface CacheEntry {
  response: ApiResponse;
  cachedAt: Date;
}

// =============================================================================
// API Response Cache Class
// =============================================================================

/**
 * In-memory cache for API responses during sync runs.
 *
 * Used to avoid redundant API calls when the same resource
 * is referenced by multiple files in the same sync run.
 */
export class ApiResponseCache {
  private readonly cache = new Map<CacheKey, CacheEntry>();

  /**
   * Generate a cache key from connector name and resource ID.
   */
  private key(connector: string, id: string): CacheKey {
    return `${connector}:${id}`;
  }

  /**
   * Get a cached response if available.
   *
   * @param connector - Name of the connector (e.g., "bgg")
   * @param id - Resource ID
   * @returns Cached response or undefined if not cached
   */
  get(connector: string, id: string): ApiResponse | undefined {
    const entry = this.cache.get(this.key(connector, id));
    return entry?.response;
  }

  /**
   * Cache an API response.
   *
   * @param connector - Name of the connector (e.g., "bgg")
   * @param id - Resource ID
   * @param response - API response to cache
   */
  set(connector: string, id: string, response: ApiResponse): void {
    this.cache.set(this.key(connector, id), {
      response,
      cachedAt: new Date(),
    });
  }

  /**
   * Check if a response is cached.
   *
   * @param connector - Name of the connector
   * @param id - Resource ID
   * @returns true if response is cached
   */
  has(connector: string, id: string): boolean {
    return this.cache.has(this.key(connector, id));
  }

  /**
   * Clear all cached responses.
   *
   * Called at the start of a full sync to ensure fresh data.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of cached entries.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics for logging/debugging.
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new API response cache.
 */
export function createApiResponseCache(): ApiResponseCache {
  return new ApiResponseCache();
}

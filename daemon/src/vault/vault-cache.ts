/**
 * Vault Cache
 *
 * Caches discovered vaults in memory with TTL-based refresh.
 * Reduces filesystem I/O for frequently-accessed vault lists.
 */

import type { VaultInfo } from "@memory-loop/shared";
import { createLogger } from "@memory-loop/shared";
import { discoverVaults, parseVault, getVaultsDir } from "./vault-manager";

const log = createLogger("vault-cache");

const CACHE_TTL_MS = 60_000; // 60 seconds

let cachedVaults: VaultInfo[] = [];
let cacheTimestamp = 0;

/**
 * Initialize the vault cache by performing initial discovery.
 */
export async function initVaultCache(): Promise<void> {
  log.info("Initializing vault cache...");
  cachedVaults = await discoverVaults();
  cacheTimestamp = Date.now();
  log.info(`Cache initialized with ${cachedVaults.length} vault(s)`);
}

/**
 * Get all cached vaults. Refreshes if cache is stale.
 */
export async function getVaults(): Promise<VaultInfo[]> {
  if (Date.now() - cacheTimestamp > CACHE_TTL_MS) {
    log.debug("Cache expired, refreshing...");
    await invalidateCache();
  }
  return cachedVaults;
}

/**
 * Get a single vault by ID from cache, falling back to direct parse on miss.
 */
export async function getCachedVaultById(id: string): Promise<VaultInfo | null> {
  const cached = cachedVaults.find((v) => v.id === id);
  if (cached) {
    return cached;
  }

  // Cache miss: try direct parse
  log.debug(`Cache miss for vault "${id}", trying direct parse`);
  const vaultsDir = getVaultsDir();
  const vault = await parseVault(vaultsDir, id);
  if (vault) {
    // Add to cache
    cachedVaults.push(vault);
    cachedVaults.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.name.localeCompare(b.name);
    });
  }
  return vault;
}

/**
 * Invalidate the cache and re-discover vaults.
 */
export async function invalidateCache(): Promise<void> {
  cachedVaults = await discoverVaults();
  cacheTimestamp = Date.now();
  log.debug(`Cache refreshed: ${cachedVaults.length} vault(s)`);
}

/**
 * Reset cache state (for testing).
 */
export function resetCache(): void {
  cachedVaults = [];
  cacheTimestamp = 0;
}

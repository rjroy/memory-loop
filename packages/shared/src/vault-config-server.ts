/**
 * Vault Config Server-Only Resolvers
 *
 * These resolvers use node:path and cannot be bundled for the browser.
 * Exported via @memory-loop/shared/server.
 */

import { normalize, join } from "node:path";
import { createLogger } from "./logger";
import type { VaultConfig } from "./vault-config";

const log = createLogger("VaultConfig");

/**
 * Resolves the content root path for a vault.
 * Uses normalize/join for path traversal prevention.
 */
export function resolveContentRoot(vaultPath: string, config: VaultConfig): string {
  if (config.contentRoot) {
    if (config.contentRoot.startsWith("/")) {
      log.warn(`Absolute path rejected in contentRoot: ${config.contentRoot}`);
      return vaultPath;
    }

    const resolved = normalize(join(vaultPath, config.contentRoot));
    const normalizedVaultPath = normalize(vaultPath);

    if (!resolved.startsWith(normalizedVaultPath + "/") && resolved !== normalizedVaultPath) {
      log.warn(`Path traversal attempt in contentRoot: ${config.contentRoot}`);
      return vaultPath;
    }

    return resolved;
  }
  return vaultPath;
}

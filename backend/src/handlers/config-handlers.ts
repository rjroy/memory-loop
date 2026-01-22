/**
 * Config Handlers
 *
 * REST API handlers for configuration operations:
 * - GET/PUT pinned assets (REQ-F-29, REQ-F-30)
 * - PATCH vault config (REQ-F-31)
 * - POST setup vault (REQ-F-32)
 * - POST create vault (REQ-F-33)
 * - DELETE dismiss health issue (REQ-F-34)
 *
 * These handlers wrap existing vault-config functions for REST endpoints.
 */

import type { VaultInfo, EditableVaultConfig } from "@memory-loop/shared";
import { EditableVaultConfigSchema } from "@memory-loop/shared";
import {
  loadVaultConfig,
  saveVaultConfig,
  savePinnedAssets,
  resolvePinnedAssets,
  type SaveConfigResult,
} from "../vault-config.js";
import { createVault, getVaultById, VaultCreationError } from "../vault-manager.js";
import { runVaultSetup, type SetupResult } from "../vault-setup.js";
import { createLogger } from "../logger.js";

const log = createLogger("ConfigHandlers");

/**
 * Result type for pinned assets operations.
 */
export interface PinnedAssetsResult {
  paths: string[];
}

/**
 * Result type for config update operations.
 */
export interface ConfigUpdateResult {
  success: boolean;
  error?: string;
}

/**
 * Result type for vault creation.
 */
export interface VaultCreatedResult {
  vault: VaultInfo;
}

/**
 * Error thrown for validation failures in config handlers.
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * Error thrown when a vault is not found.
 */
export class VaultNotFoundError extends Error {
  constructor(vaultId: string) {
    super(`Vault "${vaultId}" not found`);
    this.name = "VaultNotFoundError";
  }
}

/**
 * Gets pinned assets for a vault.
 *
 * @param vaultPath - Absolute path to the vault
 * @returns Pinned asset paths
 */
export async function handleGetPinnedAssets(
  vaultPath: string
): Promise<PinnedAssetsResult> {
  log.info("Getting pinned assets");

  const config = await loadVaultConfig(vaultPath);
  const paths = resolvePinnedAssets(config);

  log.info(`Found ${paths.length} pinned assets`);
  return { paths };
}

/**
 * Sets pinned assets for a vault.
 *
 * @param vaultPath - Absolute path to the vault
 * @param paths - Array of paths to pin (relative to content root)
 * @returns Updated pinned asset paths
 */
export async function handleSetPinnedAssets(
  vaultPath: string,
  paths: string[]
): Promise<PinnedAssetsResult> {
  log.info(`Setting ${paths.length} pinned assets`);

  // Validate paths are strings
  if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) {
    throw new ConfigValidationError("Paths must be an array of strings");
  }

  await savePinnedAssets(vaultPath, paths);

  log.info(`Saved ${paths.length} pinned assets`);
  return { paths };
}

/**
 * Updates vault configuration.
 *
 * @param vaultPath - Absolute path to the vault
 * @param config - Partial configuration to update
 * @returns Update result
 */
export async function handleUpdateVaultConfig(
  vaultPath: string,
  config: EditableVaultConfig
): Promise<ConfigUpdateResult> {
  log.info("Updating vault config");

  // Validate config against schema
  const validation = EditableVaultConfigSchema.safeParse(config);
  if (!validation.success) {
    const errorMessage =
      validation.error.issues[0]?.message ?? "Invalid configuration";
    log.warn("Vault config validation failed", {
      errors: validation.error.issues,
    });
    return { success: false, error: errorMessage };
  }

  // Save validated config
  const result: SaveConfigResult = await saveVaultConfig(
    vaultPath,
    validation.data
  );

  if (result.success) {
    log.info("Vault config updated successfully");
    return { success: true };
  } else {
    log.error(`Vault config update failed: ${result.error}`);
    return { success: false, error: result.error };
  }
}

/**
 * Sets up a vault (creates directories, installs commands, updates CLAUDE.md).
 *
 * @param vaultId - Vault ID to set up
 * @returns Setup result
 */
export async function handleSetupVault(vaultId: string): Promise<SetupResult> {
  log.info(`Setting up vault: ${vaultId}`);

  // Verify vault exists
  const vault = await getVaultById(vaultId);
  if (!vault) {
    throw new VaultNotFoundError(vaultId);
  }

  // Check for CLAUDE.md
  if (!vault.hasClaudeMd) {
    throw new ConfigValidationError(
      `Vault "${vault.name}" is missing CLAUDE.md at root`
    );
  }

  const result = await runVaultSetup(vaultId);

  log.info(
    `Setup complete for ${vaultId}: success=${result.success}, ` +
      `summary=${result.summary.length} items`
  );

  return result;
}

/**
 * Creates a new vault.
 *
 * @param title - User-provided vault title
 * @returns Created vault info
 */
export async function handleCreateVault(
  title: string
): Promise<VaultCreatedResult> {
  log.info(`Creating vault with title: "${title}"`);

  // Create the vault directory and CLAUDE.md
  const vault = await createVault(title);

  // Run vault setup to configure the new vault
  try {
    await runVaultSetup(vault.id);
    log.info(`Vault setup completed for: ${vault.id}`);
  } catch (setupError) {
    // Log setup error but don't fail - vault was created successfully
    log.warn(`Vault setup had issues for ${vault.id}:`, setupError);
  }

  // Re-fetch vault info to get updated setupComplete status
  const updatedVault = await getVaultById(vault.id);

  log.info(`Vault created successfully: ${vault.id} (${vault.name})`);
  return { vault: updatedVault ?? vault };
}

// Re-export VaultCreationError for consumers
export { VaultCreationError };

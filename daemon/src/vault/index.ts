/**
 * Vault module barrel export.
 */

export {
  discoverVaults,
  getVaultById,
  getVaultGoals,
  createVault,
  parseVault,
  getVaultsDir,
  getDefaultVaultsDir,
  ensureVaultsDir,
  getUniqueDirectoryName,
  detectInboxPath,
  detectAttachmentPath,
  detectGoalsPath,
  VaultsDirError,
  VaultCreationError,
} from "./vault-manager";

export {
  loadVaultConfig,
  saveVaultConfig,
  savePinnedAssets,
  loadSlashCommands,
  saveSlashCommands,
} from "./vault-config";
export type { SaveConfigResult } from "./vault-config";

export {
  initVaultCache,
  getVaults,
  getCachedVaultById,
  invalidateCache,
  resetCache,
} from "./vault-cache";

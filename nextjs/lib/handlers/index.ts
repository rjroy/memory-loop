/**
 * Handlers Module
 *
 * Exports handler modules used by Next.js API routes.
 */

// Search handlers (used by nextjs/app/api/vaults/[vaultId]/search/route.ts)
export {
  searchFilesRest,
  searchContentRest,
  getSnippetsRest,
  type SearchResultWithTiming,
} from "./search-handlers";

// Config handlers (used by nextjs/app/api/vaults/[vaultId]/config/route.ts)
export {
  handleGetPinnedAssets,
  handleSetPinnedAssets,
  handleUpdateVaultConfig,
  handleSetupVault,
  handleCreateVault,
  ConfigValidationError,
  VaultNotFoundError,
  type PinnedAssetsResult,
  type ConfigUpdateResult,
  type VaultCreatedResult,
} from "./config-handlers";

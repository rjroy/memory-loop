/**
 * Server-only exports from @memory-loop/shared.
 *
 * These modules use Node.js APIs (node:fs, node:path) and cannot be
 * bundled for the browser. Import from "@memory-loop/shared/server"
 * instead of "@memory-loop/shared" when using these.
 */

// Filesystem utilities (node:fs/promises)
export { fileExists, directoryExists } from "./fs-utils";

// Vault path helpers (node:path in resolveContentRoot)
export { resolveContentRoot } from "./vault-config-server";

// Vault path helpers (re-exported for convenience; these are also in the main barrel)
export type { ExtractedTitle } from "./vault-paths";
export {
  DEFAULT_INBOX_PATH,
  GOALS_FILE_PATH,
  INBOX_PATTERNS,
  ATTACHMENT_PATTERNS,
  extractVaultName,
  titleToDirectoryName,
  getVaultInboxPath,
  getVaultMetadataPath,
} from "./vault-paths";

// Vault config resolvers (re-exported for convenience; these are also in the main barrel)
export {
  resolveGoalsPath,
  resolveContextualPromptsPath,
  resolveGeneralInspirationPath,
} from "./vault-config";

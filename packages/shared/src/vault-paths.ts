/**
 * Vault Path Helpers
 *
 * Pure path derivation functions and constants for vault directories.
 * No I/O operations.
 */

import type { VaultInfo } from "./schemas/types";

/** Default inbox path used when no custom inbox is detected. */
export const DEFAULT_INBOX_PATH = "00_Inbox";

/** Expected path for goals.md file within the vault. */
export const GOALS_FILE_PATH = "06_Metadata/memory-loop/goals.md";

/** Common inbox directory patterns to detect. Checked in order; first match is used. */
export const INBOX_PATTERNS = [
  "00_Inbox",
  "00-Inbox",
  "Inbox",
  "inbox",
  "_Inbox",
  "0-Inbox",
];

/** Common attachment directory patterns to detect. Checked in order; first match is used. */
export const ATTACHMENT_PATTERNS = [
  "05_Attachments",
  "Attachments",
  "attachments",
  "assets",
  "images",
];

/** Result of extracting vault title from CLAUDE.md. */
export interface ExtractedTitle {
  title: string;
  subtitle?: string;
}

/**
 * Extracts the vault title and subtitle from CLAUDE.md content.
 * Uses the first H1 heading as the source.
 * If the heading contains " - ", splits into title and subtitle.
 */
export function extractVaultName(content: string): ExtractedTitle | null {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      const fullName = trimmed.slice(2).trim();
      if (fullName.length > 0) {
        const separatorIndex = fullName.indexOf(" - ");
        if (separatorIndex > 0) {
          const title = fullName.slice(0, separatorIndex).trim();
          const subtitle = fullName.slice(separatorIndex + 3).trim();
          if (title.length > 0) {
            return {
              title,
              subtitle: subtitle.length > 0 ? subtitle : undefined,
            };
          }
        }
        return { title: fullName };
      }
    }
  }
  return null;
}

/**
 * Converts a vault title to a safe directory name.
 */
export function titleToDirectoryName(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Gets the absolute path to a vault's inbox directory. */
export function getVaultInboxPath(vault: VaultInfo): string {
  return `${vault.contentRoot}/${vault.inboxPath}`;
}

/** Gets the absolute path to a vault's metadata directory. */
export function getVaultMetadataPath(vault: VaultInfo): string {
  return `${vault.contentRoot}/${vault.metadataPath}`;
}

/**
 * Vault Configuration
 *
 * Handles per-vault configuration via .memory-loop.json files.
 * Supports configuring content root, inbox path, and metadata path
 * for vaults where content is in a subdirectory (e.g., Quartz sites).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileExists } from "./vault-manager";

/**
 * Configuration file name.
 */
export const CONFIG_FILE_NAME = ".memory-loop.json";

/**
 * Per-vault configuration options.
 *
 * All paths are relative to the vault root directory.
 */
export interface VaultConfig {
  /**
   * Root directory for vault content.
   * Use when content is in a subdirectory (e.g., "content" for Quartz).
   * Default: "" (vault root)
   */
  contentRoot?: string;

  /**
   * Path to inbox directory for daily notes.
   * Relative to contentRoot.
   * Default: auto-detected from INBOX_PATTERNS or "00_Inbox"
   */
  inboxPath?: string;

  /**
   * Path to metadata directory.
   * Relative to contentRoot.
   * Default: "06_Metadata/memory-loop"
   */
  metadataPath?: string;
}

/**
 * Default metadata path relative to content root.
 */
export const DEFAULT_METADATA_PATH = "06_Metadata/memory-loop";

/**
 * Loads vault configuration from .memory-loop.json if it exists.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @returns Parsed configuration or empty object if no config file
 */
export async function loadVaultConfig(vaultPath: string): Promise<VaultConfig> {
  const configPath = join(vaultPath, CONFIG_FILE_NAME);

  if (!(await fileExists(configPath))) {
    return {};
  }

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    // Validate it's an object
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn(`[vault-config] Invalid config format in ${configPath}: expected object`);
      return {};
    }

    // Extract and validate known fields
    const config: VaultConfig = {};
    const obj = parsed as Record<string, unknown>;

    if (typeof obj.contentRoot === "string") {
      config.contentRoot = obj.contentRoot;
    }

    if (typeof obj.inboxPath === "string") {
      config.inboxPath = obj.inboxPath;
    }

    if (typeof obj.metadataPath === "string") {
      config.metadataPath = obj.metadataPath;
    }

    return config;
  } catch (error) {
    // JSON parse error or read error
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[vault-config] Failed to load config from ${configPath}: ${message}`);
    return {};
  }
}

/**
 * Resolves the absolute content root path for a vault.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param config - Vault configuration
 * @returns Absolute path to the content root
 */
export function resolveContentRoot(vaultPath: string, config: VaultConfig): string {
  if (config.contentRoot) {
    return join(vaultPath, config.contentRoot);
  }
  return vaultPath;
}

/**
 * Resolves the metadata directory path relative to content root.
 *
 * @param config - Vault configuration
 * @returns Relative path to metadata directory (from content root)
 */
export function resolveMetadataPath(config: VaultConfig): string {
  return config.metadataPath ?? DEFAULT_METADATA_PATH;
}

/**
 * Resolves the goals file path relative to content root.
 *
 * @param config - Vault configuration
 * @returns Relative path to goals.md (from content root)
 */
export function resolveGoalsPath(config: VaultConfig): string {
  const metadataPath = resolveMetadataPath(config);
  return join(metadataPath, "goals.md");
}

/**
 * Resolves the contextual prompts file path relative to content root.
 *
 * @param config - Vault configuration
 * @returns Relative path to contextual-prompts.md (from content root)
 */
export function resolveContextualPromptsPath(config: VaultConfig): string {
  const metadataPath = resolveMetadataPath(config);
  return join(metadataPath, "contextual-prompts.md");
}

/**
 * Resolves the general inspiration file path relative to content root.
 *
 * @param config - Vault configuration
 * @returns Relative path to general-inspiration.md (from content root)
 */
export function resolveGeneralInspirationPath(config: VaultConfig): string {
  const metadataPath = resolveMetadataPath(config);
  return join(metadataPath, "general-inspiration.md");
}

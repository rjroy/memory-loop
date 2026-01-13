/**
 * Vault Configuration
 *
 * Handles per-vault configuration via .memory-loop.json files.
 * Supports configuring content root, inbox path, and metadata path
 * for vaults where content is in a subdirectory (e.g., Quartz sites).
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import type { SlashCommand, Badge, BadgeColor } from "@memory-loop/shared";
import { fileExists } from "./vault-manager";
import { createLogger } from "./logger";

const log = createLogger("VaultConfig");

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
   * Override the vault title extracted from CLAUDE.md.
   * If set, this takes precedence over the H1 heading.
   */
  title?: string;

  /**
   * Override the vault subtitle extracted from CLAUDE.md.
   * If set, this takes precedence over the portion after " - " in the heading.
   */
  subtitle?: string;

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

  /**
   * Path to projects directory.
   * Relative to contentRoot.
   * Default: "01_Projects"
   */
  projectPath?: string;

  /**
   * Path to areas directory.
   * Relative to contentRoot.
   * Default: "02_Areas"
   */
  areaPath?: string;

  /**
   * Path to attachments directory for uploaded images.
   * Relative to contentRoot.
   * Default: "05_Attachments"
   */
  attachmentPath?: string;

  /**
   * Cached slash commands from Claude Code SDK.
   * Stored to provide autocomplete before SDK session is established.
   */
  slashCommands?: SlashCommand[];

  /**
   * Number of prompts to generate per generation cycle.
   * Applies to both contextual prompts (weekdays) and weekend prompts.
   * Default: 5
   */
  promptsPerGeneration?: number;

  /**
   * Maximum number of items to keep in each inspiration pool.
   * Older items are pruned when the pool exceeds this size.
   * Default: 50
   */
  maxPoolSize?: number;

  /**
   * Number of inspirational quotes to generate per week.
   * Default: 1
   */
  quotesPerWeek?: number;

  /**
   * Custom badges to display on the vault card.
   * Each badge has text and a named color from the theme palette.
   */
  badges?: Badge[];

  /**
   * Pinned assets (files and folders) for quick access in the Recall tab.
   * Paths are relative to content root.
   */
  pinnedAssets?: string[];

  /**
   * Number of recent captures to display on the home screen.
   * Default: 5
   */
  recentCaptures?: number;

  /**
   * Number of recent discussions to display on the home screen.
   * Default: 5
   */
  recentDiscussions?: number;
}

/**
 * Default metadata path relative to content root.
 */
export const DEFAULT_METADATA_PATH = "06_Metadata/memory-loop";

/**
 * Default project path relative to content root.
 */
export const DEFAULT_PROJECT_PATH = "01_Projects";

/**
 * Default area path relative to content root.
 */
export const DEFAULT_AREA_PATH = "02_Areas";

/**
 * Default attachment path relative to content root.
 */
export const DEFAULT_ATTACHMENT_PATH = "05_Attachments";

/**
 * Default number of prompts to generate per cycle.
 */
export const DEFAULT_PROMPTS_PER_GENERATION = 5;

/**
 * Default maximum pool size for inspiration items.
 */
export const DEFAULT_MAX_POOL_SIZE = 50;

/**
 * Default number of quotes to generate per week.
 */
export const DEFAULT_QUOTES_PER_WEEK = 1;

/**
 * Default number of recent captures to display.
 */
export const DEFAULT_RECENT_CAPTURES = 5;

/**
 * Default number of recent discussions to display.
 */
export const DEFAULT_RECENT_DISCUSSIONS = 5;

/**
 * Valid badge color names.
 */
export const VALID_BADGE_COLORS: BadgeColor[] = [
  "black",
  "purple",
  "red",
  "cyan",
  "orange",
  "blue",
  "green",
  "yellow",
];

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
      log.warn(`Invalid config format in ${configPath}: expected object`);
      return {};
    }

    // Extract and validate known fields
    const config: VaultConfig = {};
    const obj = parsed as Record<string, unknown>;

    if (typeof obj.title === "string") {
      config.title = obj.title;
    }

    if (typeof obj.subtitle === "string") {
      config.subtitle = obj.subtitle;
    }

    if (typeof obj.contentRoot === "string") {
      config.contentRoot = obj.contentRoot;
    }

    if (typeof obj.inboxPath === "string") {
      config.inboxPath = obj.inboxPath;
    }

    if (typeof obj.metadataPath === "string") {
      config.metadataPath = obj.metadataPath;
    }

    if (typeof obj.projectPath === "string") {
      config.projectPath = obj.projectPath;
    }

    if (typeof obj.areaPath === "string") {
      config.areaPath = obj.areaPath;
    }

    if (typeof obj.attachmentPath === "string") {
      config.attachmentPath = obj.attachmentPath;
    }

    if (Array.isArray(obj.slashCommands)) {
      config.slashCommands = obj.slashCommands
        .filter(
          (cmd): cmd is Record<string, unknown> =>
            typeof cmd === "object" &&
            cmd !== null &&
            typeof (cmd as Record<string, unknown>).name === "string" &&
            typeof (cmd as Record<string, unknown>).description === "string"
        )
        .map((cmd): SlashCommand => ({
          name: cmd.name as string,
          description: cmd.description as string,
          // Sanitize argumentHint: only include if it's a non-empty string
          ...(typeof cmd.argumentHint === "string" && cmd.argumentHint
            ? { argumentHint: cmd.argumentHint }
            : {}),
        }));
    }

    // Validate generation settings (must be positive integers)
    if (typeof obj.promptsPerGeneration === "number" && obj.promptsPerGeneration > 0) {
      config.promptsPerGeneration = Math.floor(obj.promptsPerGeneration);
    }

    if (typeof obj.maxPoolSize === "number" && obj.maxPoolSize > 0) {
      config.maxPoolSize = Math.floor(obj.maxPoolSize);
    }

    if (typeof obj.quotesPerWeek === "number" && obj.quotesPerWeek > 0) {
      config.quotesPerWeek = Math.floor(obj.quotesPerWeek);
    }

    if (typeof obj.recentCaptures === "number" && obj.recentCaptures > 0) {
      config.recentCaptures = Math.floor(obj.recentCaptures);
    }

    if (typeof obj.recentDiscussions === "number" && obj.recentDiscussions > 0) {
      config.recentDiscussions = Math.floor(obj.recentDiscussions);
    }

    // Validate badges array
    if (Array.isArray(obj.badges)) {
      config.badges = obj.badges.filter(
        (badge): badge is Badge =>
          typeof badge === "object" &&
          badge !== null &&
          typeof (badge as Record<string, unknown>).text === "string" &&
          (badge as Record<string, unknown>).text !== "" &&
          typeof (badge as Record<string, unknown>).color === "string" &&
          VALID_BADGE_COLORS.includes((badge as Record<string, unknown>).color as BadgeColor)
      );
    }

    // Validate pinnedAssets array
    if (Array.isArray(obj.pinnedAssets)) {
      config.pinnedAssets = obj.pinnedAssets.filter(
        (path): path is string => typeof path === "string" && path.length > 0
      );
    }

    return config;
  } catch (error) {
    // JSON parse error or read error
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to load config from ${configPath}: ${message}`);
    return {};
  }
}

/**
 * Resolves the absolute content root path for a vault.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param config - Vault configuration
 * @returns Absolute path to the content root
 * @throws Error if contentRoot attempts path traversal outside vault
 */
export function resolveContentRoot(vaultPath: string, config: VaultConfig): string {
  if (config.contentRoot) {
    // Reject absolute paths outright
    if (config.contentRoot.startsWith("/")) {
      log.warn(`Absolute path rejected in contentRoot: ${config.contentRoot}`);
      return vaultPath;
    }

    const resolved = normalize(join(vaultPath, config.contentRoot));
    const normalizedVaultPath = normalize(vaultPath);

    // Ensure resolved path is within vault boundary
    if (!resolved.startsWith(normalizedVaultPath + "/") && resolved !== normalizedVaultPath) {
      log.warn(`Path traversal attempt in contentRoot: ${config.contentRoot}`);
      return vaultPath;
    }

    return resolved;
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

/**
 * Resolves the projects directory path relative to content root.
 *
 * @param config - Vault configuration
 * @returns Relative path to projects directory (from content root)
 */
export function resolveProjectPath(config: VaultConfig): string {
  return config.projectPath ?? DEFAULT_PROJECT_PATH;
}

/**
 * Resolves the areas directory path relative to content root.
 *
 * @param config - Vault configuration
 * @returns Relative path to areas directory (from content root)
 */
export function resolveAreaPath(config: VaultConfig): string {
  return config.areaPath ?? DEFAULT_AREA_PATH;
}

/**
 * Resolves the attachments directory path relative to content root.
 *
 * @param config - Vault configuration
 * @returns Relative path to attachments directory (from content root)
 */
export function resolveAttachmentPath(config: VaultConfig): string {
  return config.attachmentPath ?? DEFAULT_ATTACHMENT_PATH;
}

/**
 * Resolves the number of prompts to generate per cycle.
 *
 * @param config - Vault configuration
 * @returns Number of prompts to generate (default: 5)
 */
export function resolvePromptsPerGeneration(config: VaultConfig): number {
  return config.promptsPerGeneration ?? DEFAULT_PROMPTS_PER_GENERATION;
}

/**
 * Resolves the maximum pool size for inspiration items.
 *
 * @param config - Vault configuration
 * @returns Maximum pool size (default: 50)
 */
export function resolveMaxPoolSize(config: VaultConfig): number {
  return config.maxPoolSize ?? DEFAULT_MAX_POOL_SIZE;
}

/**
 * Resolves the number of quotes to generate per week.
 *
 * @param config - Vault configuration
 * @returns Number of quotes per week (default: 1)
 */
export function resolveQuotesPerWeek(config: VaultConfig): number {
  return config.quotesPerWeek ?? DEFAULT_QUOTES_PER_WEEK;
}

/**
 * Resolves custom badges from configuration.
 *
 * @param config - Vault configuration
 * @returns Array of badges (default: empty array)
 */
export function resolveBadges(config: VaultConfig): Badge[] {
  return config.badges ?? [];
}

/**
 * Resolves pinned assets from configuration.
 *
 * @param config - Vault configuration
 * @returns Array of pinned asset paths (default: empty array)
 */
export function resolvePinnedAssets(config: VaultConfig): string[] {
  return config.pinnedAssets ?? [];
}

/**
 * Resolves the number of recent captures to display.
 *
 * @param config - Vault configuration
 * @returns Number of recent captures (default: 5)
 */
export function resolveRecentCaptures(config: VaultConfig): number {
  return config.recentCaptures ?? DEFAULT_RECENT_CAPTURES;
}

/**
 * Resolves the number of recent discussions to display.
 *
 * @param config - Vault configuration
 * @returns Number of recent discussions (default: 5)
 */
export function resolveRecentDiscussions(config: VaultConfig): number {
  return config.recentDiscussions ?? DEFAULT_RECENT_DISCUSSIONS;
}

/**
 * Saves pinned assets to the vault configuration file.
 * Preserves existing configuration fields while updating pinnedAssets.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param paths - Pinned asset paths to save
 */
export async function savePinnedAssets(
  vaultPath: string,
  paths: string[]
): Promise<void> {
  const configPath = join(vaultPath, CONFIG_FILE_NAME);

  let existingConfig: Record<string, unknown> = {};

  if (await fileExists(configPath)) {
    try {
      const content = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(content) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        existingConfig = parsed as Record<string, unknown>;
      }
    } catch {
      // If we can't read existing config, start fresh
    }
  }

  existingConfig.pinnedAssets = paths;

  await writeFile(configPath, JSON.stringify(existingConfig, null, 2) + "\n", "utf-8");
  log.info(`Saved ${paths.length} pinned assets to ${configPath}`);
}

/**
 * Saves slash commands to the vault configuration file.
 * Preserves existing configuration fields while updating slashCommands.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @param commands - Slash commands to cache
 */
export async function saveSlashCommands(
  vaultPath: string,
  commands: SlashCommand[]
): Promise<void> {
  const configPath = join(vaultPath, CONFIG_FILE_NAME);

  let existingConfig: Record<string, unknown> = {};

  if (await fileExists(configPath)) {
    try {
      const content = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(content) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        existingConfig = parsed as Record<string, unknown>;
      }
    } catch {
      // If we can't read existing config, start fresh
    }
  }

  existingConfig.slashCommands = commands;

  await writeFile(configPath, JSON.stringify(existingConfig, null, 2) + "\n", "utf-8");
  log.info(`Cached ${commands.length} slash commands to ${configPath}`);
}

/**
 * Checks if two slash command arrays are equivalent.
 * Used to detect when cached commands need updating.
 *
 * @param a - First command array
 * @param b - Second command array
 * @returns true if arrays contain the same commands
 */
export function slashCommandsEqual(
  a: SlashCommand[] | undefined,
  b: SlashCommand[] | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  return a.every((cmdA, i) => {
    const cmdB = b[i];
    return (
      cmdA.name === cmdB.name &&
      cmdA.description === cmdB.description &&
      cmdA.argumentHint === cmdB.argumentHint
    );
  });
}

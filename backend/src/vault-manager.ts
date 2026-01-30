/**
 * Vault Manager
 *
 * Discovers Obsidian vaults from the VAULTS_DIR environment variable.
 * Parses CLAUDE.md for vault metadata and detects inbox locations.
 */

import { readdir, readFile, stat, access, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { VaultInfo } from "@memory-loop/shared";
import { vaultLog as log } from "./logger";
import {
  loadVaultConfig,
  resolveContentRoot,
  resolveMetadataPath,
  resolveGoalsPath,
  resolveAttachmentPath,
  resolvePromptsPerGeneration,
  resolveMaxPoolSize,
  resolveQuotesPerWeek,
  resolveRecentCaptures,
  resolveRecentDiscussions,
  resolveDiscussionModel,
  resolveBadges,
  resolveOrder,
  resolveCardsEnabled,
  resolveViMode,
  type VaultConfig,
} from "./vault-config";

/**
 * Error thrown when VAULTS_DIR is not configured or inaccessible.
 */
export class VaultsDirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultsDirError";
  }
}

/**
 * Default vaults directory name (relative to project root).
 */
export const DEFAULT_VAULTS_DIR_NAME = "vaults";

/**
 * Default inbox path used when no custom inbox is detected.
 */
export const DEFAULT_INBOX_PATH = "00_Inbox";

/**
 * Expected path for goals.md file within the vault.
 * Uses the 06_Metadata/memory-loop convention for vault metadata.
 */
export const GOALS_FILE_PATH = "06_Metadata/memory-loop/goals.md";

/**
 * Common inbox directory patterns to detect.
 * Checked in order; first match is used.
 */
export const INBOX_PATTERNS = [
  "00_Inbox",
  "00-Inbox",
  "Inbox",
  "inbox",
  "_Inbox",
  "0-Inbox",
];

/**
 * Common attachment directory patterns to detect.
 * Checked in order; first match is used.
 */
export const ATTACHMENT_PATTERNS = [
  "05_Attachments",
  "Attachments",
  "attachments",
  "assets",
  "images",
];

/**
 * Gets the project root directory (parent of backend/).
 */
function getProjectRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const backendSrc = dirname(currentFile);
  const backend = dirname(backendSrc);
  return dirname(backend);
}

/**
 * Gets the default vaults directory path (project root / vaults).
 */
export function getDefaultVaultsDir(): string {
  return join(getProjectRoot(), DEFAULT_VAULTS_DIR_NAME);
}

/**
 * Gets the vaults directory path.
 *
 * If VAULTS_DIR environment variable is set, uses that path.
 * Otherwise, defaults to the "vaults" directory at the project root
 * (same level as backend/).
 *
 * @returns The path to the vaults directory
 */
export function getVaultsDir(): string {
  const vaultsDir = process.env.VAULTS_DIR || getDefaultVaultsDir();
  log.debug(`VAULTS_DIR: ${vaultsDir}`);
  return vaultsDir;
}

/**
 * Checks if a directory exists and is accessible.
 *
 * @param dirPath - Path to check
 * @returns true if directory exists and is accessible
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath);
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Checks if a file exists and is accessible.
 *
 * @param filePath - Path to check
 * @returns true if file exists and is accessible
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Result of extracting vault title from CLAUDE.md.
 */
export interface ExtractedTitle {
  /** Title portion (before " - " if present, or full heading) */
  title: string;
  /** Subtitle portion (after " - " if present) */
  subtitle?: string;
}

/**
 * Extracts the vault title and subtitle from CLAUDE.md content.
 * Uses the first H1 heading (line starting with "# ") as the source.
 * If the heading contains " - ", splits into title and subtitle.
 *
 * @param content - The content of CLAUDE.md
 * @returns Extracted title/subtitle or null if no H1 heading found
 */
export function extractVaultName(content: string): ExtractedTitle | null {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      const fullName = trimmed.slice(2).trim();
      if (fullName.length > 0) {
        // Check for " - " separator to split title and subtitle
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
 * Detects the inbox path for a vault by checking common patterns.
 *
 * @param contentRoot - Absolute path to the content root directory
 * @returns The detected inbox path (relative to content root) or default
 */
export async function detectInboxPath(contentRoot: string): Promise<string> {
  for (const pattern of INBOX_PATTERNS) {
    const inboxFullPath = join(contentRoot, pattern);
    if (await directoryExists(inboxFullPath)) {
      return pattern;
    }
  }
  return DEFAULT_INBOX_PATH;
}

/**
 * Detects the attachment path for a vault by checking common patterns.
 *
 * @param contentRoot - Absolute path to the content root directory
 * @param config - Vault configuration (may contain custom attachmentPath)
 * @returns The detected attachment path (relative to content root) or configured default
 */
export async function detectAttachmentPath(
  contentRoot: string,
  config: VaultConfig
): Promise<string> {
  // If configured, use that
  if (config.attachmentPath) {
    return config.attachmentPath;
  }

  // Otherwise detect from common patterns
  for (const pattern of ATTACHMENT_PATTERNS) {
    const attachmentFullPath = join(contentRoot, pattern);
    if (await directoryExists(attachmentFullPath)) {
      return pattern;
    }
  }

  // Return the default from config resolver
  return resolveAttachmentPath(config);
}

/**
 * Detects the goals.md file path for a vault.
 *
 * @param contentRoot - Absolute path to the content root directory
 * @param config - Vault configuration
 * @returns The goals file path (relative to content root) if it exists, or undefined
 */
export async function detectGoalsPath(
  contentRoot: string,
  config: VaultConfig
): Promise<string | undefined> {
  const goalsRelativePath = resolveGoalsPath(config);
  const goalsFullPath = join(contentRoot, goalsRelativePath);
  if (await fileExists(goalsFullPath)) {
    return goalsRelativePath;
  }
  return undefined;
}

/**
 * Reads and parses a single vault directory.
 * Returns null if the directory is not a valid vault (no CLAUDE.md).
 *
 * @param vaultsDir - Parent directory containing vaults
 * @param dirName - Name of the vault directory
 * @returns VaultInfo or null if not a valid vault
 */
export async function parseVault(
  vaultsDir: string,
  dirName: string
): Promise<VaultInfo | null> {
  const vaultPath = join(vaultsDir, dirName);

  // Check if it's a directory
  if (!(await directoryExists(vaultPath))) {
    return null;
  }

  // Check for CLAUDE.md
  const claudeMdPath = join(vaultPath, "CLAUDE.md");
  const hasClaudeMd = await fileExists(claudeMdPath);

  // Skip directories without CLAUDE.md as per acceptance criteria
  if (!hasClaudeMd) {
    return null;
  }

  // Load vault configuration (if .memory-loop.json exists)
  const config = await loadVaultConfig(vaultPath);

  // Resolve content root (may be different from vault root)
  const contentRoot = resolveContentRoot(vaultPath, config);

  // Extract vault name and subtitle from CLAUDE.md
  let name = dirName; // Default to directory name
  let subtitle: string | undefined;
  try {
    const content = await readFile(claudeMdPath, "utf-8");
    const extracted = extractVaultName(content);
    if (extracted) {
      name = extracted.title;
      subtitle = extracted.subtitle;
    }
  } catch {
    // Failed to read CLAUDE.md, use directory name
  }

  // Apply config overrides if present
  if (config.title) {
    name = config.title;
  }
  if (config.subtitle !== undefined) {
    subtitle = config.subtitle || undefined; // Empty string becomes undefined
  }

  // Detect or use configured inbox path
  const inboxPath = config.inboxPath ?? (await detectInboxPath(contentRoot));

  // Resolve metadata path from config
  const metadataPath = resolveMetadataPath(config);

  // Detect goals.md file
  const goalsPath = await detectGoalsPath(contentRoot, config);

  // Detect or use configured attachment path
  const attachmentPath = await detectAttachmentPath(contentRoot, config);

  // Check for setup completion marker
  const setupMarkerPath = join(vaultPath, ".memory-loop/setup-complete");
  const setupComplete = await fileExists(setupMarkerPath);

  return {
    id: dirName,
    name,
    subtitle,
    path: vaultPath,
    hasClaudeMd,
    contentRoot,
    inboxPath,
    metadataPath,
    goalsPath,
    attachmentPath,
    setupComplete,
    discussionModel: resolveDiscussionModel(config),
    promptsPerGeneration: resolvePromptsPerGeneration(config),
    maxPoolSize: resolveMaxPoolSize(config),
    quotesPerWeek: resolveQuotesPerWeek(config),
    recentCaptures: resolveRecentCaptures(config),
    recentDiscussions: resolveRecentDiscussions(config),
    badges: resolveBadges(config),
    order: resolveOrder(config),
    cardsEnabled: resolveCardsEnabled(config),
    viMode: resolveViMode(config),
  };
}

/**
 * Ensures the vaults directory exists, creating it if necessary.
 *
 * @param vaultsDir - Path to the vaults directory
 * @returns true if directory was created, false if it already existed
 * @throws VaultsDirError if directory cannot be created
 */
export async function ensureVaultsDir(vaultsDir: string): Promise<boolean> {
  const existedBefore = await directoryExists(vaultsDir);
  if (existedBefore) {
    return false;
  }

  log.info(`Creating vaults directory: ${vaultsDir}`);
  try {
    await mkdir(vaultsDir, { recursive: true });
    return true;
  } catch (error) {
    // Handle race condition: another process may have created it
    if (await directoryExists(vaultsDir)) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to create vaults directory: ${message}`);
    throw new VaultsDirError(
      `Failed to create vaults directory "${vaultsDir}": ${message}`
    );
  }
}

/**
 * Discovers all valid vaults in the VAULTS_DIR directory.
 *
 * A valid vault is a directory containing a CLAUDE.md file.
 * Individual vault errors are logged but do not stop discovery.
 * If the vaults directory doesn't exist, it will be created.
 *
 * @returns Array of VaultInfo for all valid vaults
 * @throws VaultsDirError if VAULTS_DIR cannot be accessed or created
 */
export async function discoverVaults(): Promise<VaultInfo[]> {
  log.info("Discovering vaults...");
  const vaultsDir = getVaultsDir();

  // Ensure vaults directory exists (create if needed)
  const created = await ensureVaultsDir(vaultsDir);
  if (created) {
    log.info(`Created vaults directory: ${vaultsDir}`);
  }

  log.info(`Scanning: ${vaultsDir}`);

  // List all entries in VAULTS_DIR
  let entries: string[];
  try {
    entries = await readdir(vaultsDir);
    log.debug(`Found ${entries.length} entries`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to read VAULTS_DIR: ${message}`);
    throw new VaultsDirError(
      `Failed to read VAULTS_DIR "${vaultsDir}": ${message}`
    );
  }

  // Filter and parse vaults
  const vaults: VaultInfo[] = [];

  for (const entry of entries) {
    // Skip hidden directories
    if (entry.startsWith(".")) {
      log.debug(`Skipping hidden: ${entry}`);
      continue;
    }

    try {
      log.debug(`Checking: ${entry}`);
      const vault = await parseVault(vaultsDir, entry);
      if (vault) {
        log.info(`Found vault: ${vault.id} (${vault.name})`);
        vaults.push(vault);
      } else {
        log.debug(`Not a vault (no CLAUDE.md): ${entry}`);
      }
    } catch (error) {
      // Log individual vault errors but continue with other vaults
      log.warn(
        `Failed to parse vault "${entry}":`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // Sort vaults by order first (lower values first), then alphabetically by name
  vaults.sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.name.localeCompare(b.name);
  });

  log.info(`Discovery complete: ${vaults.length} vault(s) found`);
  return vaults;
}

/**
 * Gets a single vault by ID.
 *
 * @param vaultId - The vault directory name
 * @returns VaultInfo or null if not found
 * @throws VaultsDirError if VAULTS_DIR cannot be accessed or created
 */
export async function getVaultById(vaultId: string): Promise<VaultInfo | null> {
  log.info(`Looking up vault: ${vaultId}`);
  const vaultsDir = getVaultsDir();

  // Ensure vaults directory exists (create if needed)
  await ensureVaultsDir(vaultsDir);

  const vault = await parseVault(vaultsDir, vaultId);
  if (vault) {
    log.info(`Vault found: ${vault.name} at ${vault.path}`);
  } else {
    log.warn(`Vault not found: ${vaultId}`);
  }
  return vault;
}

/**
 * Gets the absolute path to a vault's inbox directory.
 *
 * @param vault - The VaultInfo object
 * @returns Absolute path to the inbox directory
 */
export function getVaultInboxPath(vault: VaultInfo): string {
  return join(vault.contentRoot, vault.inboxPath);
}

/**
 * Gets the absolute path to a vault's metadata directory.
 *
 * @param vault - The VaultInfo object
 * @returns Absolute path to the metadata directory
 */
export function getVaultMetadataPath(vault: VaultInfo): string {
  return join(vault.contentRoot, vault.metadataPath);
}

/**
 * Reads goals from a vault's goals.md file.
 *
 * @param vault - The VaultInfo object
 * @returns Raw markdown content, or null if no goals file exists
 */
export async function getVaultGoals(vault: VaultInfo): Promise<string | null> {
  if (!vault.goalsPath) {
    return null;
  }

  const goalsFullPath = join(vault.contentRoot, vault.goalsPath);

  try {
    return await readFile(goalsFullPath, "utf-8");
  } catch {
    log.warn(`Failed to read goals file: ${goalsFullPath}`);
    return null;
  }
}

/**
 * Converts a vault title to a safe directory name.
 * - Converts to lowercase
 * - Replaces spaces with hyphens
 * - Removes non-alphanumeric characters (except hyphens)
 * - Collapses multiple hyphens
 * - Trims leading/trailing hyphens
 *
 * @param title - User-provided vault title
 * @returns Safe directory name
 */
export function titleToDirectoryName(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Generates a unique directory name by appending numeric suffix if needed.
 *
 * @param vaultsDir - Parent directory containing vaults
 * @param baseName - Base directory name
 * @returns Unique directory name
 */
export async function getUniqueDirectoryName(
  vaultsDir: string,
  baseName: string
): Promise<string> {
  // Try the base name first
  if (!(await directoryExists(join(vaultsDir, baseName)))) {
    return baseName;
  }

  // Add numeric suffix until unique
  let counter = 2;
  while (counter < 100) {
    const candidate = `${baseName}-${counter}`;
    if (!(await directoryExists(join(vaultsDir, candidate)))) {
      return candidate;
    }
    counter++;
  }

  // Fallback with timestamp (very unlikely to be needed)
  return `${baseName}-${Date.now()}`;
}

/**
 * Error thrown when vault creation fails.
 */
export class VaultCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultCreationError";
  }
}

/**
 * Creates a new vault with the given title.
 *
 * Steps:
 * 1. Convert title to safe directory name
 * 2. Ensure uniqueness with numeric suffix
 * 3. Create directory in VAULTS_DIR
 * 4. Create CLAUDE.md with title as H1 heading
 * 5. Return parsed VaultInfo
 *
 * @param title - User-provided vault title
 * @returns VaultInfo for the newly created vault
 * @throws VaultCreationError if creation fails
 */
export async function createVault(title: string): Promise<VaultInfo> {
  log.info(`Creating new vault: "${title}"`);

  // Validate title
  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0) {
    throw new VaultCreationError("Vault title cannot be empty");
  }

  // Convert to safe directory name
  const baseName = titleToDirectoryName(trimmedTitle);
  if (baseName.length === 0) {
    throw new VaultCreationError(
      "Vault title must contain at least one alphanumeric character"
    );
  }

  // Get vaults directory
  const vaultsDir = getVaultsDir();
  await ensureVaultsDir(vaultsDir);

  // Generate unique directory name
  const dirName = await getUniqueDirectoryName(vaultsDir, baseName);
  const vaultPath = join(vaultsDir, dirName);

  log.info(`Creating vault directory: ${vaultPath}`);

  // Create the vault directory
  try {
    await mkdir(vaultPath, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new VaultCreationError(`Failed to create vault directory: ${message}`);
  }

  // Create CLAUDE.md with title as H1 heading
  const claudeMdPath = join(vaultPath, "CLAUDE.md");
  const claudeMdContent = `# ${trimmedTitle}

This vault was created by Memory Loop.
`;

  try {
    await writeFile(claudeMdPath, claudeMdContent, "utf-8");
    log.info(`Created CLAUDE.md: ${claudeMdPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new VaultCreationError(`Failed to create CLAUDE.md: ${message}`);
  }

  // Parse and return the vault info
  const vault = await parseVault(vaultsDir, dirName);
  if (!vault) {
    throw new VaultCreationError("Failed to parse newly created vault");
  }

  log.info(`Vault created successfully: ${vault.id} (${vault.name})`);
  return vault;
}

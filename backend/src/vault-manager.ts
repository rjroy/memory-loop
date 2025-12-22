/**
 * Vault Manager
 *
 * Discovers Obsidian vaults from the VAULTS_DIR environment variable.
 * Parses CLAUDE.md for vault metadata and detects inbox locations.
 */

import { readdir, readFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import type { VaultInfo } from "@memory-loop/shared";

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
 * Default inbox path used when no custom inbox is detected.
 */
export const DEFAULT_INBOX_PATH = "00_Inbox";

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
 * Gets the VAULTS_DIR environment variable.
 *
 * @returns The path to the vaults directory
 * @throws VaultsDirError if VAULTS_DIR is not set
 */
export function getVaultsDir(): string {
  const vaultsDir = process.env.VAULTS_DIR;
  if (!vaultsDir) {
    throw new VaultsDirError(
      "VAULTS_DIR environment variable is not set. " +
        "Set it to the parent directory containing your Obsidian vaults."
    );
  }
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
 * Extracts the vault name from CLAUDE.md content.
 * Uses the first H1 heading (line starting with "# ") as the name.
 *
 * @param content - The content of CLAUDE.md
 * @returns The vault name or null if no H1 heading found
 */
export function extractVaultName(content: string): string | null {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      const name = trimmed.slice(2).trim();
      if (name.length > 0) {
        return name;
      }
    }
  }
  return null;
}

/**
 * Detects the inbox path for a vault by checking common patterns.
 *
 * @param vaultPath - Absolute path to the vault directory
 * @returns The detected inbox path (relative to vault) or default
 */
export async function detectInboxPath(vaultPath: string): Promise<string> {
  for (const pattern of INBOX_PATTERNS) {
    const inboxFullPath = join(vaultPath, pattern);
    if (await directoryExists(inboxFullPath)) {
      return pattern;
    }
  }
  return DEFAULT_INBOX_PATH;
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

  // Extract vault name from CLAUDE.md
  let name = dirName; // Default to directory name
  try {
    const content = await readFile(claudeMdPath, "utf-8");
    const extractedName = extractVaultName(content);
    if (extractedName) {
      name = extractedName;
    }
  } catch {
    // Failed to read CLAUDE.md, use directory name
  }

  // Detect inbox path
  const inboxPath = await detectInboxPath(vaultPath);

  return {
    id: dirName,
    name,
    path: vaultPath,
    hasClaudeMd,
    inboxPath,
  };
}

/**
 * Discovers all valid vaults in the VAULTS_DIR directory.
 *
 * A valid vault is a directory containing a CLAUDE.md file.
 * Individual vault errors are logged but do not stop discovery.
 *
 * @returns Array of VaultInfo for all valid vaults
 * @throws VaultsDirError if VAULTS_DIR is not set or inaccessible
 */
export async function discoverVaults(): Promise<VaultInfo[]> {
  const vaultsDir = getVaultsDir();

  // Verify VAULTS_DIR exists and is accessible
  if (!(await directoryExists(vaultsDir))) {
    throw new VaultsDirError(
      `VAULTS_DIR "${vaultsDir}" does not exist or is not accessible. ` +
        "Ensure the directory exists and you have read permissions."
    );
  }

  // List all entries in VAULTS_DIR
  let entries: string[];
  try {
    entries = await readdir(vaultsDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new VaultsDirError(
      `Failed to read VAULTS_DIR "${vaultsDir}": ${message}`
    );
  }

  // Filter and parse vaults
  const vaults: VaultInfo[] = [];

  for (const entry of entries) {
    // Skip hidden directories
    if (entry.startsWith(".")) {
      continue;
    }

    try {
      const vault = await parseVault(vaultsDir, entry);
      if (vault) {
        vaults.push(vault);
      }
    } catch (error) {
      // Log individual vault errors but continue with other vaults
      console.warn(
        `Warning: Failed to parse vault "${entry}":`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // Sort vaults by name for consistent ordering
  vaults.sort((a, b) => a.name.localeCompare(b.name));

  return vaults;
}

/**
 * Gets a single vault by ID.
 *
 * @param vaultId - The vault directory name
 * @returns VaultInfo or null if not found
 * @throws VaultsDirError if VAULTS_DIR is not set or inaccessible
 */
export async function getVaultById(vaultId: string): Promise<VaultInfo | null> {
  const vaultsDir = getVaultsDir();

  // Verify VAULTS_DIR exists
  if (!(await directoryExists(vaultsDir))) {
    throw new VaultsDirError(
      `VAULTS_DIR "${vaultsDir}" does not exist or is not accessible.`
    );
  }

  return parseVault(vaultsDir, vaultId);
}

/**
 * Gets the absolute path to a vault's inbox directory.
 *
 * @param vault - The VaultInfo object
 * @returns Absolute path to the inbox directory
 */
export function getVaultInboxPath(vault: VaultInfo): string {
  return join(vault.path, vault.inboxPath);
}

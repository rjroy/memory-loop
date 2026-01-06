/**
 * Vault Setup
 *
 * Orchestrates the setup process for a vault:
 * 1. Install command templates to .claude/commands/
 * 2. Create missing PARA directories
 * 3. Write setup completion marker
 *
 * Note: CLAUDE.md update via SDK is implemented in TASK-004.
 */

import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "./logger";
import { getVaultById, fileExists, directoryExists } from "./vault-manager";
import { validatePath } from "./file-browser";
import {
  loadVaultConfig,
  resolveContentRoot,
  resolveProjectPath,
  resolveAreaPath,
  type VaultConfig,
} from "./vault-config";

const log = createLogger("VaultSetup");

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a single setup step.
 */
export interface SetupStepResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Overall result of the setup process.
 */
export interface SetupResult {
  success: boolean;
  summary: string[];
  errors?: string[];
}

/**
 * Marker file written on setup completion.
 * Stored at .memory-loop/setup-complete
 */
export interface SetupCompleteMarker {
  completedAt: string;
  version: string;
  commandsInstalled: string[];
  paraCreated: string[];
  claudeMdUpdated: boolean;
  errors?: string[];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Setup marker version for this implementation.
 */
export const SETUP_VERSION = "1.0.0";

/**
 * Path to the setup marker file relative to vault root.
 */
export const SETUP_MARKER_PATH = ".memory-loop/setup-complete";

/**
 * Path to command templates relative to vault root.
 */
export const COMMANDS_DEST_PATH = ".claude/commands";

/**
 * Default PARA directory names (relative to content root).
 */
export const DEFAULT_PARA_DIRS = [
  "01_Projects",
  "02_Areas",
  "03_Resources",
  "04_Archives",
];

// =============================================================================
// Command Installation
// =============================================================================

/**
 * Gets the path to the bundled command templates directory.
 */
function getCommandTemplatesDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  return join(currentDir, "commands");
}

/**
 * Installs command templates to the vault's .claude/commands/ directory.
 * Skips files that already exist (does not overwrite).
 *
 * @param vaultPath - Absolute path to the vault root
 * @returns Setup step result with list of installed commands
 */
export async function installCommands(
  vaultPath: string
): Promise<SetupStepResult & { installed: string[] }> {
  log.info(`Installing commands to ${vaultPath}`);

  const installed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const templatesDir = getCommandTemplatesDir();
  const destDir = join(vaultPath, COMMANDS_DEST_PATH);

  // Validate destination is within vault boundary
  try {
    await validatePath(vaultPath, COMMANDS_DEST_PATH);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: "Failed to validate commands destination path",
      error: message,
      installed: [],
    };
  }

  // Create destination directory if it doesn't exist
  try {
    await mkdir(destDir, { recursive: true });
    log.debug(`Created commands directory: ${destDir}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: "Failed to create .claude/commands directory",
      error: message,
      installed: [],
    };
  }

  // List available templates
  let templates: string[];
  try {
    templates = await readdir(templatesDir);
    templates = templates.filter((f) => f.endsWith(".md"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: "Failed to read command templates",
      error: message,
      installed: [],
    };
  }

  // Copy each template
  for (const template of templates) {
    const srcPath = join(templatesDir, template);
    const destPath = join(destDir, template);

    // Check if file already exists
    if (await fileExists(destPath)) {
      log.debug(`Skipping existing: ${template}`);
      skipped.push(template);
      continue;
    }

    // Copy template
    try {
      await copyFile(srcPath, destPath);
      log.info(`Installed: ${template}`);
      installed.push(template);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Failed to install ${template}: ${message}`);
      errors.push(`${template}: ${message}`);
    }
  }

  // Build result message
  const parts: string[] = [];
  if (installed.length > 0) {
    parts.push(`Installed ${installed.length} command(s)`);
  }
  if (skipped.length > 0) {
    parts.push(`${skipped.length} already existed`);
  }

  const resultMessage = parts.join(", ") || "No commands to install";

  if (errors.length > 0) {
    return {
      success: false,
      message: resultMessage,
      error: errors.join("; "),
      installed,
    };
  }

  return {
    success: true,
    message: resultMessage,
    installed,
  };
}

// =============================================================================
// PARA Directory Creation
// =============================================================================

/**
 * Creates missing PARA directories in the vault.
 * Respects custom paths from vault config.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param config - Vault configuration
 * @returns Setup step result with list of created directories
 */
export async function createParaDirectories(
  vaultPath: string,
  config: VaultConfig
): Promise<SetupStepResult & { created: string[] }> {
  log.info(`Creating PARA directories in ${vaultPath}`);

  const created: string[] = [];
  const existed: string[] = [];
  const errors: string[] = [];

  const contentRoot = resolveContentRoot(vaultPath, config);

  // Build list of PARA directories with custom paths where configured
  const paraDirs: { name: string; relativePath: string }[] = [
    { name: "Projects", relativePath: resolveProjectPath(config) },
    { name: "Areas", relativePath: resolveAreaPath(config) },
    { name: "Resources", relativePath: "03_Resources" },
    { name: "Archives", relativePath: "04_Archives" },
  ];

  for (const dir of paraDirs) {
    const absolutePath = join(contentRoot, dir.relativePath);

    // Validate path is within vault boundary
    try {
      await validatePath(vaultPath, dir.relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${dir.name} (${dir.relativePath}): ${message}`);
      continue;
    }

    // Check if directory exists
    if (await directoryExists(absolutePath)) {
      log.debug(`Exists: ${dir.relativePath}`);
      existed.push(dir.name);
      continue;
    }

    // Create directory
    try {
      await mkdir(absolutePath, { recursive: true });
      log.info(`Created: ${dir.relativePath}`);
      created.push(dir.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Failed to create ${dir.relativePath}: ${message}`);
      errors.push(`${dir.name}: ${message}`);
    }
  }

  // Build result message
  const parts: string[] = [];
  if (created.length > 0) {
    parts.push(`Created ${created.length} directory(s)`);
  }
  if (existed.length > 0) {
    parts.push(`${existed.length} already existed`);
  }

  const resultMessage = parts.join(", ") || "No directories to create";

  if (errors.length > 0) {
    return {
      success: false,
      message: resultMessage,
      error: errors.join("; "),
      created,
    };
  }

  return {
    success: true,
    message: resultMessage,
    created,
  };
}

// =============================================================================
// Setup Marker
// =============================================================================

/**
 * Writes the setup completion marker file.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param marker - Setup completion marker data
 */
export async function writeSetupMarker(
  vaultPath: string,
  marker: SetupCompleteMarker
): Promise<SetupStepResult> {
  log.info(`Writing setup marker to ${vaultPath}`);

  const markerPath = join(vaultPath, SETUP_MARKER_PATH);
  const markerDir = dirname(markerPath);

  // Validate path is within vault boundary
  try {
    await validatePath(vaultPath, SETUP_MARKER_PATH);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: "Failed to validate marker path",
      error: message,
    };
  }

  // Create .memory-loop directory if needed
  try {
    await mkdir(markerDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: "Failed to create .memory-loop directory",
      error: message,
    };
  }

  // Write marker file
  try {
    const content = JSON.stringify(marker, null, 2);
    await writeFile(markerPath, content, "utf-8");
    log.info(`Setup marker written: ${markerPath}`);
    return {
      success: true,
      message: "Setup marker written",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: "Failed to write setup marker",
      error: message,
    };
  }
}

/**
 * Checks if a vault has completed setup.
 *
 * @param vaultPath - Absolute path to the vault root
 * @returns true if setup marker exists
 */
export async function isSetupComplete(vaultPath: string): Promise<boolean> {
  const markerPath = join(vaultPath, SETUP_MARKER_PATH);
  return fileExists(markerPath);
}

// =============================================================================
// Main Orchestration
// =============================================================================

/**
 * Runs the complete vault setup process.
 *
 * Steps:
 * 1. Install command templates
 * 2. Create PARA directories
 * 3. Write setup marker
 *
 * Note: CLAUDE.md update via SDK will be added in TASK-004.
 *
 * @param vaultId - ID of the vault to set up
 * @returns Setup result with summary and any errors
 */
export async function runVaultSetup(vaultId: string): Promise<SetupResult> {
  log.info(`Starting setup for vault: ${vaultId}`);

  // Get vault info
  const vault = await getVaultById(vaultId);
  if (!vault) {
    return {
      success: false,
      summary: [],
      errors: [`Vault not found: ${vaultId}`],
    };
  }

  const vaultPath = vault.path;
  const config = await loadVaultConfig(vaultPath);

  const summary: string[] = [];
  const errors: string[] = [];

  // Track what was installed/created for the marker
  let commandsInstalled: string[] = [];
  let paraCreated: string[] = [];

  // Step 1: Install commands
  const commandsResult = await installCommands(vaultPath);
  summary.push(commandsResult.message);
  commandsInstalled = commandsResult.installed;
  if (!commandsResult.success && commandsResult.error) {
    errors.push(`Commands: ${commandsResult.error}`);
  }

  // Step 2: Create PARA directories
  const paraResult = await createParaDirectories(vaultPath, config);
  summary.push(paraResult.message);
  paraCreated = paraResult.created;
  if (!paraResult.success && paraResult.error) {
    errors.push(`PARA: ${paraResult.error}`);
  }

  // Note: Step 3 (CLAUDE.md update) will be added in TASK-004
  // For now, we mark it as not updated
  const claudeMdUpdated = false;

  // Step 4: Write setup marker (always attempt, even with partial failures)
  const marker: SetupCompleteMarker = {
    completedAt: new Date().toISOString(),
    version: SETUP_VERSION,
    commandsInstalled,
    paraCreated,
    claudeMdUpdated,
    errors: errors.length > 0 ? errors : undefined,
  };

  const markerResult = await writeSetupMarker(vaultPath, marker);
  if (!markerResult.success && markerResult.error) {
    errors.push(`Marker: ${markerResult.error}`);
    summary.push("Failed to write setup marker");
  } else {
    summary.push("Setup marker written");
  }

  // Overall success is true if we completed without critical failures
  // (some non-critical errors like "file already exists" are acceptable)
  const success = errors.length === 0;

  log.info(`Setup complete for ${vaultId}: success=${success}`);

  return {
    success,
    summary,
    errors: errors.length > 0 ? errors : undefined,
  };
}

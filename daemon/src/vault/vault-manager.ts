/**
 * Vault Manager (Daemon)
 *
 * Vault discovery, creation, and filesystem operations.
 * This is the authoritative implementation per REQ-DAB-1.
 */

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { VaultInfo, VaultConfig } from "@memory-loop/shared";
import {
  createLogger,
  extractVaultName,
  titleToDirectoryName,
  INBOX_PATTERNS,
  ATTACHMENT_PATTERNS,
  DEFAULT_INBOX_PATH,
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
} from "@memory-loop/shared";
import { fileExists, directoryExists, resolveContentRoot } from "@memory-loop/shared/server";
import { loadVaultConfig } from "./vault-config";

const log = createLogger("Vault");

export class VaultsDirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultsDirError";
  }
}

export const DEFAULT_VAULTS_DIR_NAME = "vaults";

/**
 * Gets the daemon's root directory.
 * Uses DAEMON_ROOT env var or falls back to the daemon package's parent directory.
 */
function getDaemonRoot(): string {
  if (process.env.DAEMON_ROOT) {
    return process.env.DAEMON_ROOT;
  }
  // daemon/src/vault/vault-manager.ts -> daemon/src/vault -> daemon/src -> daemon -> project root
  const currentDir = dirname(new URL(import.meta.url).pathname);
  return join(currentDir, "..", "..", "..");
}

export function getDefaultVaultsDir(): string {
  return join(getDaemonRoot(), DEFAULT_VAULTS_DIR_NAME);
}

export function getVaultsDir(): string {
  const vaultsDir = process.env.VAULTS_DIR || getDefaultVaultsDir();
  log.debug(`VAULTS_DIR: ${vaultsDir}`);
  return vaultsDir;
}

export async function detectInboxPath(contentRoot: string): Promise<string> {
  for (const pattern of INBOX_PATTERNS) {
    const inboxFullPath = join(contentRoot, pattern);
    if (await directoryExists(inboxFullPath)) {
      return pattern;
    }
  }
  return DEFAULT_INBOX_PATH;
}

export async function detectAttachmentPath(
  contentRoot: string,
  config: VaultConfig
): Promise<string> {
  if (config.attachmentPath) {
    return config.attachmentPath;
  }

  for (const pattern of ATTACHMENT_PATTERNS) {
    const attachmentFullPath = join(contentRoot, pattern);
    if (await directoryExists(attachmentFullPath)) {
      return pattern;
    }
  }

  return resolveAttachmentPath(config);
}

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

export async function parseVault(
  vaultsDir: string,
  dirName: string
): Promise<VaultInfo | null> {
  const vaultPath = join(vaultsDir, dirName);

  if (!(await directoryExists(vaultPath))) {
    return null;
  }

  const claudeMdPath = join(vaultPath, "CLAUDE.md");
  const hasClaudeMd = await fileExists(claudeMdPath);

  if (!hasClaudeMd) {
    return null;
  }

  const config = await loadVaultConfig(vaultPath);
  const contentRoot = resolveContentRoot(vaultPath, config);

  let name = dirName;
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

  if (config.title) {
    name = config.title;
  }
  if (config.subtitle !== undefined) {
    subtitle = config.subtitle || undefined;
  }

  const inboxPath = config.inboxPath ?? (await detectInboxPath(contentRoot));
  const metadataPath = resolveMetadataPath(config);
  const goalsPath = await detectGoalsPath(contentRoot, config);
  const attachmentPath = await detectAttachmentPath(contentRoot, config);

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

export async function discoverVaults(): Promise<VaultInfo[]> {
  log.info("Discovering vaults...");
  const vaultsDir = getVaultsDir();

  const created = await ensureVaultsDir(vaultsDir);
  if (created) {
    log.info(`Created vaults directory: ${vaultsDir}`);
  }

  log.info(`Scanning: ${vaultsDir}`);

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

  const vaults: VaultInfo[] = [];

  for (const entry of entries) {
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
      log.warn(
        `Failed to parse vault "${entry}":`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  vaults.sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.name.localeCompare(b.name);
  });

  log.info(`Discovery complete: ${vaults.length} vault(s) found`);
  return vaults;
}

export async function getVaultById(vaultId: string): Promise<VaultInfo | null> {
  log.info(`Looking up vault: ${vaultId}`);
  const vaultsDir = getVaultsDir();

  await ensureVaultsDir(vaultsDir);

  const vault = await parseVault(vaultsDir, vaultId);
  if (vault) {
    log.info(`Vault found: ${vault.name} at ${vault.path}`);
  } else {
    log.warn(`Vault not found: ${vaultId}`);
  }
  return vault;
}

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

export async function getUniqueDirectoryName(
  vaultsDir: string,
  baseName: string
): Promise<string> {
  if (!(await directoryExists(join(vaultsDir, baseName)))) {
    return baseName;
  }

  let counter = 2;
  while (counter < 100) {
    const candidate = `${baseName}-${counter}`;
    if (!(await directoryExists(join(vaultsDir, candidate)))) {
      return candidate;
    }
    counter++;
  }

  return `${baseName}-${Date.now()}`;
}

export class VaultCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultCreationError";
  }
}

export async function createVault(title: string): Promise<VaultInfo> {
  log.info(`Creating new vault: "${title}"`);

  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0) {
    throw new VaultCreationError("Vault title cannot be empty");
  }

  const baseName = titleToDirectoryName(trimmedTitle);
  if (baseName.length === 0) {
    throw new VaultCreationError(
      "Vault title must contain at least one alphanumeric character"
    );
  }

  const vaultsDir = getVaultsDir();
  await ensureVaultsDir(vaultsDir);

  const dirName = await getUniqueDirectoryName(vaultsDir, baseName);
  const vaultPath = join(vaultsDir, dirName);

  log.info(`Creating vault directory: ${vaultPath}`);

  try {
    await mkdir(vaultPath, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new VaultCreationError(`Failed to create vault directory: ${message}`);
  }

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

  const vault = await parseVault(vaultsDir, dirName);
  if (!vault) {
    throw new VaultCreationError("Failed to parse newly created vault");
  }

  log.info(`Vault created successfully: ${vault.id} (${vault.name})`);
  return vault;
}

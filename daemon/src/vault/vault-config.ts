import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type {
  SlashCommand,
  Badge,
  BadgeColor,
  EditableVaultConfig,
  VaultConfig,
  SaveConfigResult,
} from "@memory-loop/shared";
import {
  createLogger,
  CONFIG_FILE_NAME,
  SLASH_COMMANDS_FILE,
  VALID_BADGE_COLORS,
} from "@memory-loop/shared";
import { fileExists } from "@memory-loop/shared/server";

const log = createLogger("VaultConfig");

export type { SaveConfigResult };

/**
 * Reads a JSON file and returns its parsed object form. Returns an empty object
 * if the file is missing, unreadable, or doesn't parse to a plain object.
 */
async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  if (!(await fileExists(path))) {
    return {};
  }
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to empty object below.
  }
  return {};
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && value > 0;
}

function isBadge(value: unknown): value is Badge {
  if (typeof value !== "object" || value === null) return false;
  const badge = value as Record<string, unknown>;
  return (
    typeof badge.text === "string" &&
    badge.text !== "" &&
    typeof badge.color === "string" &&
    VALID_BADGE_COLORS.includes(badge.color as BadgeColor)
  );
}

export async function loadVaultConfig(vaultPath: string): Promise<VaultConfig> {
  const configPath = join(vaultPath, CONFIG_FILE_NAME);

  if (!(await fileExists(configPath))) {
    return {};
  }

  let obj: Record<string, unknown>;
  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      log.warn(`Invalid config format in ${configPath}: expected object`);
      return {};
    }
    obj = parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to load config from ${configPath}: ${message}`);
    return {};
  }

  const config: VaultConfig = {};

  const stringFields = [
    "title",
    "subtitle",
    "contentRoot",
    "inboxPath",
    "metadataPath",
    "projectPath",
    "areaPath",
    "attachmentPath",
    "discussionModel",
  ] as const;
  for (const field of stringFields) {
    if (typeof obj[field] === "string") {
      (config as Record<string, unknown>)[field] = obj[field];
    }
  }

  const positiveIntFields = [
    "promptsPerGeneration",
    "maxPoolSize",
    "quotesPerWeek",
    "recentCaptures",
    "recentDiscussions",
  ] as const;
  for (const field of positiveIntFields) {
    const value = obj[field];
    if (isPositiveInt(value)) {
      (config as Record<string, number>)[field] = Math.floor(value);
    }
  }

  if (typeof obj.order === "number" && Number.isFinite(obj.order)) {
    config.order = obj.order;
  }
  if (typeof obj.cardsEnabled === "boolean") config.cardsEnabled = obj.cardsEnabled;
  if (typeof obj.viMode === "boolean") config.viMode = obj.viMode;

  if (Array.isArray(obj.badges)) {
    config.badges = obj.badges.filter(isBadge);
  }

  if (Array.isArray(obj.pinnedAssets)) {
    config.pinnedAssets = obj.pinnedAssets.filter(
      (path): path is string => typeof path === "string" && path.length > 0
    );
  }

  return config;
}

function isAllDefaults(config: EditableVaultConfig): boolean {
  return (
    config.title === undefined &&
    config.subtitle === undefined &&
    config.discussionModel === undefined &&
    config.promptsPerGeneration === undefined &&
    config.maxPoolSize === undefined &&
    config.quotesPerWeek === undefined &&
    config.recentCaptures === undefined &&
    config.recentDiscussions === undefined &&
    (config.badges === undefined || config.badges.length === 0) &&
    config.order === undefined &&
    config.cardsEnabled === undefined &&
    config.viMode === undefined
  );
}

export async function saveVaultConfig(
  vaultPath: string,
  editableConfig: EditableVaultConfig
): Promise<SaveConfigResult> {
  const configPath = join(vaultPath, CONFIG_FILE_NAME);

  try {
    const configExists = await fileExists(configPath);

    if (!configExists && isAllDefaults(editableConfig)) {
      log.debug("Skipping config save: file doesn't exist and all values are defaults");
      return { success: true };
    }

    const mergedConfig: Record<string, unknown> = configExists
      ? await readJsonObject(configPath)
      : {};

    // Copy every defined field from the editable config onto the merged config.
    // Undefined fields are skipped so existing values survive partial updates.
    for (const [key, value] of Object.entries(editableConfig)) {
      if (value !== undefined) {
        mergedConfig[key] = value;
      }
    }

    await writeJsonFile(configPath, mergedConfig);
    log.info(`Saved vault config to ${configPath}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to save vault config to ${configPath}: ${message}`);
    return { success: false, error: message };
  }
}

export async function savePinnedAssets(vaultPath: string, paths: string[]): Promise<void> {
  const configPath = join(vaultPath, CONFIG_FILE_NAME);
  const existingConfig = await readJsonObject(configPath);
  existingConfig.pinnedAssets = paths;
  await writeJsonFile(configPath, existingConfig);
  log.info(`Saved ${paths.length} pinned assets to ${configPath}`);
}

export async function loadSlashCommands(
  vaultPath: string
): Promise<SlashCommand[] | undefined> {
  const cachePath = join(vaultPath, SLASH_COMMANDS_FILE);

  if (!(await fileExists(cachePath))) {
    return undefined;
  }

  try {
    const content = await readFile(cachePath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    if (!Array.isArray(parsed)) {
      log.warn(`Invalid slash commands cache format in ${cachePath}: expected array`);
      return undefined;
    }

    return parsed
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
        ...(typeof cmd.argumentHint === "string" && cmd.argumentHint
          ? { argumentHint: cmd.argumentHint }
          : {}),
      }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to load slash commands cache from ${cachePath}: ${message}`);
    return undefined;
  }
}

export async function saveSlashCommands(
  vaultPath: string,
  commands: SlashCommand[]
): Promise<void> {
  const cachePath = join(vaultPath, SLASH_COMMANDS_FILE);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeJsonFile(cachePath, commands);
  log.info(`Cached ${commands.length} slash commands to ${cachePath}`);
}

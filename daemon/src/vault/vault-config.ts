/**
 * Vault Configuration I/O (Daemon)
 *
 * Filesystem operations for loading and saving vault configuration.
 * Types and resolver functions are in @memory-loop/shared.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { SlashCommand, Badge, BadgeColor, EditableVaultConfig, VaultConfig } from "@memory-loop/shared";
import {
  createLogger,
  CONFIG_FILE_NAME,
  SLASH_COMMANDS_FILE,
  VALID_DISCUSSION_MODELS,
  VALID_BADGE_COLORS,
} from "@memory-loop/shared";
import { fileExists } from "@memory-loop/shared/server";

const log = createLogger("VaultConfig");

/**
 * Loads vault configuration from .memory-loop.json if it exists.
 */
export async function loadVaultConfig(vaultPath: string): Promise<VaultConfig> {
  const configPath = join(vaultPath, CONFIG_FILE_NAME);

  if (!(await fileExists(configPath))) {
    return {};
  }

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      log.warn(`Invalid config format in ${configPath}: expected object`);
      return {};
    }

    const config: VaultConfig = {};
    const obj = parsed as Record<string, unknown>;

    if (typeof obj.title === "string") config.title = obj.title;
    if (typeof obj.subtitle === "string") config.subtitle = obj.subtitle;
    if (typeof obj.contentRoot === "string") config.contentRoot = obj.contentRoot;
    if (typeof obj.inboxPath === "string") config.inboxPath = obj.inboxPath;
    if (typeof obj.metadataPath === "string") config.metadataPath = obj.metadataPath;
    if (typeof obj.projectPath === "string") config.projectPath = obj.projectPath;
    if (typeof obj.areaPath === "string") config.areaPath = obj.areaPath;
    if (typeof obj.attachmentPath === "string") config.attachmentPath = obj.attachmentPath;

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

    if (
      typeof obj.discussionModel === "string" &&
      VALID_DISCUSSION_MODELS.includes(obj.discussionModel as typeof VALID_DISCUSSION_MODELS[number])
    ) {
      config.discussionModel = obj.discussionModel;
    }

    if (typeof obj.order === "number" && Number.isFinite(obj.order)) {
      config.order = obj.order;
    }
    if (typeof obj.cardsEnabled === "boolean") config.cardsEnabled = obj.cardsEnabled;
    if (typeof obj.viMode === "boolean") config.viMode = obj.viMode;

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

    if (Array.isArray(obj.pinnedAssets)) {
      config.pinnedAssets = obj.pinnedAssets.filter(
        (path): path is string => typeof path === "string" && path.length > 0
      );
    }

    return config;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to load config from ${configPath}: ${message}`);
    return {};
  }
}

export type SaveConfigResult =
  | { success: true }
  | { success: false; error: string };

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

    let existingConfig: Record<string, unknown> = {};

    if (configExists) {
      try {
        const content = await readFile(configPath, "utf-8");
        const parsed = JSON.parse(content) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          existingConfig = parsed as Record<string, unknown>;
        }
      } catch {
        log.warn(`Could not parse existing config at ${configPath}, will overwrite`);
      }
    }

    const mergedConfig: Record<string, unknown> = { ...existingConfig };

    if (editableConfig.title !== undefined) mergedConfig.title = editableConfig.title;
    if (editableConfig.subtitle !== undefined) mergedConfig.subtitle = editableConfig.subtitle;
    if (editableConfig.discussionModel !== undefined) mergedConfig.discussionModel = editableConfig.discussionModel;
    if (editableConfig.promptsPerGeneration !== undefined) mergedConfig.promptsPerGeneration = editableConfig.promptsPerGeneration;
    if (editableConfig.maxPoolSize !== undefined) mergedConfig.maxPoolSize = editableConfig.maxPoolSize;
    if (editableConfig.quotesPerWeek !== undefined) mergedConfig.quotesPerWeek = editableConfig.quotesPerWeek;
    if (editableConfig.recentCaptures !== undefined) mergedConfig.recentCaptures = editableConfig.recentCaptures;
    if (editableConfig.recentDiscussions !== undefined) mergedConfig.recentDiscussions = editableConfig.recentDiscussions;
    if (editableConfig.badges !== undefined) mergedConfig.badges = editableConfig.badges;
    if (editableConfig.order !== undefined) mergedConfig.order = editableConfig.order;
    if (editableConfig.cardsEnabled !== undefined) mergedConfig.cardsEnabled = editableConfig.cardsEnabled;
    if (editableConfig.viMode !== undefined) mergedConfig.viMode = editableConfig.viMode;

    await writeFile(configPath, JSON.stringify(mergedConfig, null, 2) + "\n", "utf-8");

    log.info(`Saved vault config to ${configPath}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to save vault config to ${configPath}: ${message}`);
    return { success: false, error: message };
  }
}

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

  await writeFile(cachePath, JSON.stringify(commands, null, 2) + "\n", "utf-8");
  log.info(`Cached ${commands.length} slash commands to ${cachePath}`);
}

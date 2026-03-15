/**
 * Vault Configuration Types and Resolvers
 *
 * Pure types and derivation functions for vault configuration.
 * No I/O operations. Used by both daemon and nextjs.
 */

import type { Badge, BadgeColor } from "./schemas/types";

/**
 * Per-vault configuration options.
 * All paths are relative to the vault root directory.
 */
export interface VaultConfig {
  title?: string;
  subtitle?: string;
  contentRoot?: string;
  inboxPath?: string;
  metadataPath?: string;
  projectPath?: string;
  areaPath?: string;
  attachmentPath?: string;
  promptsPerGeneration?: number;
  maxPoolSize?: number;
  quotesPerWeek?: number;
  badges?: Badge[];
  pinnedAssets?: string[];
  recentCaptures?: number;
  recentDiscussions?: number;
  discussionModel?: string;
  order?: number;
  cardsEnabled?: boolean;
  viMode?: boolean;
}

// --- Constants ---

export const CONFIG_FILE_NAME = ".memory-loop.json";
export const SLASH_COMMANDS_FILE = ".memory-loop/slash-commands.json";
export const DEFAULT_METADATA_PATH = "06_Metadata/memory-loop";
export const DEFAULT_PROJECT_PATH = "01_Projects";
export const DEFAULT_AREA_PATH = "02_Areas";
export const DEFAULT_ATTACHMENT_PATH = "05_Attachments";
export const DEFAULT_PROMPTS_PER_GENERATION = 5;
export const DEFAULT_MAX_POOL_SIZE = 50;
export const DEFAULT_QUOTES_PER_WEEK = 1;
export const DEFAULT_RECENT_CAPTURES = 5;
export const DEFAULT_RECENT_DISCUSSIONS = 5;
export const VALID_DISCUSSION_MODELS = ["opus", "sonnet", "haiku"] as const;
export type DiscussionModelLocal = (typeof VALID_DISCUSSION_MODELS)[number];
export const DEFAULT_DISCUSSION_MODEL: DiscussionModelLocal = "opus";
export const DEFAULT_ORDER = 999999;
export const DEFAULT_CARDS_ENABLED = true;
export const DEFAULT_VI_MODE = false;

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

// --- Resolver functions ---
// NOTE: resolveContentRoot uses node:path for security (normalize/join).
// It lives in vault-config-server.ts and is exported from @memory-loop/shared/server.

export function resolveMetadataPath(config: VaultConfig): string {
  return config.metadataPath ?? DEFAULT_METADATA_PATH;
}

export function resolveGoalsPath(config: VaultConfig): string {
  return `${resolveMetadataPath(config)}/goals.md`;
}

export function resolveContextualPromptsPath(config: VaultConfig): string {
  return `${resolveMetadataPath(config)}/contextual-prompts.md`;
}

export function resolveGeneralInspirationPath(config: VaultConfig): string {
  return `${resolveMetadataPath(config)}/general-inspiration.md`;
}

export function resolveProjectPath(config: VaultConfig): string {
  return config.projectPath ?? DEFAULT_PROJECT_PATH;
}

export function resolveAreaPath(config: VaultConfig): string {
  return config.areaPath ?? DEFAULT_AREA_PATH;
}

export function resolveAttachmentPath(config: VaultConfig): string {
  return config.attachmentPath ?? DEFAULT_ATTACHMENT_PATH;
}

export function resolvePromptsPerGeneration(config: VaultConfig): number {
  return config.promptsPerGeneration ?? DEFAULT_PROMPTS_PER_GENERATION;
}

export function resolveMaxPoolSize(config: VaultConfig): number {
  return config.maxPoolSize ?? DEFAULT_MAX_POOL_SIZE;
}

export function resolveQuotesPerWeek(config: VaultConfig): number {
  return config.quotesPerWeek ?? DEFAULT_QUOTES_PER_WEEK;
}

export function resolveBadges(config: VaultConfig): Badge[] {
  return config.badges ?? [];
}

export function resolvePinnedAssets(config: VaultConfig): string[] {
  return config.pinnedAssets ?? [];
}

export function resolveRecentCaptures(config: VaultConfig): number {
  return config.recentCaptures ?? DEFAULT_RECENT_CAPTURES;
}

export function resolveRecentDiscussions(config: VaultConfig): number {
  return config.recentDiscussions ?? DEFAULT_RECENT_DISCUSSIONS;
}

export function resolveDiscussionModel(config: VaultConfig): DiscussionModelLocal {
  return (config.discussionModel as DiscussionModelLocal | undefined) ?? DEFAULT_DISCUSSION_MODEL;
}

export function resolveOrder(config: VaultConfig): number {
  return config.order ?? DEFAULT_ORDER;
}

export function resolveCardsEnabled(config: VaultConfig): boolean {
  return config.cardsEnabled ?? DEFAULT_CARDS_ENABLED;
}

export function resolveViMode(config: VaultConfig): boolean {
  return config.viMode ?? DEFAULT_VI_MODE;
}

// --- Utility functions ---

import type { SlashCommand } from "./schemas/protocol";

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

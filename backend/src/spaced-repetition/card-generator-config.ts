/**
 * Card Generator Config
 *
 * Manages configuration for the card generator:
 * - Weekly byte limit for card generation
 * - Requirements prompt override
 *
 * Files:
 * - ~/.config/memory-loop/card-generator-config.json - Config settings
 * - ~/.config/memory-loop/card-generator-requirements.md - Requirements override
 */

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { createLogger } from "../logger.js";
import { fileExists } from "../vault-manager.js";

const log = createLogger("card-generator-config");

// =============================================================================
// Constants
// =============================================================================

/**
 * Config directory name within user home.
 */
const CONFIG_DIR = ".config/memory-loop";

/**
 * Config file name for card generator settings.
 */
const CONFIG_FILE = "card-generator-config.json";

/**
 * Requirements override file name.
 */
const REQUIREMENTS_FILE = "card-generator-requirements.md";

/**
 * Default weekly byte limit (500KB).
 */
export const DEFAULT_WEEKLY_BYTE_LIMIT = 500 * 1024;

/**
 * Default requirements for Q&A extraction.
 * This is the content that can be customized by users.
 */
export const DEFAULT_REQUIREMENTS = `- Generate zero questions rather than questions that don't fully satisfy these requirements
- Focus on key facts, concepts, definitions, and relationships
- Questions must be self-contained and answerable without seeing the source
- Never use "this", "the above", or assume the reader knows or has access to the context
- Questions must have a unique, unambiguous answer that doesn't depend on when the note was written
- Avoid questions like "What did X implement?" or "What was decided?" that could have many valid answers
- Include enough specifics in the question to uniquely identify what's being asked (project name, feature name, date, version)
- Answers should be concise but complete (the actual answer must be in the content)
- Skip Q&A pairs where the answer would be vague, incomplete, or "not provided"
- If the content mentions something but doesn't explain it, don't make a card about it
- Each question should test a distinct piece of knowledge - avoid variations that ask the same thing differently
- Skip subjective opinions, TODOs, or transient information
- Questions must be answerable by anyone - avoid self-referential framing, first/second person pronouns ("you", "we", "I", "my", "our"), and author references
- Only extract facts that would be useful to recall weeks or months later
- If the content has no extractable facts, return an empty array`;

// =============================================================================
// Schema
// =============================================================================

/**
 * Schema for card generator config.
 */
const CardGeneratorConfigSchema = z.object({
  /** Weekly byte limit for card generation (100KB - 10MB) */
  weeklyByteLimit: z.number().int().min(102400).max(10485760).default(DEFAULT_WEEKLY_BYTE_LIMIT),
});

// =============================================================================
// Types
// =============================================================================

export type CardGeneratorConfig = z.infer<typeof CardGeneratorConfigSchema>;

/**
 * Info about the loaded requirements.
 */
export interface RequirementsInfo {
  /** The requirements content */
  content: string;
  /** Whether this is a user override */
  isOverride: boolean;
}

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Get the config directory path.
 */
function getConfigDir(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, CONFIG_DIR);
}

/**
 * Get the absolute path to the config file.
 */
export function getConfigFilePath(): string {
  return join(getConfigDir(), CONFIG_FILE);
}

/**
 * Get the absolute path to the requirements override file.
 */
export function getRequirementsFilePath(): string {
  return join(getConfigDir(), REQUIREMENTS_FILE);
}

// =============================================================================
// Config File Operations
// =============================================================================

/**
 * Load the card generator config from disk.
 * Returns default config if file doesn't exist.
 *
 * @returns Current config
 */
export async function loadCardGeneratorConfig(): Promise<CardGeneratorConfig> {
  const configPath = getConfigFilePath();

  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      log.debug("Config file not found, returning defaults");
      return { weeklyByteLimit: DEFAULT_WEEKLY_BYTE_LIMIT };
    }
    log.error(`Failed to read config file: ${(e as Error).message}`);
    throw e;
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    log.warn(`Invalid JSON in config file at ${configPath}, returning defaults`);
    return { weeklyByteLimit: DEFAULT_WEEKLY_BYTE_LIMIT };
  }

  // Validate against schema
  const result = CardGeneratorConfigSchema.safeParse(parsed);
  if (!result.success) {
    log.warn(
      `Invalid config schema at ${configPath}, returning defaults`,
      result.error.issues
    );
    return { weeklyByteLimit: DEFAULT_WEEKLY_BYTE_LIMIT };
  }

  return result.data;
}

/**
 * Save the card generator config to disk.
 *
 * @param config - Config to save
 */
export async function saveCardGeneratorConfig(config: CardGeneratorConfig): Promise<void> {
  const configPath = getConfigFilePath();
  const dir = dirname(configPath);

  // Ensure config directory exists
  await mkdir(dir, { recursive: true });

  // Serialize config to JSON with pretty formatting
  const content = JSON.stringify(config, null, 2);

  // Write config file
  await writeFile(configPath, content, "utf-8");

  log.debug(`Wrote card generator config to ${configPath}`);
}

// =============================================================================
// Requirements File Operations
// =============================================================================

/**
 * Get the default requirements content.
 */
export function getDefaultRequirements(): string {
  return DEFAULT_REQUIREMENTS;
}

/**
 * Check if a user requirements override exists.
 */
export async function hasRequirementsOverride(): Promise<boolean> {
  return fileExists(getRequirementsFilePath());
}

/**
 * Load the requirements, preferring user override if it exists.
 *
 * @returns RequirementsInfo with content and metadata
 */
export async function loadRequirements(): Promise<RequirementsInfo> {
  const overridePath = getRequirementsFilePath();

  // Check for user override first
  if (await hasRequirementsOverride()) {
    try {
      const content = await readFile(overridePath, "utf-8");
      log.debug(`Loaded user requirements override from ${overridePath}`);
      return {
        content,
        isOverride: true,
      };
    } catch (error) {
      log.warn(`Failed to read user requirements override: ${(error as Error).message}`);
      // Fall through to default
    }
  }

  // Return default requirements
  log.debug("No user override, using default requirements");
  return {
    content: DEFAULT_REQUIREMENTS,
    isOverride: false,
  };
}

/**
 * Save requirements override to user config.
 *
 * @param content - Requirements content to save
 */
export async function saveRequirementsOverride(content: string): Promise<void> {
  const overridePath = getRequirementsFilePath();
  const dir = dirname(overridePath);

  // Ensure config directory exists
  await mkdir(dir, { recursive: true });

  // Write requirements file
  await writeFile(overridePath, content, "utf-8");

  log.info(`Saved requirements override to ${overridePath}`);
}

/**
 * Delete the requirements override, restoring defaults.
 */
export async function deleteRequirementsOverride(): Promise<void> {
  const overridePath = getRequirementsFilePath();

  try {
    await unlink(overridePath);
    log.info(`Deleted requirements override at ${overridePath}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
    log.debug("No requirements override to delete");
  }
}

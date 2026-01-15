/**
 * Pipeline Configuration Loader
 *
 * Loads and validates pipeline configurations and secrets from the vault's
 * .memory-loop directory.
 *
 * Spec Requirements:
 * - REQ-F-1: Load pipeline config from `.memory-loop/sync/*.yaml`
 * - REQ-F-20: API secrets stored in `.memory-loop/secrets/*.yaml`
 * - REQ-F-21: Secrets file format: key-value pairs
 * - REQ-F-27: Secrets never logged (use non-enumerable proxy)
 *
 * Plan Reference:
 * - TD-6: Configuration Loading design
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename, relative, normalize } from "node:path";
import yaml from "js-yaml";
import {
  PipelineConfigSchema,
  SecretsConfigSchema,
  type PipelineConfig,
  type SecretsConfig,
} from "./schemas.js";
import { createLogger } from "../logger.js";

const log = createLogger("config-loader");

// =============================================================================
// Types
// =============================================================================

/**
 * Result of loading all pipeline configurations.
 */
export interface LoadedPipelines {
  /** Successfully loaded and validated pipeline configs */
  pipelines: PipelineConfig[];
  /** Names of configs that failed validation (for reporting) */
  failed: string[];
}

/**
 * Secrets wrapper that prevents logging of secret values.
 */
export type ProtectedSecrets = {
  /** Get a secret value by key */
  get(key: string): string | undefined;
  /** Check if a secret exists */
  has(key: string): boolean;
  /** Get all available secret keys (values are protected) */
  keys(): string[];
};

// =============================================================================
// Path Validation
// =============================================================================

/**
 * Validate that a path is within the allowed root directory.
 * Prevents path traversal attacks.
 */
function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = normalize(targetPath);
  const normalizedRoot = normalize(rootPath);
  const relativePath = relative(normalizedRoot, normalizedTarget);

  // Path traversal if relative path starts with .. or is absolute
  return !relativePath.startsWith("..") && !relativePath.startsWith("/");
}

// =============================================================================
// Secrets Protection
// =============================================================================

/**
 * Create a protected secrets wrapper that prevents accidental logging.
 *
 * Uses non-enumerable properties and custom toJSON to ensure
 * secrets don't appear in logs or JSON serialization.
 */
function createProtectedSecrets(secrets: SecretsConfig): ProtectedSecrets {
  const secretMap = new Map(Object.entries(secrets));

  const wrapper: ProtectedSecrets = {
    get(key: string): string | undefined {
      return secretMap.get(key);
    },

    has(key: string): boolean {
      return secretMap.has(key);
    },

    keys(): string[] {
      return Array.from(secretMap.keys());
    },
  };

  // Override toString to prevent accidental logging
  Object.defineProperty(wrapper, "toString", {
    value: () => "[ProtectedSecrets]",
    enumerable: false,
  });

  // Override toJSON to prevent JSON serialization
  Object.defineProperty(wrapper, "toJSON", {
    value: () => ({ type: "ProtectedSecrets", keys: wrapper.keys() }),
    enumerable: false,
  });

  return wrapper;
}

// =============================================================================
// Configuration Loading
// =============================================================================

/**
 * Load all pipeline configurations from a vault's sync directory.
 *
 * @param vaultRoot - Root path of the vault
 * @returns Loaded pipelines and list of failed config names
 */
export async function loadPipelineConfigs(vaultRoot: string): Promise<LoadedPipelines> {
  const syncDir = join(vaultRoot, ".memory-loop", "sync");
  const pipelines: PipelineConfig[] = [];
  const failed: string[] = [];

  // Try to read the sync directory
  let files: string[];
  try {
    const entries = await readdir(syncDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
      .map((e) => e.name);
  } catch (error) {
    // Directory doesn't exist - no pipelines configured
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      log.debug(`No sync directory found at ${syncDir}`);
      return { pipelines: [], failed: [] };
    }
    throw error;
  }

  if (files.length === 0) {
    log.debug("No pipeline configuration files found");
    return { pipelines: [], failed: [] };
  }

  // Load and validate each config
  for (const filename of files) {
    const filePath = join(syncDir, filename);
    const configName = basename(filename, filename.endsWith(".yaml") ? ".yaml" : ".yml");

    // Validate path is within vault
    if (!isPathWithinRoot(filePath, vaultRoot)) {
      log.warn(`Path traversal attempt detected: ${filename}`);
      failed.push(configName);
      continue;
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = yaml.load(content);
      const config = PipelineConfigSchema.parse(parsed);
      pipelines.push(config);
      log.info(`Loaded pipeline config: ${config.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Failed to load pipeline config ${configName}: ${message}`);
      failed.push(configName);
    }
  }

  return { pipelines, failed };
}

/**
 * Load secrets from a vault's secrets directory.
 *
 * @param vaultRoot - Root path of the vault
 * @returns Protected secrets wrapper
 */
export async function loadSecrets(vaultRoot: string): Promise<ProtectedSecrets> {
  const secretsDir = join(vaultRoot, ".memory-loop", "secrets");
  const allSecrets: Record<string, string> = {};

  // Try to read the secrets directory
  let files: string[];
  try {
    const entries = await readdir(secretsDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
      .map((e) => e.name);
  } catch (error) {
    // Directory doesn't exist - no secrets configured
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      log.debug(`No secrets directory found at ${secretsDir}`);
      return createProtectedSecrets({});
    }
    throw error;
  }

  // Load and merge all secret files
  for (const filename of files) {
    const filePath = join(secretsDir, filename);

    // Validate path is within vault
    if (!isPathWithinRoot(filePath, vaultRoot)) {
      log.warn(`Path traversal attempt in secrets: ${filename}`);
      continue;
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = yaml.load(content);
      const secrets = SecretsConfigSchema.parse(parsed);

      // Merge secrets (later files override earlier ones)
      Object.assign(allSecrets, secrets);
      log.debug(`Loaded secrets from ${filename} (${Object.keys(secrets).length} keys)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Failed to load secrets from ${filename}: ${message}`);
    }
  }

  return createProtectedSecrets(allSecrets);
}

/**
 * Load both pipeline configs and secrets from a vault.
 *
 * @param vaultRoot - Root path of the vault
 * @returns Tuple of [pipelines result, protected secrets]
 */
export async function loadAllConfigs(
  vaultRoot: string
): Promise<[LoadedPipelines, ProtectedSecrets]> {
  const [pipelines, secrets] = await Promise.all([
    loadPipelineConfigs(vaultRoot),
    loadSecrets(vaultRoot),
  ]);

  return [pipelines, secrets];
}

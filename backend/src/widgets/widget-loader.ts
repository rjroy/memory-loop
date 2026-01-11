/**
 * Widget Loader
 *
 * Discovers and validates widget configuration files from vault directories.
 * Widget configs are YAML files in `.memory-loop/widgets/` within each vault.
 *
 * Spec Requirements:
 * - REQ-F-1: Vaults define widgets in `.memory-loop/widgets/*.yaml` files
 * - REQ-F-2: Server discovers and validates widget configs when vault connects
 * - REQ-F-3: Invalid configs produce actionable error messages, not silent failures
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { createLogger } from "../logger";
import { directoryExists } from "../vault-manager";
import {
  parseWidgetConfig,
  formatValidationError,
  safeParseWidgetConfig,
  type WidgetConfig,
} from "./schemas";
import { ZodError } from "zod";

const log = createLogger("Widget");

/**
 * Directory path for widget configurations within a vault.
 */
export const WIDGETS_DIR = ".memory-loop/widgets";

/**
 * Supported file extensions for widget configurations.
 */
export const WIDGET_FILE_EXTENSIONS = [".yaml", ".yml"];

/**
 * Result of loading a single widget configuration.
 * Contains either the validated config or an error message.
 */
export interface WidgetLoadResult {
  /** Widget ID derived from filename (without extension) */
  id: string;

  /** Relative file path from vault root */
  filePath: string;

  /** Validated widget configuration (present on success) */
  config?: WidgetConfig;

  /** Error message (present on failure) */
  error?: string;
}

/**
 * Result of loading all widget configurations from a vault.
 */
export interface WidgetLoaderResult {
  /** Successfully loaded widgets */
  widgets: Array<{ id: string; filePath: string; config: WidgetConfig }>;

  /** Widgets that failed to load */
  errors: Array<{ id: string; filePath: string; error: string }>;

  /** True if the widgets directory exists */
  hasWidgetsDir: boolean;
}

/**
 * Checks if a filename has a supported widget file extension.
 */
function isWidgetFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return WIDGET_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Extracts the widget ID from a filename by removing the extension.
 */
function getWidgetId(filename: string): string {
  const lower = filename.toLowerCase();
  for (const ext of WIDGET_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return filename.slice(0, -ext.length);
    }
  }
  return filename;
}

/**
 * Loads and validates a single widget configuration file.
 *
 * @param widgetsDir - Absolute path to the widgets directory
 * @param filename - Name of the widget file (e.g., "collection-stats.yaml")
 * @returns Load result with either config or error
 */
export async function loadWidgetFile(
  widgetsDir: string,
  filename: string
): Promise<WidgetLoadResult> {
  const id = getWidgetId(filename);
  const filePath = join(WIDGETS_DIR, filename);
  const absolutePath = join(widgetsDir, filename);

  try {
    // Read the file content
    const content = await readFile(absolutePath, "utf-8");

    // Parse YAML
    let parsed: unknown;
    try {
      parsed = yaml.load(content);
    } catch (yamlError) {
      const message =
        yamlError instanceof Error ? yamlError.message : String(yamlError);
      log.warn(`YAML parse error in ${filePath}: ${message}`);
      return {
        id,
        filePath,
        error: `YAML parse error: ${message}`,
      };
    }

    // Handle empty files
    if (parsed === null || parsed === undefined) {
      log.warn(`Empty widget config: ${filePath}`);
      return {
        id,
        filePath,
        error: "Widget config file is empty",
      };
    }

    // Validate against schema
    const result = safeParseWidgetConfig(parsed);
    if (!result.success) {
      const errorMessage = formatValidationError(result.error, filePath);
      log.warn(`Validation error in ${filePath}:\n${errorMessage}`);
      return {
        id,
        filePath,
        error: errorMessage,
      };
    }

    log.debug(`Loaded widget: ${id} from ${filePath}`);
    return {
      id,
      filePath,
      config: result.data,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to load widget ${filePath}: ${message}`);
    return {
      id,
      filePath,
      error: `Failed to read file: ${message}`,
    };
  }
}

/**
 * Discovers and loads all widget configurations from a vault.
 *
 * This function:
 * 1. Checks if `.memory-loop/widgets/` directory exists
 * 2. Lists all YAML files in that directory
 * 3. Parses and validates each file
 * 4. Returns successful configs and any errors encountered
 *
 * Zero matches are logged as info, not error (per acceptance criteria).
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @returns Loader result with widgets and any errors
 */
export async function loadWidgetConfigs(vaultPath: string): Promise<WidgetLoaderResult> {
  const widgetsDir = join(vaultPath, WIDGETS_DIR);

  // Check if widgets directory exists
  const dirExists = await directoryExists(widgetsDir);
  if (!dirExists) {
    log.info(`No widgets directory found at ${widgetsDir}`);
    return {
      widgets: [],
      errors: [],
      hasWidgetsDir: false,
    };
  }

  // List files in the widgets directory
  let entries: string[];
  try {
    entries = await readdir(widgetsDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to read widgets directory: ${message}`);
    return {
      widgets: [],
      errors: [
        {
          id: "",
          filePath: WIDGETS_DIR,
          error: `Failed to read widgets directory: ${message}`,
        },
      ],
      hasWidgetsDir: true,
    };
  }

  // Filter to only YAML files
  const widgetFiles = entries.filter(isWidgetFile);

  if (widgetFiles.length === 0) {
    log.info(`Widgets directory exists but contains no YAML files: ${widgetsDir}`);
    return {
      widgets: [],
      errors: [],
      hasWidgetsDir: true,
    };
  }

  log.info(`Found ${widgetFiles.length} widget config(s) in ${vaultPath}`);

  // Load each widget file
  const results = await Promise.all(
    widgetFiles.map((filename) => loadWidgetFile(widgetsDir, filename))
  );

  // Separate successful loads from errors
  const widgets: WidgetLoaderResult["widgets"] = [];
  const errors: WidgetLoaderResult["errors"] = [];

  for (const result of results) {
    if (result.config) {
      widgets.push({
        id: result.id,
        filePath: result.filePath,
        config: result.config,
      });
    } else if (result.error) {
      errors.push({
        id: result.id,
        filePath: result.filePath,
        error: result.error,
      });
    }
  }

  if (errors.length > 0) {
    log.warn(`${errors.length} widget config(s) failed validation`);
  }

  log.info(`Successfully loaded ${widgets.length} widget(s)`);

  return {
    widgets,
    errors,
    hasWidgetsDir: true,
  };
}

/**
 * Validates a widget configuration object without loading from file.
 * Useful for testing and programmatic config creation.
 *
 * @param config - Raw configuration object to validate
 * @returns Validated config or throws with actionable error
 */
export function validateWidgetConfig(config: unknown): WidgetConfig {
  try {
    return parseWidgetConfig(config);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatValidationError(error));
    }
    throw error;
  }
}

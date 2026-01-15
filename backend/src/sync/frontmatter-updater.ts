/**
 * Frontmatter Updater
 *
 * Updates frontmatter in markdown files with synced data.
 * Supports merge strategies and atomic writes.
 *
 * Spec Requirements:
 * - REQ-F-5: Per-field merge strategy (overwrite, preserve, merge)
 * - REQ-F-7: Support nested namespace or direct fields
 * - REQ-F-18: Track last sync timestamp in `_sync_meta`
 * - REQ-F-29: Normalization failures preserve original value
 *
 * Plan Reference:
 * - TD-4: Frontmatter Update Strategy
 */

import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { set, get, isEqual, uniq } from "lodash-es";
import type { MergeStrategy, SyncMeta, FieldMapping, DefaultsConfig } from "./schemas.js";
import { createLogger } from "../logger.js";

const log = createLogger("frontmatter-updater");

// =============================================================================
// Types
// =============================================================================

/**
 * A field update to apply to frontmatter.
 */
export interface FieldUpdate {
  /** Target field path (dot-notation, e.g., "bgg.rating") */
  target: string;
  /** Value to set */
  value: unknown;
  /** Merge strategy to use */
  strategy: MergeStrategy;
}

/**
 * Options for updating a file's frontmatter.
 */
export interface UpdateOptions {
  /** File path to update */
  filePath: string;
  /** Field updates to apply */
  updates: FieldUpdate[];
  /** Sync metadata to write */
  syncMeta: SyncMeta;
  /** Default merge strategy (used if not specified per-field) */
  defaultStrategy?: MergeStrategy;
  /** Namespace prefix for fields (e.g., "bgg" -> "bgg.rating") */
  namespace?: string;
}

/**
 * Result of an update operation.
 */
export interface UpdateResult {
  /** Whether the file was modified */
  modified: boolean;
  /** Fields that were changed */
  changedFields: string[];
  /** Fields that were preserved (not changed due to strategy) */
  preservedFields: string[];
}

// =============================================================================
// Merge Strategy Implementation
// =============================================================================

/**
 * Apply a merge strategy to combine existing and new values.
 *
 * @param existing - Current value in frontmatter (may be undefined)
 * @param newValue - New value from sync
 * @param strategy - Merge strategy to apply
 * @returns The merged result
 */
export function applyMergeStrategy(
  existing: unknown,
  newValue: unknown,
  strategy: MergeStrategy
): { value: unknown; wasPreserved: boolean } {
  switch (strategy) {
    case "overwrite":
      return { value: newValue, wasPreserved: false };

    case "preserve":
      if (existing !== undefined && existing !== null) {
        return { value: existing, wasPreserved: true };
      }
      return { value: newValue, wasPreserved: false };

    case "merge": {
      // For arrays, combine without duplicates
      if (Array.isArray(existing) && Array.isArray(newValue)) {
        const existingArr = existing as unknown[];
        const newArr = newValue as unknown[];
        const merged = uniq([...existingArr, ...newArr]);
        // Check if anything actually changed
        const wasPreserved = isEqual(merged, existing);
        return { value: merged, wasPreserved };
      }
      // For non-arrays, merge behaves like overwrite
      return { value: newValue, wasPreserved: false };
    }

    default: {
      // Exhaustive check
      const _exhaustive: never = strategy;
      throw new Error(`Unknown merge strategy: ${String(_exhaustive)}`);
    }
  }
}

// =============================================================================
// Frontmatter Updater Class
// =============================================================================

/**
 * Service for updating frontmatter in markdown files.
 *
 * Supports:
 * - Reading and parsing existing frontmatter
 * - Applying merge strategies per-field
 * - Writing to namespaced or direct fields
 * - Atomic writes via temp file + rename
 * - Sync metadata tracking
 */
export class FrontmatterUpdater {
  /**
   * Update a file's frontmatter with synced data.
   *
   * @param options - Update options
   * @returns Update result with changed/preserved field info
   */
  async update(options: UpdateOptions): Promise<UpdateResult> {
    const { filePath, updates, syncMeta, namespace } = options;

    // Read existing file
    const content = await readFile(filePath, "utf-8");
    const parsed = matter(content);
    const data = parsed.data as Record<string, unknown>;

    const changedFields: string[] = [];
    const preservedFields: string[] = [];

    // Apply each field update
    for (const update of updates) {
      // Apply namespace prefix if configured
      const targetPath = namespace ? `${namespace}.${update.target}` : update.target;
      const existing = get(data, targetPath);
      const { value, wasPreserved } = applyMergeStrategy(
        existing,
        update.value,
        update.strategy
      );

      if (wasPreserved) {
        preservedFields.push(targetPath);
      } else {
        // Only mark as changed if value is actually different
        if (!isEqual(existing, value)) {
          set(data, targetPath, value);
          changedFields.push(targetPath);
        }
      }
    }

    // Update sync metadata
    const existingMeta = get(data, "_sync_meta") as Record<string, unknown> | undefined;
    const metaChanged = !existingMeta || !isEqual(existingMeta, syncMeta);
    if (metaChanged) {
      set(data, "_sync_meta", syncMeta);
    }

    // Check if anything changed
    if (changedFields.length === 0 && !metaChanged) {
      log.debug(`No changes needed for ${filePath}`);
      return { modified: false, changedFields, preservedFields };
    }

    // Write back with atomic operation
    const newContent = matter.stringify(parsed.content, data);
    await this.atomicWrite(filePath, newContent);

    log.info(`Updated ${filePath}`, {
      changed: changedFields.length,
      preserved: preservedFields.length,
    });

    return { modified: true, changedFields, preservedFields };
  }

  /**
   * Create field updates from API data and field mappings.
   *
   * @param apiData - Data from API connector
   * @param fields - Field mapping configuration
   * @param defaults - Default configuration (strategy, namespace)
   * @returns Array of field updates ready to apply
   */
  createFieldUpdates(
    apiData: Record<string, unknown>,
    fields: FieldMapping[],
    defaults?: DefaultsConfig
  ): FieldUpdate[] {
    const defaultStrategy = defaults?.merge_strategy ?? "overwrite";
    const updates: FieldUpdate[] = [];

    for (const field of fields) {
      const value = get(apiData, field.source);

      // Skip undefined values (field not in API response)
      if (value === undefined) {
        log.debug(`Skipping field ${field.source}: not in API response`);
        continue;
      }

      updates.push({
        target: field.target,
        value,
        strategy: field.strategy ?? defaultStrategy,
      });
    }

    return updates;
  }

  /**
   * Write content to file atomically using temp file + rename.
   *
   * This prevents partial writes if the process is interrupted.
   */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    const tempPath = join(dir, `.${Date.now()}.tmp`);

    try {
      // Write to temp file
      await writeFile(tempPath, content, "utf-8");
      // Atomic rename
      await rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file on error
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new FrontmatterUpdater instance.
 */
export function createFrontmatterUpdater(): FrontmatterUpdater {
  return new FrontmatterUpdater();
}

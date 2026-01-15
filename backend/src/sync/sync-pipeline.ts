/**
 * Sync Pipeline Manager
 *
 * Orchestrates the sync process for external data integration.
 * Coordinates config loading, file matching, API fetching, normalization,
 * and frontmatter updates.
 *
 * Spec Requirements:
 * - REQ-F-1: Load pipeline config from `.memory-loop/sync/*.yaml`
 * - REQ-F-2: Match files via glob pattern
 * - REQ-F-3: Extract external ID from frontmatter field
 * - REQ-F-4: Fetch data from external API (BGG initially)
 * - REQ-F-5: Apply merge strategies per-field
 * - REQ-F-13: LLM normalization for vocabulary fields
 * - REQ-F-18: Track sync timestamp in `_sync_meta`
 * - REQ-F-19: Support full and incremental sync modes
 * - REQ-F-29: Graceful error handling with continuation
 *
 * Plan Reference:
 * - TD-1: Sync Pipeline Architecture
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import picomatch from "picomatch";
import matter from "gray-matter";
import { get } from "lodash-es";

import { createLogger } from "../logger.js";
import { loadPipelineConfigs, loadSecrets, type ProtectedSecrets } from "./config-loader.js";
import { createApiResponseCache, type ApiResponseCache } from "./api-response-cache.js";
import { getConnector, type ApiConnector } from "./connector-interface.js";
import { createVocabularyNormalizer, type VocabularyNormalizer } from "./vocabulary-normalizer.js";
import { createFrontmatterUpdater, type FrontmatterUpdater } from "./frontmatter-updater.js";
import type { PipelineConfig, SyncMeta, FieldMapping } from "./schemas.js";

const log = createLogger("sync-pipeline");

// =============================================================================
// Types
// =============================================================================

/**
 * Sync mode: full clears cache and syncs all files,
 * incremental skips recently synced files.
 */
export type SyncMode = "full" | "incremental";

/**
 * Status of the sync operation.
 */
export type SyncStatus = "idle" | "syncing" | "success" | "error";

/**
 * Progress callback for reporting sync status to UI.
 */
export interface SyncProgress {
  status: SyncStatus;
  currentFile?: string;
  current: number;
  total: number;
  errors: SyncError[];
}

/**
 * Error that occurred during sync.
 */
export interface SyncError {
  file: string;
  pipeline: string;
  message: string;
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  status: SyncStatus;
  filesProcessed: number;
  filesUpdated: number;
  errors: SyncError[];
  duration: number;
}

/**
 * Callback for progress updates.
 */
export type ProgressCallback = (progress: SyncProgress) => void;

/**
 * Options for sync execution.
 */
export interface SyncOptions {
  /** Vault root directory */
  vaultRoot: string;
  /** Sync mode */
  mode: SyncMode;
  /** Optional pipeline name to sync (if not provided, syncs all) */
  pipeline?: string;
  /** Progress callback */
  onProgress?: ProgressCallback;
  /** Threshold in hours for incremental sync (default: 24) */
  incrementalThresholdHours?: number;
}

// =============================================================================
// File Discovery
// =============================================================================

/**
 * Discover all markdown files in a vault.
 */
async function discoverFiles(vaultRoot: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip hidden directories and .memory-loop
      if (entry.name.startsWith(".")) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        // Store relative path from vault root
        files.push(relative(vaultRoot, fullPath));
      }
    }
  }

  await walk(vaultRoot);
  return files;
}

/**
 * Match files against a pipeline's glob pattern.
 */
function matchFiles(files: string[], pattern: string): string[] {
  const matcher = picomatch(pattern);
  return files.filter((f) => matcher(f));
}

/**
 * Extract the external ID from a file's frontmatter.
 */
async function extractExternalId(
  vaultRoot: string,
  filePath: string,
  fieldName: string
): Promise<string | null> {
  const fullPath = join(vaultRoot, filePath);

  try {
    const content = await readFile(fullPath, "utf-8");
    const parsed = matter(content);
    const value: unknown = get(parsed.data, fieldName);

    if (value === undefined || value === null) return null;
    // External ID should be a primitive value (string or number)
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a file was recently synced (for incremental mode).
 */
async function wasRecentlySynced(
  vaultRoot: string,
  filePath: string,
  thresholdHours: number
): Promise<boolean> {
  const fullPath = join(vaultRoot, filePath);

  try {
    const content = await readFile(fullPath, "utf-8");
    const parsed = matter(content);
    const syncMeta = get(parsed.data, "_sync_meta") as { last_synced?: string } | undefined;

    if (!syncMeta?.last_synced) return false;

    const lastSynced = new Date(syncMeta.last_synced);
    const thresholdMs = thresholdHours * 60 * 60 * 1000;
    return Date.now() - lastSynced.getTime() < thresholdMs;
  } catch {
    return false;
  }
}

// =============================================================================
// Sync Pipeline Manager
// =============================================================================

/**
 * Main sync pipeline orchestrator.
 *
 * Coordinates the entire sync process:
 * 1. Load configurations and secrets
 * 2. Discover and filter files
 * 3. Fetch data from external APIs
 * 4. Apply normalization
 * 5. Update frontmatter
 */
export class SyncPipelineManager {
  private cache: ApiResponseCache;
  private normalizer: VocabularyNormalizer;
  private updater: FrontmatterUpdater;

  constructor() {
    this.cache = createApiResponseCache();
    this.normalizer = createVocabularyNormalizer();
    this.updater = createFrontmatterUpdater();
  }

  /**
   * Execute a sync operation.
   */
  async sync(options: SyncOptions): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: SyncError[] = [];
    let filesProcessed = 0;
    let filesUpdated = 0;

    const { vaultRoot, mode, pipeline: targetPipeline, onProgress } = options;
    const thresholdHours = options.incrementalThresholdHours ?? 24;

    // Report initial status
    onProgress?.({
      status: "syncing",
      current: 0,
      total: 0,
      errors: [],
    });

    try {
      // Load configurations
      log.info(`Starting ${mode} sync for vault: ${vaultRoot}`);
      const [{ pipelines, failed }, secrets] = await loadPipelineConfigs(vaultRoot).then(
        async (p) => [p, await loadSecrets(vaultRoot)] as const
      );

      if (failed.length > 0) {
        log.warn(`Skipped ${failed.length} invalid pipeline configs: ${failed.join(", ")}`);
      }

      // Filter pipelines if specific one requested
      const activePipelines = targetPipeline
        ? pipelines.filter((p) => p.name === targetPipeline)
        : pipelines;

      if (activePipelines.length === 0) {
        log.warn("No valid pipeline configurations found");
        return {
          status: "success",
          filesProcessed: 0,
          filesUpdated: 0,
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      // Clear cache for full sync
      if (mode === "full") {
        this.cache.clear();
      }

      // Discover all files
      const allFiles = await discoverFiles(vaultRoot);
      log.info(`Discovered ${allFiles.length} markdown files`);

      // Process each pipeline
      for (const pipelineConfig of activePipelines) {
        const pipelineErrors = await this.processPipeline(
          vaultRoot,
          pipelineConfig,
          secrets,
          allFiles,
          mode,
          thresholdHours,
          onProgress,
          errors
        );

        filesProcessed += pipelineErrors.processed;
        filesUpdated += pipelineErrors.updated;
      }

      const status = errors.length > 0 ? "error" : "success";
      const duration = Date.now() - startTime;

      // Report final status
      onProgress?.({
        status,
        current: filesProcessed,
        total: filesProcessed,
        errors,
      });

      log.info(
        `Sync completed: ${filesProcessed} files processed, ${filesUpdated} updated, ${errors.length} errors in ${duration}ms`
      );

      return { status, filesProcessed, filesUpdated, errors, duration };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Sync failed: ${message}`);

      onProgress?.({
        status: "error",
        current: filesProcessed,
        total: filesProcessed,
        errors: [{ file: "", pipeline: "", message }],
      });

      return {
        status: "error",
        filesProcessed,
        filesUpdated,
        errors: [{ file: "", pipeline: "", message }],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Process a single pipeline configuration.
   */
  private async processPipeline(
    vaultRoot: string,
    config: PipelineConfig,
    secrets: ProtectedSecrets,
    allFiles: string[],
    mode: SyncMode,
    thresholdHours: number,
    onProgress: ProgressCallback | undefined,
    errors: SyncError[]
  ): Promise<{ processed: number; updated: number }> {
    log.info(`Processing pipeline: ${config.name}`);

    // Get connector
    let connector: ApiConnector;
    try {
      connector = getConnector(config.connector);
    } catch {
      log.error(`Unknown connector: ${config.connector}`);
      errors.push({
        file: "",
        pipeline: config.name,
        message: `Unknown connector: ${config.connector}`,
      });
      return { processed: 0, updated: 0 };
    }

    // Match files by pattern
    const matchedFiles = matchFiles(allFiles, config.match.pattern);
    log.info(`Matched ${matchedFiles.length} files for pattern: ${config.match.pattern}`);

    let processed = 0;
    let updated = 0;

    for (const filePath of matchedFiles) {
      // Report progress
      onProgress?.({
        status: "syncing",
        currentFile: filePath,
        current: processed,
        total: matchedFiles.length,
        errors,
      });

      try {
        // Check incremental skip
        if (mode === "incremental") {
          const recent = await wasRecentlySynced(vaultRoot, filePath, thresholdHours);
          if (recent) {
            log.debug(`Skipping recently synced: ${filePath}`);
            processed++;
            continue;
          }
        }

        // Extract external ID
        const externalId = await extractExternalId(vaultRoot, filePath, config.match.field);
        if (!externalId) {
          log.debug(`No external ID in ${filePath} (field: ${config.match.field})`);
          processed++;
          continue;
        }

        // Fetch from API (with caching)
        const apiData = await this.fetchWithCache(connector, externalId);
        if (!apiData) {
          errors.push({
            file: filePath,
            pipeline: config.name,
            message: `Failed to fetch data for ID: ${externalId}`,
          });
          processed++;
          continue;
        }

        // Apply normalization if configured
        const normalizedData = await this.normalizeFields(
          apiData,
          config.fields,
          config.vocabulary
        );

        // Create field updates
        const updates = this.updater.createFieldUpdates(
          normalizedData,
          config.fields,
          config.defaults
        );

        // Create sync metadata
        const syncMeta: SyncMeta = {
          last_synced: new Date().toISOString(),
          source: config.connector,
          source_id: externalId,
        };

        // Update frontmatter
        const result = await this.updater.update({
          filePath: join(vaultRoot, filePath),
          updates,
          syncMeta,
          namespace: config.defaults?.namespace,
        });

        if (result.modified) {
          updated++;
          log.info(`Updated: ${filePath} (${result.changedFields.length} fields changed)`);
        }

        processed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`Error processing ${filePath}: ${message}`);
        errors.push({ file: filePath, pipeline: config.name, message });
        processed++;
      }
    }

    return { processed, updated };
  }

  /**
   * Fetch data from API with caching.
   */
  private async fetchWithCache(
    connector: ApiConnector,
    id: string
  ): Promise<Record<string, unknown> | null> {
    // Check cache first
    const cached = this.cache.get(connector.name, id);
    if (cached) {
      log.debug(`Cache hit for ${connector.name}:${id}`);
      return cached;
    }

    // Fetch from API
    try {
      const response = await connector.fetchById(id);
      if (response) {
        this.cache.set(connector.name, id, response);
        return response;
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`API fetch failed for ${connector.name}:${id}: ${message}`);
      return null;
    }
  }

  /**
   * Apply vocabulary normalization to fields.
   */
  private async normalizeFields(
    data: Record<string, unknown>,
    fields: FieldMapping[],
    vocabulary?: Record<string, string[]>
  ): Promise<Record<string, unknown>> {
    if (!vocabulary) return data;

    const result = { ...data };

    for (const field of fields) {
      if (!field.normalize) continue;

      const value: unknown = get(data, field.source);
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        // Normalize array of values (convert each to string safely)
        const stringValues = value.map((v) =>
          typeof v === "string" ? v : typeof v === "number" ? String(v) : ""
        );
        const normalized = await this.normalizer.normalizeBatch(
          stringValues.filter((s) => s.length > 0),
          vocabulary
        );
        result[field.source] = normalized.map((r) => r.normalized);
      } else if (typeof value === "string") {
        // Normalize single string value
        const normalized = await this.normalizer.normalize(value, vocabulary);
        result[field.source] = normalized;
      } else if (typeof value === "number") {
        // Normalize single number value
        const normalized = await this.normalizer.normalize(String(value), vocabulary);
        result[field.source] = normalized;
      }
      // Skip non-stringifiable values (objects, etc.)
    }

    return result;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new sync pipeline manager.
 */
export function createSyncPipelineManager(): SyncPipelineManager {
  return new SyncPipelineManager();
}

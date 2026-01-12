/**
 * Widget Engine
 *
 * Core orchestrator for widget computation, caching, and result formatting.
 * Coordinates DAG-based field computation where field dependencies are resolved
 * via topological sort, manages cache with stale-while-revalidate pattern,
 * and routes widgets by location.
 *
 * The computation model uses dependency graph analysis to determine field order:
 * - Fields can reference previously computed values via `result.<fieldName>`
 * - Cycles are detected before computation and affected fields return null
 * - Backward compatible: existing configs without `result.*` work unchanged
 *
 * Spec Requirements:
 * - REQ-F-1: Identify dependency relationships from `result.<fieldName>` references
 * - REQ-F-2: Determine computation order that respects dependencies
 * - REQ-F-3: Execute fields in dependency order, populating result context
 * - REQ-F-5: File discovery via glob patterns matching vault files
 * - REQ-F-10: Fields in cycles return null; non-cycle fields compute normally
 * - REQ-F-12: Log cycle warnings but do not throw exceptions
 * - REQ-F-14: Similarity computed on-demand for a given item, returning top-N similar items
 * - REQ-F-16: Ground widgets appear on Home/Ground view
 * - REQ-F-17: Recall widgets appear on Browse/Recall view when viewing a matching file
 * - REQ-F-26: Stale-while-revalidate: serve cached results while recomputing in background
 * - REQ-F-27: When glob pattern matches zero files, widget displays "no data" indicator
 *
 * Plan Reference:
 * - TD-1: Standalone dependency-graph module
 * - TD-5: Cycle Handling Strategy
 * - TD-6: Result Context Integration
 * - TD-7: Per-Item vs Collection Context
 * - TD-10: Widget Routing Logic
 */

import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { createHash } from "node:crypto";
import picomatch from "picomatch";

import { createLogger } from "../logger";
import type { WidgetConfig, FieldConfig, DisplayConfig, EditableField } from "./schemas";
import { loadWidgetConfigs, type WidgetLoaderResult } from "./widget-loader";
import { parseFrontmatter } from "./frontmatter";
import { getAggregator, sum, avg, stddev } from "./aggregators";
import { evaluateExpression } from "./expression-eval";
import { computeWeightedSimilarity } from "./comparators";
import { WidgetCache, createWidgetCache } from "./widget-cache";
import { createComputationPlan } from "./dependency-graph";

const log = createLogger("WidgetEngine");

// =============================================================================
// Types
// =============================================================================

/**
 * Health issue parameters for reporting widget computation issues.
 */
export interface WidgetHealthIssue {
  id: string;
  severity: "error" | "warning";
  message: string;
  details?: string;
}

/**
 * Callback for reporting health issues from widget computation.
 * Used to surface cycle warnings and other computation issues to the UI.
 */
export type HealthReportCallback = (issue: WidgetHealthIssue) => void;

/**
 * Result of widget computation.
 */
export interface WidgetResult {
  /** Widget identifier from filename */
  widgetId: string;
  /** Human-readable name from config */
  name: string;
  /** Widget computation type */
  type: "aggregate" | "similarity";
  /** Display location */
  location: "ground" | "recall";
  /** Display configuration */
  display: DisplayConfig;
  /** Computed data (type depends on widget type) */
  data: unknown;
  /** Optional editable fields */
  editable?: EditableField[];
  /** True when glob matches zero files (REQ-F-27) */
  isEmpty: boolean;
  /** Reason for empty state */
  emptyReason?: string;
  /** Computation time in milliseconds */
  computeTimeMs?: number;
}

/**
 * File data loaded from vault.
 */
interface FileData {
  /** Relative path from vault root */
  path: string;
  /** Absolute path */
  absolutePath: string;
  /** Parsed frontmatter data */
  frontmatter: Record<string, unknown>;
  /** File modification time (mtime) */
  mtime: number;
  /** File size in bytes */
  size: number;
}

/**
 * Loaded widget with its configuration.
 */
interface LoadedWidget {
  id: string;
  filePath: string;
  config: WidgetConfig;
}

/**
 * Options for engine computation.
 */
export interface ComputeOptions {
  /** Force recomputation even if cache is valid */
  force?: boolean;
}

/**
 * Similar item result for similarity widgets.
 */
export interface SimilarItem {
  /** Relative path to the similar file */
  path: string;
  /** Overall similarity score (0-1) */
  score: number;
  /** Per-dimension scores for debugging/display */
  dimensions: Array<{
    field: string;
    method: string;
    weight: number;
    score: number;
    skipped: boolean;
  }>;
  /** File title (from frontmatter or filename) */
  title: string;
}

// =============================================================================
// WidgetEngine Class
// =============================================================================

/**
 * Main engine for computing and managing widgets.
 *
 * Lifecycle:
 * 1. Create engine with vault path
 * 2. Call initialize() to load widget configs and set up cache
 * 3. Use computeGroundWidgets() for Home view
 * 4. Use computeRecallWidgets(filePath) for Browse view
 * 5. Call shutdown() when done
 */
export class WidgetEngine {
  private readonly vaultPath: string;
  private readonly vaultId: string;
  private cache: WidgetCache | null = null;
  private widgets: LoadedWidget[] = [];
  private initialized = false;

  // Background recomputation state
  private pendingRecomputations: Set<string> = new Set();

  // Health reporting callback for surfacing issues to UI
  private healthCallback: HealthReportCallback | null = null;

  constructor(vaultPath: string, vaultId?: string) {
    this.vaultPath = vaultPath;
    // Use vault path as ID if not provided (hash for uniqueness)
    this.vaultId = vaultId ?? createHash("md5").update(vaultPath).digest("hex").slice(0, 8);
  }

  /**
   * Returns true if the engine is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Returns the vault path.
   */
  getVaultPath(): string {
    return this.vaultPath;
  }

  /**
   * Returns the vault ID.
   */
  getVaultId(): string {
    return this.vaultId;
  }

  /**
   * Returns loaded widgets.
   */
  getWidgets(): LoadedWidget[] {
    return [...this.widgets];
  }

  /**
   * Set a callback for health issue reporting.
   * Called when computation issues (like cycles) are detected.
   */
  setHealthCallback(callback: HealthReportCallback): void {
    this.healthCallback = callback;
  }

  /**
   * Initialize the engine: load widget configs and set up cache.
   *
   * @returns Loader result with any widget config errors
   */
  async initialize(): Promise<WidgetLoaderResult> {
    log.info(`Initializing widget engine for ${this.vaultPath}`);

    // Load widget configurations
    const loaderResult = await loadWidgetConfigs(this.vaultPath);
    this.widgets = loaderResult.widgets;

    // Initialize cache
    this.cache = await createWidgetCache(this.vaultPath);

    this.initialized = true;

    log.info(`Engine initialized: ${this.widgets.length} widget(s), ${loaderResult.errors.length} error(s)`);

    return loaderResult;
  }

  /**
   * Shutdown the engine and release resources.
   */
  shutdown(): void {
    log.info("Shutting down widget engine");

    if (this.cache) {
      this.cache.close();
      this.cache = null;
    }

    this.widgets = [];
    this.pendingRecomputations.clear();
    this.initialized = false;
  }

  // ===========================================================================
  // Ground Widgets (Home View)
  // ===========================================================================

  /**
   * Compute all ground widgets for the vault dashboard.
   *
   * @param options - Computation options
   * @returns Array of widget results
   */
  async computeGroundWidgets(options: ComputeOptions = {}): Promise<WidgetResult[]> {
    if (!this.initialized) {
      throw new Error("Engine not initialized. Call initialize() first.");
    }

    const groundWidgets = this.widgets.filter((w) => w.config.location === "ground");

    if (groundWidgets.length === 0) {
      log.debug("No ground widgets configured");
      return [];
    }

    log.info(`Computing ${groundWidgets.length} ground widget(s)`);

    const results = await Promise.all(
      groundWidgets.map((w) => this.computeWidget(w, options))
    );

    return results;
  }

  // ===========================================================================
  // Recall Widgets (Browse View)
  // ===========================================================================

  /**
   * Compute recall widgets for a specific file.
   *
   * Only computes widgets whose source pattern matches the given file path.
   *
   * @param filePath - Relative path to the file being viewed
   * @param options - Computation options
   * @returns Array of widget results for this file
   */
  async computeRecallWidgets(
    filePath: string,
    options: ComputeOptions = {}
  ): Promise<WidgetResult[]> {
    if (!this.initialized) {
      throw new Error("Engine not initialized. Call initialize() first.");
    }

    const recallWidgets = this.widgets.filter((w) => w.config.location === "recall");

    if (recallWidgets.length === 0) {
      log.debug("No recall widgets configured");
      return [];
    }

    // Filter to widgets whose source pattern matches the current file
    const applicableWidgets = recallWidgets.filter((w) => {
      const matcher = picomatch(w.config.source.pattern);
      return matcher(filePath);
    });

    if (applicableWidgets.length === 0) {
      log.debug(`No recall widgets match file: ${filePath}`);
      return [];
    }

    log.info(`Computing ${applicableWidgets.length} recall widget(s) for ${filePath}`);

    const results = await Promise.all(
      applicableWidgets.map((w) => this.computeWidgetForItem(w, filePath, options))
    );

    return results;
  }

  // ===========================================================================
  // Widget Computation
  // ===========================================================================

  /**
   * Compute a single widget.
   * Handles caching with stale-while-revalidate pattern.
   */
  private async computeWidget(
    widget: LoadedWidget,
    options: ComputeOptions = {}
  ): Promise<WidgetResult> {
    const startTime = performance.now();

    // Load files matching the source pattern
    const files = await this.loadMatchingFiles(widget.config.source.pattern);

    // Handle empty results
    if (files.length === 0) {
      return this.createEmptyResult(widget, startTime);
    }

    // Compute content hash for cache key
    const contentHash = this.computeContentHash(files);

    // Check cache (unless force flag is set)
    if (!options.force && this.cache) {
      const cached = this.cache.getWidgetResult(this.vaultId, widget.id, contentHash);
      if (cached) {
        log.debug(`Cache hit for widget ${widget.id}`);
        const result = JSON.parse(cached.resultJson) as WidgetResult;
        result.computeTimeMs = performance.now() - startTime;
        return result;
      }
    }

    // Compute based on widget type
    let result: WidgetResult;
    if (widget.config.type === "aggregate") {
      result = this.computeAggregateWidget(widget, files, startTime);
    } else {
      // Similarity widgets on ground view show collection summary
      result = this.computeSimilarityWidgetSummary(widget, files, startTime);
    }

    // Cache the result
    if (this.cache) {
      this.cache.setWidgetResult(this.vaultId, widget.id, contentHash, result);
    }

    return result;
  }

  /**
   * Compute a widget for a specific item (recall widgets, similarity).
   */
  private async computeWidgetForItem(
    widget: LoadedWidget,
    filePath: string,
    options: ComputeOptions = {}
  ): Promise<WidgetResult> {
    const startTime = performance.now();

    // Load all files matching the source pattern
    const files = await this.loadMatchingFiles(widget.config.source.pattern);

    // Handle empty results
    if (files.length === 0) {
      return this.createEmptyResult(widget, startTime);
    }

    // Find the current file
    const currentFile = files.find((f) => f.path === filePath);
    if (!currentFile) {
      return this.createEmptyResult(widget, startTime, `File not found: ${filePath}`);
    }

    // Compute content hash for cache key
    const contentHash = this.computeContentHash(files);

    if (widget.config.type === "similarity") {
      // Check similarity cache
      if (!options.force && this.cache) {
        const cached = this.cache.getSimilarityResult(
          this.vaultId,
          widget.id,
          filePath,
          contentHash
        );
        if (cached) {
          log.debug(`Similarity cache hit for ${widget.id}:${filePath}`);
          const result = JSON.parse(cached.similarItemsJson) as WidgetResult;
          result.computeTimeMs = performance.now() - startTime;
          return result;
        }
      }

      const result = this.computeSimilarityWidget(
        widget,
        currentFile,
        files,
        startTime
      );

      // Cache similarity result
      if (this.cache) {
        this.cache.setSimilarityResult(
          this.vaultId,
          widget.id,
          filePath,
          contentHash,
          result
        );
      }

      return result;
    } else {
      // Aggregate widget for specific item - compute per-item values
      return this.computeAggregateWidgetForItem(widget, currentFile, files, startTime);
    }
  }

  // ===========================================================================
  // Aggregate Widget Computation
  // ===========================================================================

  /**
   * Compute an aggregate widget using DAG-ordered field computation.
   *
   * Uses dependency graph analysis to determine field computation order:
   * 1. Build computation plan from field configs (detects cycles, determines order)
   * 2. Log warnings for any cycles (REQ-F-12)
   * 3. Compute fields in dependency order, accumulating results
   * 4. Cycle fields return null; other fields compute normally (REQ-F-10)
   *
   * The result context is available to expressions via both `stats.*` (legacy)
   * and `result.*` (DAG dependencies). Both reference the same accumulator.
   *
   * Plan Reference: TD-5 (Cycle Handling), TD-6 (Result Context Integration)
   */
  private computeAggregateWidget(
    widget: LoadedWidget,
    files: FileData[],
    startTime: number
  ): WidgetResult {
    const config = widget.config;
    const fieldConfigs = config.fields ?? {};

    // Get computation plan with DAG ordering (TD-1)
    const plan = createComputationPlan(fieldConfigs);

    // Log and report warnings for cycles (REQ-F-12: warn but don't throw)
    this.reportCycleWarnings(widget.id, config.name, plan);

    // Initialize result accumulator with built-in count (REQ-F-14)
    const result: Record<string, unknown> = { count: files.length };

    // Set cycle fields to null before computation (REQ-F-10)
    // Cycle fields are excluded from phases, so we must handle them separately
    for (const cycleField of plan.cycleFields) {
      result[cycleField] = null;
    }

    // Compute fields in DAG order
    for (const phase of plan.phases) {
      for (const fieldName of phase.fields) {
        const fieldConfig = fieldConfigs[fieldName];

        if (phase.scope === "collection") {
          // Aggregator field: operates across all items, produces single value
          // Pass field configs and current results to enable result.X references
          result[fieldName] = this.computeAggregatorField(fieldConfig, files, fieldConfigs, result);
        } else {
          // Expression field: evaluated once with collection context
          // For ground widgets, `this` is empty (no current item)
          result[fieldName] = this.evaluateExpressionWithHealth(
            widget.id,
            config.name,
            fieldName,
            fieldConfig.expr!,
            { this: {}, stats: result, result: result }
          );
        }
      }
    }

    // Filter to only user-defined visible fields
    // (stats.count is for expressions, not output unless user defines a count field)
    const visibleData: Record<string, unknown> = {};
    for (const [fieldName, value] of Object.entries(result)) {
      const fieldConfig = fieldConfigs[fieldName];
      // Only include fields that are defined in config AND not explicitly hidden
      if (fieldConfig && fieldConfig.visible !== false) {
        visibleData[fieldName] = value;
      }
    }

    return {
      widgetId: widget.id,
      name: config.name,
      type: "aggregate",
      location: config.location,
      display: config.display,
      data: visibleData,
      editable: config.editable,
      isEmpty: false,
      computeTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Compute an aggregate widget for a specific item (recall widgets).
   * Uses DAG-ordered computation with per-item context.
   *
   * Same DAG-based approach as computeAggregateWidget, but expressions
   * also have access to `this.*` for the current file's frontmatter.
   * This enables per-item expressions like z-scores that reference both
   * the item's values and collection-level statistics.
   *
   * Plan Reference: TD-6 (Result Context), TD-7 (Per-Item vs Collection Context)
   */
  private computeAggregateWidgetForItem(
    widget: LoadedWidget,
    currentFile: FileData,
    files: FileData[],
    startTime: number
  ): WidgetResult {
    const config = widget.config;
    const fieldConfigs = config.fields ?? {};

    // Get computation plan with DAG ordering (TD-1)
    const plan = createComputationPlan(fieldConfigs);

    // Log and report warnings for cycles (REQ-F-12: warn but don't throw)
    this.reportCycleWarnings(widget.id, config.name, plan);

    // Initialize result accumulator with built-in count (REQ-F-14)
    const result: Record<string, unknown> = { count: files.length };

    // Set cycle fields to null before computation (REQ-F-10)
    // Cycle fields are excluded from phases, so we must handle them separately
    for (const cycleField of plan.cycleFields) {
      result[cycleField] = null;
    }

    // Compute fields in DAG order
    for (const phase of plan.phases) {
      for (const fieldName of phase.fields) {
        const fieldConfig = fieldConfigs[fieldName];

        if (phase.scope === "collection") {
          // Aggregator field: operates across all items, produces single value
          // Pass field configs and current results to enable result.X references
          result[fieldName] = this.computeAggregatorField(fieldConfig, files, fieldConfigs, result);
        } else {
          // Expression field: evaluated with item context (TD-7)
          // `this` contains the current file's frontmatter for per-item access
          result[fieldName] = this.evaluateExpressionWithHealth(
            widget.id,
            config.name,
            fieldName,
            fieldConfig.expr!,
            { this: currentFile.frontmatter, stats: result, result: result }
          );
        }
      }
    }

    // Filter to only user-defined visible fields
    // (stats.count is for expressions, not output unless user defines a count field)
    const visibleData: Record<string, unknown> = {};
    for (const [fieldName, value] of Object.entries(result)) {
      const fieldConfig = fieldConfigs[fieldName];
      // Only include fields that are defined in config AND not explicitly hidden
      if (fieldConfig && fieldConfig.visible !== false) {
        visibleData[fieldName] = value;
      }
    }

    return {
      widgetId: widget.id,
      name: config.name,
      type: "aggregate",
      location: config.location,
      display: config.display,
      data: visibleData,
      editable: config.editable,
      isEmpty: false,
      computeTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Compute a single aggregator field value from files.
   *
   * Handles count, sum, avg, min, max, stddev aggregators.
   * Returns null if no valid values found.
   *
   * Field paths support three contexts:
   * - `this.X` or plain `X`: Extract from frontmatter (e.g., `avg: this.rating` or `avg: rating`)
   * - `result.X`: Extract from previously computed per-item field values (e.g., `avg: result.adjusted_score`)
   *
   * When using `result.X`, the aggregator will:
   * 1. Look up the field config for X
   * 2. If X is an expression, evaluate it for each file to get per-item values
   * 3. Aggregate those per-item values
   *
   * @param fieldConfig - The field configuration for this aggregator
   * @param files - Array of file data to aggregate over
   * @param allFieldConfigs - All field configs (needed to resolve result.X references)
   * @param currentResults - Current result accumulator (for expression context)
   */
  private computeAggregatorField(
    fieldConfig: FieldConfig,
    files: FileData[],
    allFieldConfigs?: Record<string, FieldConfig>,
    currentResults?: Record<string, unknown>
  ): number | null {
    // Count is special - just return file count
    if (fieldConfig.count) {
      return files.length;
    }

    // Determine which frontmatter field path to aggregate
    const rawFieldPath =
      fieldConfig.sum ??
      fieldConfig.avg ??
      fieldConfig.min ??
      fieldConfig.max ??
      fieldConfig.stddev;

    if (!rawFieldPath) {
      return null;
    }

    // Parse the field path to determine source context
    const { source, path } = this.parseFieldPath(rawFieldPath);

    // Extract numeric values from all files based on source context
    let numericValues: (number | null)[];

    if (source === "result") {
      // result.X - extract from per-item computed values
      numericValues = this.extractResultValues(path, files, allFieldConfigs, currentResults);
    } else {
      // this.X or plain X - extract from frontmatter
      numericValues = files.map((f) => {
        const value = this.getFieldValue(f.frontmatter, path);
        return typeof value === "number" ? value : null;
      });
    }

    // Apply the requested aggregation
    if (fieldConfig.sum) {
      return sum(numericValues);
    }
    if (fieldConfig.avg) {
      return avg(numericValues);
    }
    if (fieldConfig.min) {
      return getAggregator("min")!(numericValues);
    }
    if (fieldConfig.max) {
      return getAggregator("max")!(numericValues);
    }
    if (fieldConfig.stddev) {
      return stddev(numericValues);
    }

    return null;
  }

  /**
   * Parse a field path to determine its source context.
   *
   * Supported formats:
   * - `this.field.path` -> { source: "this", path: "field.path" }
   * - `result.fieldName` -> { source: "result", path: "fieldName" }
   * - `plain.path` -> { source: "this", path: "plain.path" } (backward compatible)
   *
   * @param fieldPath - The raw field path from config
   * @returns Object with source context and resolved path
   */
  private parseFieldPath(fieldPath: string): { source: "this" | "result"; path: string } {
    if (fieldPath.startsWith("this.")) {
      return { source: "this", path: fieldPath.slice(5) };
    }
    if (fieldPath.startsWith("result.")) {
      return { source: "result", path: fieldPath.slice(7) };
    }
    // Backward compatible: plain paths are treated as this.X
    return { source: "this", path: fieldPath };
  }

  /**
   * Extract numeric values from per-item computed results.
   *
   * When an aggregator references `result.X`, we need to:
   * 1. Find the field config for X
   * 2. If X is an expression, evaluate it for each file to get per-item values
   * 3. If X is a collection-scope aggregator, return that single value for all files
   *
   * For chained expressions (X depends on Y), this method recursively computes
   * all necessary per-item values before evaluating the target expression.
   *
   * @param fieldName - The field name to extract (without result. prefix)
   * @param files - Array of file data
   * @param allFieldConfigs - All field configurations
   * @param currentResults - Current result accumulator
   * @returns Array of numeric values, one per file
   */
  private extractResultValues(
    fieldName: string,
    files: FileData[],
    allFieldConfigs?: Record<string, FieldConfig>,
    currentResults?: Record<string, unknown>
  ): (number | null)[] {
    // Check if this field has a config with an expression (item-scope)
    const targetFieldConfig = allFieldConfigs?.[fieldName];

    if (targetFieldConfig?.expr) {
      // Item-scope expression: evaluate for each file to get per-item values
      // This is the core use case for result.X in aggregators
      return files.map((file) => {
        // Build per-item result context by computing any expression dependencies
        const perItemResult = this.buildPerItemResultContext(
          file,
          fieldName,
          allFieldConfigs ?? {},
          currentResults ?? {}
        );

        try {
          const context = {
            this: file.frontmatter,
            stats: currentResults ?? {},
            result: perItemResult,
          };
          const value = evaluateExpression(targetFieldConfig.expr!, context);
          return typeof value === "number" ? value : null;
        } catch {
          return null;
        }
      });
    }

    // If field is already computed (collection-scope aggregator), use that value
    // This handles the unusual case of aggregating over another aggregator's result
    if (currentResults && fieldName in currentResults) {
      const existingValue = currentResults[fieldName];
      if (typeof existingValue === "number") {
        // Collection-scope value - repeat for aggregation (though this is unusual)
        return files.map(() => existingValue);
      }
      // Non-numeric result, return nulls
      return files.map(() => null);
    }

    // No config found and not in results - return nulls
    return files.map(() => null);
  }

  /**
   * Build per-item result context for expression evaluation.
   *
   * When evaluating an expression that depends on other expressions via result.*,
   * we need to compute those dependencies first. This method recursively computes
   * all expression dependencies for a single file.
   *
   * @param file - The file to compute values for
   * @param targetField - The field we're ultimately trying to compute
   * @param allFieldConfigs - All field configurations
   * @param currentResults - Current collection-level results
   * @returns Result context with per-item computed values
   */
  private buildPerItemResultContext(
    file: FileData,
    targetField: string,
    allFieldConfigs: Record<string, FieldConfig>,
    currentResults: Record<string, unknown>
  ): Record<string, unknown> {
    // Start with collection-level results (aggregators only, not expressions)
    // We need to exclude expression results because those are computed with empty `this`
    // in ground widgets and need to be recomputed per-file
    const perItemResult: Record<string, unknown> = {};

    // Copy only collection-scope (aggregator) values from currentResults
    for (const [fieldName, value] of Object.entries(currentResults)) {
      const fieldConfig = allFieldConfigs[fieldName];
      // A field is collection-scope if it has an aggregator (count, sum, avg, etc.)
      const isAggregator =
        fieldConfig?.count ||
        fieldConfig?.sum ||
        fieldConfig?.avg ||
        fieldConfig?.min ||
        fieldConfig?.max ||
        fieldConfig?.stddev;

      if (isAggregator) {
        perItemResult[fieldName] = value;
      }
      // Skip expression fields - they need per-item computation
    }

    // Find all expression fields that the target might depend on
    // by extracting result.* references from the target expression
    const targetConfig = allFieldConfigs[targetField];
    if (!targetConfig?.expr) {
      return perItemResult;
    }

    // Extract result.* references from the expression
    const resultRefs = this.extractResultReferences(targetConfig.expr);

    // Recursively compute each referenced expression field
    const computed = new Set<string>();
    const toCompute = [...resultRefs];

    while (toCompute.length > 0) {
      const fieldName = toCompute.shift()!;

      // Skip if already computed or if it's a collection-scope value (aggregator)
      if (computed.has(fieldName) || fieldName in perItemResult) {
        continue;
      }

      const fieldConfig = allFieldConfigs[fieldName];
      if (fieldConfig?.expr) {
        // Check for more dependencies
        const moreDeps = this.extractResultReferences(fieldConfig.expr);
        for (const dep of moreDeps) {
          if (!computed.has(dep) && !(dep in perItemResult)) {
            toCompute.unshift(dep); // Add to front for depth-first
          }
        }

        // Compute this expression for the file
        try {
          const context = {
            this: file.frontmatter,
            stats: currentResults,
            result: perItemResult,
          };
          perItemResult[fieldName] = evaluateExpression(fieldConfig.expr, context);
        } catch {
          perItemResult[fieldName] = null;
        }

        computed.add(fieldName);
      }
    }

    return perItemResult;
  }

  /**
   * Extract result.* field references from an expression string.
   *
   * @param expression - The expression to analyze
   * @returns Array of field names referenced via result.*
   */
  private extractResultReferences(expression: string): string[] {
    const pattern = /result\.(\w+)/g;
    const refs: string[] = [];
    let match;
    while ((match = pattern.exec(expression)) !== null) {
      refs.push(match[1]);
    }
    return [...new Set(refs)];
  }

  /**
   * Report cycle warnings to both logger and health callback.
   */
  private reportCycleWarnings(
    widgetId: string,
    widgetName: string,
    plan: { warnings: string[]; cycleFields: Set<string> }
  ): void {
    for (const warning of plan.warnings) {
      log.warn(`Widget ${widgetId}: ${warning}`);
      // Report cycle warning to health UI
      this.healthCallback?.({
        id: `widget_cycle_${widgetId}_${Array.from(plan.cycleFields).join("_")}`,
        severity: "warning",
        message: `Dependency cycle in widget "${widgetName}"`,
        details: warning,
      });
    }
  }

  /**
   * Evaluate expression and report errors to health callback.
   */
  private evaluateExpressionWithHealth(
    widgetId: string,
    widgetName: string,
    fieldName: string,
    expression: string,
    context: { this: Record<string, unknown>; stats: Record<string, unknown>; result: Record<string, unknown> }
  ): unknown {
    try {
      return evaluateExpression(expression, context);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.warn(`Expression error for ${fieldName}: ${errorMsg}`);
      // Report expression error to health UI
      this.healthCallback?.({
        id: `widget_expr_${widgetId}_${fieldName}`,
        severity: "warning",
        message: `Expression error in widget "${widgetName}"`,
        details: `Field "${fieldName}": ${errorMsg}`,
      });
      return null;
    }
  }

  // ===========================================================================
  // Similarity Widget Computation
  // ===========================================================================

  /**
   * Compute similarity widget for a specific item.
   */
  private computeSimilarityWidget(
    widget: LoadedWidget,
    currentFile: FileData,
    files: FileData[],
    startTime: number
  ): WidgetResult {
    const config = widget.config;
    const dimensions = config.dimensions ?? [];
    const limit = config.display.limit ?? 10;

    // Compute similarity against all other files
    const similarities: SimilarItem[] = [];

    for (const file of files) {
      // Skip self
      if (file.path === currentFile.path) {
        continue;
      }

      const result = computeWeightedSimilarity(
        currentFile.frontmatter,
        file.frontmatter,
        dimensions
      );

      similarities.push({
        path: file.path,
        score: result.score,
        dimensions: result.dimensions,
        title: this.getFileTitle(file),
      });
    }

    // Sort by score descending and take top N
    similarities.sort((a, b) => b.score - a.score);
    const topSimilar = similarities.slice(0, limit);

    return {
      widgetId: widget.id,
      name: config.name,
      type: "similarity",
      location: config.location,
      display: config.display,
      data: topSimilar,
      editable: config.editable,
      isEmpty: false,
      computeTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Compute similarity widget summary for ground view.
   * Shows collection info rather than per-item similarities.
   */
  private computeSimilarityWidgetSummary(
    widget: LoadedWidget,
    files: FileData[],
    startTime: number
  ): WidgetResult {
    const config = widget.config;

    // For ground view, show metadata about the similarity widget
    const data = {
      itemCount: files.length,
      dimensions: config.dimensions?.map((d) => ({
        field: d.field,
        weight: d.weight,
        method: d.method,
      })),
      message: `Similarity widget with ${files.length} items. View a file to see similar items.`,
    };

    return {
      widgetId: widget.id,
      name: config.name,
      type: "similarity",
      location: config.location,
      display: config.display,
      data,
      editable: config.editable,
      isEmpty: false,
      computeTimeMs: performance.now() - startTime,
    };
  }

  // ===========================================================================
  // File Loading
  // ===========================================================================

  /**
   * Load files matching a glob pattern.
   * Uses Bun's built-in glob functionality.
   */
  private async loadMatchingFiles(pattern: string): Promise<FileData[]> {
    let matchedPaths: string[];
    try {
      // Use Bun's built-in Glob class
      const globInstance = new Bun.Glob(pattern);
      const matches = globInstance.scanSync({
        cwd: this.vaultPath,
        absolute: true,
        onlyFiles: true,
      });
      matchedPaths = Array.from(matches);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`Glob error for pattern ${pattern}: ${errorMsg}`);
      return [];
    }

    if (matchedPaths.length === 0) {
      log.debug(`No files match pattern: ${pattern}`);
      return [];
    }

    log.debug(`Found ${matchedPaths.length} file(s) matching: ${pattern}`);

    // Load file data in parallel
    const filePromises = matchedPaths.map(async (absolutePath): Promise<FileData | null> => {
      try {
        const content = await readFile(absolutePath, "utf-8");
        const stats = await stat(absolutePath);
        const { data: frontmatter } = parseFrontmatter(content);

        return {
          path: relative(this.vaultPath, absolutePath),
          absolutePath,
          frontmatter,
          mtime: stats.mtimeMs,
          size: stats.size,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.warn(`Failed to load file ${absolutePath}: ${errorMsg}`);
        return null;
      }
    });

    const results = await Promise.all(filePromises);
    return results.filter((f): f is FileData => f !== null);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Create an empty result for a widget.
   */
  private createEmptyResult(
    widget: LoadedWidget,
    startTime: number,
    reason?: string
  ): WidgetResult {
    return {
      widgetId: widget.id,
      name: widget.config.name,
      type: widget.config.type,
      location: widget.config.location,
      display: widget.config.display,
      data: null,
      editable: widget.config.editable,
      isEmpty: true,
      emptyReason: reason ?? `No files match ${widget.config.source.pattern}`,
      computeTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Compute content hash from file metadata.
   * Hash is based on sorted list of path:mtime:size strings.
   */
  private computeContentHash(files: FileData[]): string {
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const hashInput = sorted.map((f) => `${f.path}:${f.mtime}:${f.size}`).join("\n");
    return createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
  }

  /**
   * Get a field value from frontmatter using dot-notation path.
   */
  private getFieldValue(data: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = data;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return null;
      }
      if (typeof current !== "object") {
        return null;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current === undefined ? null : current;
  }

  /**
   * Get a display title for a file.
   */
  private getFileTitle(file: FileData): string {
    // Try frontmatter title first
    const fmTitle = file.frontmatter.title;
    if (typeof fmTitle === "string" && fmTitle.length > 0) {
      return fmTitle;
    }

    // Fall back to filename without extension
    const basename = file.path.split("/").pop() ?? file.path;
    return basename.replace(/\.md$/i, "");
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Invalidate all cache entries for a specific widget.
   */
  invalidateWidget(widgetId: string): void {
    if (this.cache) {
      const widgetCount = this.cache.invalidateWidget(this.vaultId, widgetId);
      const similarityCount = this.cache.invalidateSimilarity(this.vaultId, widgetId);
      log.debug(`Invalidated cache for widget ${widgetId}: ${widgetCount + similarityCount} entries`);
    }
  }

  /**
   * Invalidate all cache entries for this vault.
   */
  invalidateAll(): void {
    if (this.cache) {
      const count = this.cache.invalidateVault(this.vaultId);
      log.debug(`Invalidated all cache for vault: ${count} entries`);
    }
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { usingFallback: boolean; widgetEntries: number; similarityEntries: number } {
    if (this.cache) {
      return this.cache.getStats();
    }
    return { usingFallback: true, widgetEntries: 0, similarityEntries: 0 };
  }

  // ===========================================================================
  // Public Similarity API
  // ===========================================================================

  /**
   * Compute similarity for a specific item, returning top-N similar items.
   *
   * This is the public API for on-demand similarity computation.
   * Results are cached with content version hash and returned in <100ms on cache hit.
   *
   * @param widgetId - Widget identifier (must be a similarity widget)
   * @param sourcePath - Relative path to the source file
   * @returns Computed similarity result with top-N similar items
   * @throws Error if widget not found or not a similarity widget
   */
  async computeSimilarity(
    widgetId: string,
    sourcePath: string
  ): Promise<{ result: SimilarItem[]; computeTimeMs: number; cacheHit: boolean }> {
    if (!this.initialized) {
      throw new Error("Engine not initialized. Call initialize() first.");
    }

    const startTime = performance.now();

    // Find the widget
    const widget = this.widgets.find((w) => w.id === widgetId);
    if (!widget) {
      throw new Error(`Widget not found: ${widgetId}`);
    }

    if (widget.config.type !== "similarity") {
      throw new Error(`Widget ${widgetId} is not a similarity widget`);
    }

    // Load files matching the source pattern
    const files = await this.loadMatchingFiles(widget.config.source.pattern);

    if (files.length === 0) {
      log.debug(`No files match pattern for widget ${widgetId}`);
      return {
        result: [],
        computeTimeMs: performance.now() - startTime,
        cacheHit: false,
      };
    }

    // Find the current file
    const currentFile = files.find((f) => f.path === sourcePath);
    if (!currentFile) {
      log.debug(`Source file not found in collection: ${sourcePath}`);
      return {
        result: [],
        computeTimeMs: performance.now() - startTime,
        cacheHit: false,
      };
    }

    // Compute content hash for cache key
    const contentHash = this.computeContentHash(files);

    // Check similarity cache
    if (this.cache) {
      const cached = this.cache.getSimilarityResult(
        this.vaultId,
        widgetId,
        sourcePath,
        contentHash
      );
      if (cached) {
        const computeTimeMs = performance.now() - startTime;
        log.debug(`Similarity cache hit for ${widgetId}:${sourcePath} in ${computeTimeMs.toFixed(2)}ms`);
        const cachedResult = JSON.parse(cached.similarItemsJson) as WidgetResult;
        return {
          result: cachedResult.data as SimilarItem[],
          computeTimeMs,
          cacheHit: true,
        };
      }
    }

    // Compute similarity
    const widgetResult = this.computeSimilarityWidget(widget, currentFile, files, startTime);
    const similarItems = widgetResult.data as SimilarItem[];

    // Cache the result
    if (this.cache) {
      this.cache.setSimilarityResult(
        this.vaultId,
        widgetId,
        sourcePath,
        contentHash,
        widgetResult
      );
    }

    const computeTimeMs = performance.now() - startTime;
    log.info(`Computed similarity for ${widgetId}:${sourcePath} in ${computeTimeMs.toFixed(2)}ms (${similarItems.length} results)`);

    return {
      result: similarItems,
      computeTimeMs,
      cacheHit: false,
    };
  }

  // ===========================================================================
  // File Change Handling
  // ===========================================================================

  /**
   * Handle file change events from the file watcher.
   *
   * Invalidates similarity cache for all widgets whose source pattern matches
   * any of the changed files. This ensures cache consistency when source files
   * are modified.
   *
   * @param paths - Relative paths of changed files
   * @returns Object with invalidation counts per widget
   */
  handleFilesChanged(paths: string[]): { invalidatedWidgets: string[]; totalEntriesInvalidated: number } {
    if (!this.initialized || paths.length === 0) {
      return { invalidatedWidgets: [], totalEntriesInvalidated: 0 };
    }

    log.info(`Handling file changes for ${paths.length} file(s)`);

    const invalidatedWidgets: string[] = [];
    let totalEntriesInvalidated = 0;

    // For each widget, check if any changed file matches its source pattern
    for (const widget of this.widgets) {
      const matcher = picomatch(widget.config.source.pattern);
      const hasMatchingFile = paths.some((p) => matcher(p));

      if (hasMatchingFile) {
        log.debug(`Invalidating cache for widget ${widget.id} (matching file changed)`);

        // Invalidate both widget results and similarity results
        const widgetCount = this.cache?.invalidateWidget(this.vaultId, widget.id) ?? 0;
        const similarityCount = this.cache?.invalidateSimilarity(this.vaultId, widget.id) ?? 0;
        const totalCount = widgetCount + similarityCount;

        if (totalCount > 0) {
          invalidatedWidgets.push(widget.id);
          totalEntriesInvalidated += totalCount;
        }
      }
    }

    if (invalidatedWidgets.length > 0) {
      log.info(`Invalidated ${totalEntriesInvalidated} cache entries for ${invalidatedWidgets.length} widget(s)`);
    }

    return { invalidatedWidgets, totalEntriesInvalidated };
  }

  /**
   * Trigger background recomputation for widgets affected by file changes.
   *
   * This is an optional optimization: after invalidating cache, you can trigger
   * background recomputation so results are ready when next requested.
   *
   * This method starts background tasks but does not wait for them to complete.
   * Use `await` on the returned promise if you need to wait for completion.
   *
   * @param widgetIds - Widget IDs to recompute
   */
  triggerBackgroundRecomputation(widgetIds: string[]): void {
    if (!this.initialized || widgetIds.length === 0) {
      return;
    }

    const widgets = this.widgets.filter((w) => widgetIds.includes(w.id));
    const groundWidgets = widgets.filter((w) => w.config.location === "ground");

    // Recompute ground widgets in background
    for (const widget of groundWidgets) {
      if (!this.pendingRecomputations.has(widget.id)) {
        this.pendingRecomputations.add(widget.id);
        void this.computeWidget(widget, { force: true })
          .finally(() => this.pendingRecomputations.delete(widget.id));
      }
    }
  }

  // ===========================================================================
  // Stale-While-Revalidate Support
  // ===========================================================================

  /**
   * Compute widgets with stale-while-revalidate pattern.
   * Returns cached results immediately if available, triggers background recomputation.
   *
   * @param type - "ground" or "recall"
   * @param filePath - For recall widgets, the file being viewed
   * @returns Widget results (may be stale)
   */
  async computeWithStaleWhileRevalidate(
    type: "ground" | "recall",
    filePath?: string
  ): Promise<{ results: WidgetResult[]; isStale: boolean }> {
    if (type === "ground") {
      // Try to get cached ground widgets
      const groundWidgets = this.widgets.filter((w) => w.config.location === "ground");
      const cachedResults: WidgetResult[] = [];
      let hasStale = false;

      for (const widget of groundWidgets) {
        const files = await this.loadMatchingFiles(widget.config.source.pattern);
        if (files.length === 0) {
          cachedResults.push(this.createEmptyResult(widget, performance.now()));
          continue;
        }

        const contentHash = this.computeContentHash(files);
        const cached = this.cache?.getWidgetResult(this.vaultId, widget.id, contentHash);

        if (cached) {
          cachedResults.push(JSON.parse(cached.resultJson) as WidgetResult);
        } else {
          // No cache hit - need fresh computation
          hasStale = true;
          cachedResults.push(await this.computeWidget(widget));
        }
      }

      // If any were stale, trigger background recomputation for freshness
      if (hasStale && !this.pendingRecomputations.has("ground")) {
        this.pendingRecomputations.add("ground");
        // Background recompute (fire and forget, explicitly ignored)
        void this.computeGroundWidgets({ force: true })
          .catch((err) => {
            log.error("Background ground widget recomputation failed", err);
          })
          .finally(() => this.pendingRecomputations.delete("ground"));
      }

      return { results: cachedResults, isStale: hasStale };
    } else {
      // Recall widgets
      if (!filePath) {
        return { results: [], isStale: false };
      }

      const results = await this.computeRecallWidgets(filePath);
      return { results, isStale: false };
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create and initialize a WidgetEngine for a vault.
 *
 * @param vaultPath - Absolute path to vault root
 * @param vaultId - Optional vault identifier (defaults to hashed path)
 * @returns Initialized engine and any loader errors
 */
export async function createWidgetEngine(
  vaultPath: string,
  vaultId?: string
): Promise<{ engine: WidgetEngine; loaderResult: WidgetLoaderResult }> {
  const engine = new WidgetEngine(vaultPath, vaultId);
  const loaderResult = await engine.initialize();
  return { engine, loaderResult };
}

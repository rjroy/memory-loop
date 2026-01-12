/**
 * Widgets Module - Barrel Export
 *
 * Public API for the vault widgets system. Import from this module
 * rather than individual files for stable API access.
 */

// =============================================================================
// Schemas and Types
// =============================================================================

export {
  // Schemas
  SimilarityMethodSchema,
  WidgetTypeSchema,
  WidgetLocationSchema,
  DisplayTypeSchema,
  EditableTypeSchema,
  FieldConfigSchema,
  DimensionConfigSchema,
  DisplayConfigSchema,
  EditableFieldSchema,
  SourceConfigSchema,
  WidgetConfigSchema,

  // Types
  type SimilarityMethod,
  type WidgetType,
  type WidgetLocation,
  type DisplayType,
  type EditableType,
  type FieldConfig,
  type DimensionConfig,
  type DisplayConfig,
  type EditableField,
  type SourceConfig,
  type WidgetConfig,

  // Utilities
  parseWidgetConfig,
  safeParseWidgetConfig,
  formatValidationError,
} from "./schemas";

// =============================================================================
// Widget Loader
// =============================================================================

export {
  loadWidgetConfigs,
  loadWidgetFile,
  validateWidgetConfig,
  WIDGETS_DIR,
  WIDGET_FILE_EXTENSIONS,
  type WidgetLoadResult,
  type WidgetLoaderResult,
} from "./widget-loader";

// =============================================================================
// Widget Engine
// =============================================================================

export {
  WidgetEngine,
  createWidgetEngine,
  type WidgetResult,
  type SimilarItem,
  type ComputeOptions,
} from "./widget-engine";

// =============================================================================
// Widget Cache
// =============================================================================

export {
  WidgetCache,
  createWidgetCache,
  CACHE_DB_PATH,
  type WidgetCacheEntry,
  type SimilarityCacheEntry,
} from "./widget-cache";

// =============================================================================
// Frontmatter Parsing
// =============================================================================

export {
  parseFrontmatter,
  extractField,
  extractFields,
  hasFrontmatter,
  FrontmatterParseError,
  type FrontmatterResult,
} from "./frontmatter";

// =============================================================================
// Aggregators
// =============================================================================

export {
  sum,
  avg,
  count,
  min,
  max,
  stddev,
  getAggregator,
  registerAggregator,
  listAggregators,
  hasAggregator,
  type Aggregator,
  type AggregatorInput,
  type AggregatorResult,
} from "./aggregators";

// =============================================================================
// Expression Evaluation
// =============================================================================

export {
  evaluateExpression,
  evaluateBatch,
  validateExpression,
  validateExpressionSecurity,
  getExpressionVariables,
  customFunctions,
  ExpressionSecurityError,
  ExpressionTimeoutError,
  ExpressionEvaluationError,
  type ExpressionContext,
  type EvaluateOptions,
  type BatchEvaluationResult,
} from "./expression-eval";

// =============================================================================
// Comparators
// =============================================================================

export {
  jaccardSimilarity,
  proximitySimilarity,
  cosineSimilarity,
  computeWeightedSimilarity,
  getComparator,
  registerComparator,
  listComparators,
  hasComparator,
  type Comparator,
  type ComparatorOptions,
  type ItemData,
  type WeightedSimilarityResult,
  type DimensionScore,
} from "./comparators";

// =============================================================================
// File Watcher
// =============================================================================

export {
  FileWatcher,
  createFileWatcher,
  type FileWatcherOptions,
} from "./file-watcher";

// =============================================================================
// Dependency Graph
// =============================================================================

export {
  buildDependencyGraph,
  topologicalSort,
  traceCyclePath,
  createComputationPlan,
  type DependencyGraph,
  type FieldScope,
  type SortResult,
  type ComputationPhase,
  type ComputationPlan,
} from "./dependency-graph";

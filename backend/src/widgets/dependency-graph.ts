/**
 * Dependency Graph for Widget Field Computation
 *
 * Builds and analyzes a directed acyclic graph (DAG) of field dependencies.
 * This module extracts dependencies from field configurations and determines
 * the computation order that respects all dependencies.
 *
 * Spec Requirements:
 * - REQ-F-1: Identify dependency relationships from `result.<fieldName>` references
 * - REQ-NF-2: Graph logic isolated in a dedicated module
 * - REQ-NF-3: Graph construction testable independent of file I/O
 *
 * Plan Reference:
 * - TD-1: Standalone module with pure functions
 * - TD-2: Adjacency list with Map<string, Set<string>> for dependencies
 * - TD-3: Dependency extraction from aggregator paths and expression variables
 */

import type { FieldConfig } from "./schemas";
import { getExpressionVariables } from "./expression-eval";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Field scope determines how a field's value is computed and accessed.
 *
 * - "collection": Operates across all items, produces single value (aggregators)
 * - "item": Operates per-item, produces value per item (expressions)
 *
 * Plan Reference: TD-7 (Per-Item vs Collection Context)
 */
export type FieldScope = "collection" | "item";

/**
 * Dependency graph representation (TD-2).
 *
 * Uses adjacency list with Map/Set for O(1) lookups and memory efficiency.
 */
export interface DependencyGraph {
  /** All field names in the graph */
  nodes: Set<string>;

  /** Maps each field to the set of fields it depends on */
  edges: Map<string, Set<string>>;

  /** Maps each field to its computation scope */
  scope: Map<string, FieldScope>;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Prefix used to reference computed field values in expressions and aggregator paths.
 */
const RESULT_PREFIX = "result.";

/**
 * Aggregator keys that can contain field path references.
 * The `count` aggregator is excluded because it takes a boolean, not a path.
 */
const AGGREGATOR_PATH_KEYS = ["sum", "avg", "min", "max", "stddev"] as const;

// =============================================================================
// Dependency Extraction
// =============================================================================

/**
 * Extract dependencies from an aggregator path.
 *
 * Aggregator paths like "result.normalized_score" indicate a dependency
 * on the "normalized_score" field.
 *
 * @param path - The aggregator source path (e.g., "bgg.rating" or "result.score")
 * @returns The field name if path references a result field, null otherwise
 *
 * Plan Reference: TD-3 (Aggregator fields strategy)
 */
function extractAggregatorDependency(path: string): string | null {
  if (path.startsWith(RESULT_PREFIX)) {
    return path.slice(RESULT_PREFIX.length);
  }
  return null;
}

/**
 * Extract dependencies from an expression string.
 *
 * Uses regex pattern matching to find `result.<fieldName>` references in the
 * expression text. This approach is necessary because `getExpressionVariables()`
 * returns only top-level variable names (e.g., "result"), not full property
 * access paths (e.g., "result.x").
 *
 * Security validation is still performed via getExpressionVariables() to ensure
 * the expression doesn't contain malicious constructs before extracting dependencies.
 *
 * @param expression - The expression string to analyze
 * @returns Array of field names referenced via result.*, empty if none or parse fails
 *
 * Plan Reference: TD-3 (Expression fields strategy)
 */
function extractExpressionDependencies(expression: string): string[] {
  // First validate expression security using the existing mechanism
  // This ensures malicious expressions are rejected before dependency extraction
  const variables = getExpressionVariables(expression);

  if (!variables) {
    // Expression parsing or security validation failed; return empty to avoid blocking
    // Invalid expressions will fail during evaluation with proper error messages
    return [];
  }

  // Use regex to find all result.<fieldName> patterns in the expression
  // Match word characters after "result." to capture field names
  const resultPattern = /result\.(\w+)/g;
  const dependencies: string[] = [];

  let match;
  while ((match = resultPattern.exec(expression)) !== null) {
    dependencies.push(match[1]); // Extract field name after "result."
  }

  // Deduplicate dependencies (same field may be referenced multiple times)
  return [...new Set(dependencies)];
}

/**
 * Determine the scope of a field based on its configuration.
 *
 * - Fields with any aggregator (count, sum, avg, min, max, stddev) are collection-scope
 * - Fields with only an expression are item-scope
 *
 * @param config - The field configuration
 * @returns The field's computation scope
 *
 * Plan Reference: TD-7 (Per-Item vs Collection Context)
 */
function determineFieldScope(config: FieldConfig): FieldScope {
  // Check for any aggregator operation
  const hasAggregator =
    config.count === true ||
    config.sum !== undefined ||
    config.avg !== undefined ||
    config.min !== undefined ||
    config.max !== undefined ||
    config.stddev !== undefined;

  return hasAggregator ? "collection" : "item";
}

/**
 * Extract all dependencies for a single field configuration.
 *
 * Combines dependencies from:
 * 1. Aggregator paths (sum, avg, min, max, stddev) that reference result.*
 * 2. Expression variables that reference result.*
 *
 * @param config - The field configuration to analyze
 * @returns Set of field names this field depends on
 */
function extractFieldDependencies(config: FieldConfig): Set<string> {
  const dependencies = new Set<string>();

  // Check aggregator paths
  for (const key of AGGREGATOR_PATH_KEYS) {
    const path = config[key];
    if (path !== undefined) {
      const dep = extractAggregatorDependency(path);
      if (dep !== null) {
        dependencies.add(dep);
      }
    }
  }

  // Check expression
  if (config.expr !== undefined) {
    const exprDeps = extractExpressionDependencies(config.expr);
    for (const dep of exprDeps) {
      dependencies.add(dep);
    }
  }

  return dependencies;
}

// =============================================================================
// Graph Construction
// =============================================================================

/**
 * Build a dependency graph from field configurations.
 *
 * Analyzes each field to:
 * 1. Add it as a node in the graph
 * 2. Determine its scope (collection or item)
 * 3. Extract dependencies from aggregator paths and expressions
 *
 * The resulting graph can be used for topological sorting and cycle detection.
 *
 * @param fields - Record of field name to field configuration
 * @returns DependencyGraph with nodes, edges, and scope information
 *
 * Spec Requirements: REQ-F-1 (identify dependency relationships)
 * Plan Reference: TD-1 (buildDependencyGraph function)
 */
export function buildDependencyGraph(fields: Record<string, FieldConfig>): DependencyGraph {
  const nodes = new Set<string>();
  const edges = new Map<string, Set<string>>();
  const scope = new Map<string, FieldScope>();

  for (const [fieldName, config] of Object.entries(fields)) {
    // Add node
    nodes.add(fieldName);

    // Determine scope
    scope.set(fieldName, determineFieldScope(config));

    // Extract dependencies
    const fieldDeps = extractFieldDependencies(config);

    // Filter dependencies to only include fields that exist in the config
    // This prevents false dependencies on undefined fields (which return null per REQ-F-4)
    const validDeps = new Set<string>();
    for (const dep of fieldDeps) {
      if (dep in fields) {
        validDeps.add(dep);
      }
    }

    edges.set(fieldName, validDeps);
  }

  return { nodes, edges, scope };
}

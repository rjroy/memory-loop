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

/**
 * Result of topological sort (TD-2 Data Model).
 *
 * Contains the sorted execution order and any detected cycles.
 */
export interface SortResult {
  /** Fields in valid execution order (dependencies before dependents) */
  sorted: string[];

  /** Arrays of cycle paths (each cycle as an array of field names); empty if no cycles */
  cycles: string[][];
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

// =============================================================================
// Topological Sort
// =============================================================================

/**
 * Perform topological sort using Kahn's algorithm (TD-4).
 *
 * Kahn's algorithm uses a BFS approach:
 * 1. Calculate in-degree (number of incoming edges) for each node
 * 2. Add all nodes with in-degree 0 to a queue
 * 3. While queue not empty:
 *    - Remove node from queue, add to sorted output
 *    - For each dependent of this node, decrease its in-degree
 *    - If dependent's in-degree becomes 0, add to queue
 * 4. If sorted output has fewer nodes than graph, remaining nodes are in cycles
 *
 * Time complexity: O(V+E) where V = nodes, E = edges
 *
 * @param graph - The dependency graph to sort
 * @returns SortResult with sorted fields and cycle information
 *
 * Spec Requirements:
 * - REQ-F-2: Determine computation order that respects dependencies
 * - REQ-F-9: Detect dependency cycles before computation begins
 *
 * Plan Reference: TD-4 (Kahn's algorithm)
 */
export function topologicalSort(graph: DependencyGraph): SortResult {
  const { nodes, edges } = graph;

  // Build reverse adjacency list: field -> fields that depend on it (dependents)
  // This is needed because `edges` maps field -> dependencies, but Kahn's algorithm
  // needs to know which fields to update when a dependency is satisfied.
  const dependents = new Map<string, Set<string>>();
  for (const node of nodes) {
    dependents.set(node, new Set());
  }
  for (const [field, deps] of edges) {
    for (const dep of deps) {
      // If dep exists in the graph, add field as a dependent of dep
      if (dependents.has(dep)) {
        dependents.get(dep)!.add(field);
      }
    }
  }

  // Calculate in-degree for each node (number of dependencies)
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    const deps = edges.get(node) ?? new Set();
    inDegree.set(node, deps.size);
  }

  // Initialize queue with nodes that have no dependencies (in-degree = 0)
  // Use an array as a queue, maintaining insertion order for stability
  const queue: string[] = [];
  for (const node of nodes) {
    if (inDegree.get(node) === 0) {
      queue.push(node);
    }
  }

  // Process queue: extract nodes in dependency order
  const sorted: string[] = [];

  while (queue.length > 0) {
    // Remove first node from queue (FIFO for stability)
    const node = queue.shift()!;
    sorted.push(node);

    // For each field that depends on this node, decrease its in-degree
    const nodeDependents = dependents.get(node) ?? new Set();
    for (const dependent of nodeDependents) {
      const currentInDegree = inDegree.get(dependent)!;
      const newInDegree = currentInDegree - 1;
      inDegree.set(dependent, newInDegree);

      // If dependent now has all dependencies satisfied, add to queue
      if (newInDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // Identify cycle participants: nodes not in sorted output
  // Per Kahn's algorithm, remaining nodes with non-zero in-degree form cycles
  const cycleParticipants: string[] = [];
  for (const node of nodes) {
    if (!sorted.includes(node)) {
      cycleParticipants.push(node);
    }
  }

  // Build cycle arrays from participants
  // For now, group all cycle participants into a single cycle representation
  // TASK-003 will enhance this with proper cycle path tracing
  const cycles: string[][] = [];
  if (cycleParticipants.length > 0) {
    cycles.push(cycleParticipants);
  }

  return { sorted, cycles };
}

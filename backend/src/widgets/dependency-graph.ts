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

/**
 * A single phase of field computation.
 *
 * Fields within a phase can be computed in any order, but all fields
 * in earlier phases must complete before later phases begin.
 *
 * Plan Reference: TD-2 (Data Model)
 */
export interface ComputationPhase {
  /** Scope of fields in this phase (collection or item) */
  scope: FieldScope;

  /** Fields to compute in this phase */
  fields: string[];
}

/**
 * Complete computation plan for widget fields.
 *
 * Produced by createComputationPlan() after building and sorting the dependency graph.
 * Contains the execution phases, cycle information, and any warning messages.
 *
 * Plan Reference: TD-2 (Data Model), TD-5 (Cycle Handling Strategy)
 */
export interface ComputationPlan {
  /** Ordered execution phases; each phase's fields must complete before the next begins */
  phases: ComputationPhase[];

  /** Fields to skip due to cycles (their result will be null) */
  cycleFields: Set<string>;

  /** Warning messages for cycles and other issues (logged but no exceptions thrown) */
  warnings: string[];
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
 * - Fields with any aggregator (count, sum, avg, min, max, stddev, similarity) are collection-scope
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
    config.stddev !== undefined ||
    config.similarity !== undefined;

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

  // Build cycle arrays from participants using traceCyclePath
  const cycles: string[][] = [];
  if (cycleParticipants.length > 0) {
    // Track which participants have been assigned to a cycle
    const assigned = new Set<string>();

    for (const participant of cycleParticipants) {
      if (!assigned.has(participant)) {
        // Trace the cycle starting from this participant
        const cyclePath = traceCyclePath(graph, participant, cycleParticipants);

        // Mark all nodes in this cycle as assigned
        for (const node of cyclePath) {
          assigned.add(node);
        }

        cycles.push(cyclePath);
      }
    }
  }

  return { sorted, cycles };
}

// =============================================================================
// Cycle Path Tracing
// =============================================================================

/**
 * Trace a cycle path starting from a given node.
 *
 * Given a set of cycle participants (nodes with non-zero in-degree after Kahn's algorithm),
 * this function follows the dependency edges to trace the actual cycle path.
 *
 * Algorithm:
 * 1. Start at the given node
 * 2. Follow dependencies that are also cycle participants
 * 3. Continue until returning to the start node
 * 4. Return the path as an array of field names
 *
 * The returned path forms a cycle: the last element depends on the first.
 * For example, ["a", "b", "c"] represents a -> b -> c -> a.
 *
 * @param graph - The dependency graph
 * @param startNode - The node to start tracing from (must be a cycle participant)
 * @param cycleParticipants - All nodes identified as cycle participants
 * @returns Array of field names forming the cycle path
 *
 * Spec Requirements: REQ-F-11 (cycle errors include cycle path)
 * Plan Reference: TD-5 (trace cycle path for error message)
 */
export function traceCyclePath(
  graph: DependencyGraph,
  startNode: string,
  cycleParticipants: string[]
): string[] {
  const participantSet = new Set(cycleParticipants);
  const path: string[] = [startNode];
  const visited = new Set<string>([startNode]);

  let current = startNode;

  // Follow dependencies that are also cycle participants
  while (true) {
    const deps = graph.edges.get(current) ?? new Set();

    // Find a dependency that is a cycle participant and leads back to start
    // or continues the cycle
    let nextNode: string | null = null;

    for (const dep of deps) {
      if (participantSet.has(dep)) {
        if (dep === startNode) {
          // We've completed the cycle, return the path
          return path;
        }
        if (!visited.has(dep)) {
          // Continue following the cycle
          nextNode = dep;
          break;
        }
      }
    }

    if (nextNode === null) {
      // No unvisited cycle participant found in dependencies
      // This can happen with complex interconnected cycles
      // Return what we have (the path represents a partial cycle)
      return path;
    }

    path.push(nextNode);
    visited.add(nextNode);
    current = nextNode;
  }
}

/**
 * Format a cycle path as a human-readable error message.
 *
 * Converts a cycle path array into a string like "a -> b -> c -> a"
 * where the final arrow points back to the first node to show the cycle.
 *
 * @param cyclePath - Array of field names in the cycle
 * @returns Formatted string showing the cycle
 *
 * Spec Requirements: REQ-NF-4 (error messages include field names, not internal IDs)
 */
function formatCyclePath(cyclePath: string[]): string {
  if (cyclePath.length === 0) {
    return "";
  }

  // Add the first node at the end to show the cycle completing
  return [...cyclePath, cyclePath[0]].join(" -> ");
}

// =============================================================================
// Computation Plan Creation
// =============================================================================

/**
 * Create a computation plan from field configurations.
 *
 * This is the main entry point for preparing widget field computation.
 * It builds the dependency graph, performs topological sort, detects cycles,
 * and organizes fields into execution phases.
 *
 * Cycle handling (TD-5):
 * - Fields in cycles are added to cycleFields set (they return null)
 * - Warning messages are generated for each cycle (logged, not thrown)
 * - Non-cycle fields are organized into phases and computed normally
 *
 * Phase organization (TD-7):
 * - Fields are grouped by scope (collection vs item)
 * - All item-scope dependencies must complete before collection-scope fields
 *   that depend on them (e.g., aggregating per-item expression results)
 *
 * @param fields - Record of field name to field configuration
 * @returns ComputationPlan with phases, cycle fields, and warnings
 *
 * Spec Requirements:
 * - REQ-F-9: Detect dependency cycles before computation begins
 * - REQ-F-10: Fields in cycles return null; non-cycle fields compute normally
 * - REQ-F-11: Cycle errors include cycle path
 * - REQ-F-12: Log cycle warnings but do not throw exceptions
 * - REQ-NF-4: Error messages include field names, not internal IDs
 *
 * Plan Reference: TD-5 (Cycle Handling Strategy)
 */
export function createComputationPlan(fields: Record<string, FieldConfig>): ComputationPlan {
  // Build the dependency graph from field configurations
  const graph = buildDependencyGraph(fields);

  // Perform topological sort to get execution order and detect cycles
  const sortResult = topologicalSort(graph);

  // Initialize result structures
  const cycleFields = new Set<string>();
  const warnings: string[] = [];

  // Process cycles: add to cycleFields and generate warning messages
  for (const cyclePath of sortResult.cycles) {
    // Add all nodes in this cycle to the cycleFields set
    for (const field of cyclePath) {
      cycleFields.add(field);
    }

    // Generate human-readable warning message (REQ-F-11, REQ-NF-4)
    const formattedPath = formatCyclePath(cyclePath);
    warnings.push(`Cycle detected: ${formattedPath}`);
  }

  // Build computation phases from sorted fields
  // Group consecutive fields with the same scope into phases
  const phases: ComputationPhase[] = [];

  for (const field of sortResult.sorted) {
    const fieldScope = graph.scope.get(field) ?? "item";

    // Check if we can add to the current phase (same scope)
    // or need to start a new phase
    const lastPhase = phases[phases.length - 1];

    if (lastPhase && lastPhase.scope === fieldScope) {
      // Add to existing phase
      lastPhase.fields.push(field);
    } else {
      // Start a new phase
      phases.push({
        scope: fieldScope,
        fields: [field],
      });
    }
  }

  return {
    phases,
    cycleFields,
    warnings,
  };
}

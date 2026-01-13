/**
 * Widget Includes Resolution
 *
 * Handles widget-level includes: resolving dependencies between widgets,
 * detecting circular dependencies, and determining computation order.
 *
 * When a widget specifies `includes: ["Widget A", "Widget B"]`, it can
 * access the stats and results of those widgets in its expressions.
 *
 * Circular dependencies (A includes B, B includes A) are detected and
 * reported as errors to the HealthPanel. Widgets in a cycle cannot be
 * computed and will show an error state.
 */

import type { WidgetConfig } from "./schemas";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * A loaded widget with its configuration and identifier.
 */
export interface LoadedWidget {
  id: string;
  filePath: string;
  config: WidgetConfig;
}

/**
 * Result of resolving widget includes.
 */
export interface IncludesResolution {
  /**
   * Widgets in valid computation order (dependencies before dependents).
   * Widgets not involved in cycles are included here.
   */
  computationOrder: string[];

  /**
   * Widget names that are part of a circular dependency.
   * These widgets cannot be computed.
   */
  cycleWidgets: Set<string>;

  /**
   * Human-readable cycle descriptions for error reporting.
   * Each entry describes one cycle (e.g., "Widget A -> Widget B -> Widget A").
   */
  cycleDescriptions: string[];

  /**
   * Widgets with invalid includes (referencing non-existent widgets).
   * Maps widget name to array of invalid include names.
   */
  invalidIncludes: Map<string, string[]>;
}

/**
 * Dependency graph for widgets.
 */
interface WidgetGraph {
  /** All widget names */
  nodes: Set<string>;

  /** Maps widget name -> set of widget names it includes (depends on) */
  edges: Map<string, Set<string>>;
}

// =============================================================================
// Graph Construction
// =============================================================================

/**
 * Build a dependency graph from loaded widgets.
 *
 * Creates a graph where edges represent include relationships:
 * if Widget A includes Widget B, there's an edge from A to B.
 *
 * @param widgets - Array of loaded widgets
 * @returns Widget dependency graph and map of name -> widget
 */
export function buildWidgetGraph(
  widgets: LoadedWidget[]
): { graph: WidgetGraph; widgetsByName: Map<string, LoadedWidget> } {
  const nodes = new Set<string>();
  const edges = new Map<string, Set<string>>();
  const widgetsByName = new Map<string, LoadedWidget>();

  // First pass: collect all widget names
  for (const widget of widgets) {
    nodes.add(widget.config.name);
    widgetsByName.set(widget.config.name, widget);
    edges.set(widget.config.name, new Set());
  }

  // Second pass: build edges from includes
  for (const widget of widgets) {
    const includes = widget.config.includes ?? [];
    const widgetEdges = edges.get(widget.config.name)!;

    for (const includeName of includes) {
      // Only add edge if the included widget exists
      if (nodes.has(includeName)) {
        widgetEdges.add(includeName);
      }
    }
  }

  return { graph: { nodes, edges }, widgetsByName };
}

// =============================================================================
// Topological Sort (Kahn's Algorithm)
// =============================================================================

/**
 * Perform topological sort on the widget dependency graph.
 *
 * Uses Kahn's algorithm to find a valid computation order where
 * dependencies are computed before their dependents.
 *
 * @param graph - Widget dependency graph
 * @returns Sorted widget names and cycle participants
 */
function topologicalSort(graph: WidgetGraph): {
  sorted: string[];
  cycleParticipants: string[];
} {
  const { nodes, edges } = graph;

  // Build reverse adjacency: widget -> widgets that depend on it
  const dependents = new Map<string, Set<string>>();
  for (const node of nodes) {
    dependents.set(node, new Set());
  }
  for (const [widget, deps] of edges) {
    for (const dep of deps) {
      if (dependents.has(dep)) {
        dependents.get(dep)!.add(widget);
      }
    }
  }

  // Calculate in-degree (number of dependencies)
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    inDegree.set(node, edges.get(node)?.size ?? 0);
  }

  // Initialize queue with widgets that have no dependencies
  const queue: string[] = [];
  for (const node of nodes) {
    if (inDegree.get(node) === 0) {
      queue.push(node);
    }
  }

  // Process queue
  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);

    // Update dependents
    for (const dependent of dependents.get(node) ?? new Set()) {
      const newInDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newInDegree);
      if (newInDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // Remaining nodes with non-zero in-degree are in cycles
  const cycleParticipants: string[] = [];
  for (const node of nodes) {
    if (!sorted.includes(node)) {
      cycleParticipants.push(node);
    }
  }

  return { sorted, cycleParticipants };
}

// =============================================================================
// Cycle Path Tracing
// =============================================================================

/**
 * Trace cycle paths from cycle participants.
 *
 * Given nodes known to be in cycles, traces the actual cycle paths
 * for human-readable error messages.
 *
 * @param graph - Widget dependency graph
 * @param cycleParticipants - Widgets known to be in cycles
 * @returns Array of cycle paths (each path is array of widget names)
 */
function traceCycles(graph: WidgetGraph, cycleParticipants: string[]): string[][] {
  if (cycleParticipants.length === 0) {
    return [];
  }

  const participantSet = new Set(cycleParticipants);
  const assigned = new Set<string>();
  const cycles: string[][] = [];

  for (const start of cycleParticipants) {
    if (assigned.has(start)) {
      continue;
    }

    // Trace cycle from this node
    const path: string[] = [start];
    const visited = new Set<string>([start]);
    let current = start;

    while (true) {
      const deps = graph.edges.get(current) ?? new Set();
      let nextNode: string | null = null;

      for (const dep of deps) {
        if (participantSet.has(dep)) {
          if (dep === start && path.length > 1) {
            // Completed the cycle
            for (const node of path) {
              assigned.add(node);
            }
            cycles.push(path);
            nextNode = null;
            break;
          }
          if (!visited.has(dep)) {
            nextNode = dep;
            break;
          }
        }
      }

      if (nextNode === null) {
        // If we didn't complete a cycle, mark what we found
        for (const node of path) {
          assigned.add(node);
        }
        if (path.length > 1) {
          cycles.push(path);
        }
        break;
      }

      path.push(nextNode);
      visited.add(nextNode);
      current = nextNode;
    }
  }

  return cycles;
}

/**
 * Format a cycle path as a human-readable string.
 *
 * @param cyclePath - Array of widget names in the cycle
 * @returns Formatted string like "A -> B -> C -> A"
 */
function formatCyclePath(cyclePath: string[]): string {
  if (cyclePath.length === 0) {
    return "";
  }
  return [...cyclePath, cyclePath[0]].join(" -> ");
}

// =============================================================================
// Main Resolution Function
// =============================================================================

/**
 * Resolve widget includes and detect circular dependencies.
 *
 * This function:
 * 1. Builds a dependency graph from widget includes
 * 2. Validates that all includes reference existing widgets
 * 3. Detects circular dependencies
 * 4. Returns a valid computation order for non-cyclic widgets
 *
 * Widgets in a cycle cannot be computed - their results will be unavailable.
 * The cycle information is returned for error reporting to the HealthPanel.
 *
 * @param widgets - Array of loaded widgets
 * @returns Resolution result with computation order and cycle information
 */
export function resolveWidgetIncludes(widgets: LoadedWidget[]): IncludesResolution {
  // Build the dependency graph
  const { graph, widgetsByName } = buildWidgetGraph(widgets);

  // Validate includes (check for references to non-existent widgets)
  const invalidIncludes = new Map<string, string[]>();
  for (const widget of widgets) {
    const includes = widget.config.includes ?? [];
    const invalid: string[] = [];

    for (const includeName of includes) {
      if (!widgetsByName.has(includeName)) {
        invalid.push(includeName);
      }
    }

    if (invalid.length > 0) {
      invalidIncludes.set(widget.config.name, invalid);
    }
  }

  // Perform topological sort to find computation order and cycles
  const { sorted, cycleParticipants } = topologicalSort(graph);

  // Trace cycle paths for error messages
  const cyclePaths = traceCycles(graph, cycleParticipants);
  const cycleDescriptions = cyclePaths.map(formatCyclePath);

  return {
    computationOrder: sorted,
    cycleWidgets: new Set(cycleParticipants),
    cycleDescriptions,
    invalidIncludes,
  };
}

// =============================================================================
// Include Chain Resolution
// =============================================================================

/**
 * Get the transitive closure of includes for a widget.
 *
 * Returns all widgets that should be included (directly or transitively)
 * in the computation context for the given widget.
 *
 * @param widgetName - The widget to resolve includes for
 * @param widgetsByName - Map of widget name to widget
 * @param cycleWidgets - Set of widgets in cycles (excluded from resolution)
 * @returns Array of widget names to include (in dependency order)
 */
export function getIncludeChain(
  widgetName: string,
  widgetsByName: Map<string, LoadedWidget>,
  cycleWidgets: Set<string>
): string[] {
  const widget = widgetsByName.get(widgetName);
  if (!widget || cycleWidgets.has(widgetName)) {
    return [];
  }

  const result: string[] = [];
  const visited = new Set<string>();

  // DFS to collect all transitive includes
  function collectIncludes(name: string): void {
    if (visited.has(name) || cycleWidgets.has(name)) {
      return;
    }
    visited.add(name);

    const w = widgetsByName.get(name);
    if (!w) {
      return;
    }

    // First collect dependencies (depth-first)
    for (const include of w.config.includes ?? []) {
      collectIncludes(include);
    }

    // Then add this widget (after its dependencies)
    if (name !== widgetName) {
      result.push(name);
    }
  }

  // Start from the widget's direct includes
  for (const include of widget.config.includes ?? []) {
    collectIncludes(include);
  }

  return result;
}

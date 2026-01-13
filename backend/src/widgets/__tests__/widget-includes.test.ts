/**
 * Tests for Widget Includes Resolution
 *
 * Tests the widget-level include system:
 * - Dependency graph construction
 * - Circular dependency detection
 * - Include chain resolution
 * - Invalid include validation
 */

import { describe, test, expect } from "bun:test";
import {
  buildWidgetGraph,
  resolveWidgetIncludes,
  getIncludeChain,
  type LoadedWidget,
} from "../widget-includes";
import type { WidgetConfig } from "../schemas";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a minimal widget config for testing.
 */
function createWidgetConfig(name: string, includes?: string[]): WidgetConfig {
  return {
    name,
    type: "aggregate",
    location: "ground",
    source: { pattern: "**/*.md" },
    fields: { count: { count: true } },
    display: { type: "summary-card" },
    includes,
  };
}

/**
 * Create a loaded widget for testing.
 */
function createLoadedWidget(name: string, includes?: string[]): LoadedWidget {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    filePath: `.memory-loop/widgets/${name.toLowerCase().replace(/\s+/g, "-")}.yaml`,
    config: createWidgetConfig(name, includes),
  };
}

// =============================================================================
// buildWidgetGraph Tests
// =============================================================================

describe("buildWidgetGraph", () => {
  test("creates empty graph for empty widget list", () => {
    const { graph, widgetsByName } = buildWidgetGraph([]);

    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.size).toBe(0);
    expect(widgetsByName.size).toBe(0);
  });

  test("creates graph with single widget (no includes)", () => {
    const widgets = [createLoadedWidget("Widget A")];
    const { graph, widgetsByName } = buildWidgetGraph(widgets);

    expect(graph.nodes.size).toBe(1);
    expect(graph.nodes.has("Widget A")).toBe(true);
    expect(graph.edges.get("Widget A")?.size).toBe(0);
    expect(widgetsByName.has("Widget A")).toBe(true);
  });

  test("creates edges for widget includes", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B"),
    ];
    const { graph } = buildWidgetGraph(widgets);

    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.get("Widget A")?.has("Widget B")).toBe(true);
    expect(graph.edges.get("Widget B")?.size).toBe(0);
  });

  test("ignores includes referencing non-existent widgets", () => {
    const widgets = [createLoadedWidget("Widget A", ["NonExistent"])];
    const { graph } = buildWidgetGraph(widgets);

    // Edge should not be created for non-existent widget
    expect(graph.edges.get("Widget A")?.has("NonExistent")).toBe(false);
    expect(graph.edges.get("Widget A")?.size).toBe(0);
  });

  test("handles multiple includes", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B", "Widget C"]),
      createLoadedWidget("Widget B"),
      createLoadedWidget("Widget C"),
    ];
    const { graph } = buildWidgetGraph(widgets);

    expect(graph.edges.get("Widget A")?.size).toBe(2);
    expect(graph.edges.get("Widget A")?.has("Widget B")).toBe(true);
    expect(graph.edges.get("Widget A")?.has("Widget C")).toBe(true);
  });
});

// =============================================================================
// resolveWidgetIncludes Tests - Basic Resolution
// =============================================================================

describe("resolveWidgetIncludes - basic resolution", () => {
  test("returns all widgets in computation order when no includes", () => {
    const widgets = [
      createLoadedWidget("Widget A"),
      createLoadedWidget("Widget B"),
      createLoadedWidget("Widget C"),
    ];
    const result = resolveWidgetIncludes(widgets);

    expect(result.computationOrder).toHaveLength(3);
    expect(result.cycleWidgets.size).toBe(0);
    expect(result.cycleDescriptions).toHaveLength(0);
    expect(result.invalidIncludes.size).toBe(0);
  });

  test("puts dependencies before dependents in computation order", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B"),
    ];
    const result = resolveWidgetIncludes(widgets);

    expect(result.computationOrder).toHaveLength(2);
    const indexA = result.computationOrder.indexOf("Widget A");
    const indexB = result.computationOrder.indexOf("Widget B");
    expect(indexB).toBeLessThan(indexA); // B should come before A
  });

  test("handles deep include chains", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B", ["Widget C"]),
      createLoadedWidget("Widget C"),
    ];
    const result = resolveWidgetIncludes(widgets);

    expect(result.computationOrder).toHaveLength(3);
    const indexA = result.computationOrder.indexOf("Widget A");
    const indexB = result.computationOrder.indexOf("Widget B");
    const indexC = result.computationOrder.indexOf("Widget C");
    expect(indexC).toBeLessThan(indexB); // C before B
    expect(indexB).toBeLessThan(indexA); // B before A
  });

  test("handles diamond dependency pattern", () => {
    // A includes B and C, B and C both include D
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B", "Widget C"]),
      createLoadedWidget("Widget B", ["Widget D"]),
      createLoadedWidget("Widget C", ["Widget D"]),
      createLoadedWidget("Widget D"),
    ];
    const result = resolveWidgetIncludes(widgets);

    expect(result.computationOrder).toHaveLength(4);
    expect(result.cycleWidgets.size).toBe(0);

    const indexA = result.computationOrder.indexOf("Widget A");
    const indexB = result.computationOrder.indexOf("Widget B");
    const indexC = result.computationOrder.indexOf("Widget C");
    const indexD = result.computationOrder.indexOf("Widget D");

    expect(indexD).toBeLessThan(indexB); // D before B
    expect(indexD).toBeLessThan(indexC); // D before C
    expect(indexB).toBeLessThan(indexA); // B before A
    expect(indexC).toBeLessThan(indexA); // C before A
  });
});

// =============================================================================
// resolveWidgetIncludes Tests - Cycle Detection
// =============================================================================

describe("resolveWidgetIncludes - cycle detection", () => {
  test("detects simple two-widget cycle", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B", ["Widget A"]),
    ];
    const result = resolveWidgetIncludes(widgets);

    expect(result.cycleWidgets.size).toBe(2);
    expect(result.cycleWidgets.has("Widget A")).toBe(true);
    expect(result.cycleWidgets.has("Widget B")).toBe(true);
    expect(result.cycleDescriptions.length).toBeGreaterThan(0);
    expect(result.computationOrder).toHaveLength(0); // Both in cycle
  });

  test("detects self-referencing widget", () => {
    const widgets = [createLoadedWidget("Widget A", ["Widget A"])];
    const result = resolveWidgetIncludes(widgets);

    expect(result.cycleWidgets.size).toBe(1);
    expect(result.cycleWidgets.has("Widget A")).toBe(true);
  });

  test("detects three-widget cycle", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B", ["Widget C"]),
      createLoadedWidget("Widget C", ["Widget A"]),
    ];
    const result = resolveWidgetIncludes(widgets);

    expect(result.cycleWidgets.size).toBe(3);
    expect(result.cycleWidgets.has("Widget A")).toBe(true);
    expect(result.cycleWidgets.has("Widget B")).toBe(true);
    expect(result.cycleWidgets.has("Widget C")).toBe(true);
  });

  test("widgets not in cycle are still computed", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B", ["Widget A"]),
      createLoadedWidget("Widget C"), // Not in cycle
    ];
    const result = resolveWidgetIncludes(widgets);

    expect(result.cycleWidgets.size).toBe(2);
    expect(result.cycleWidgets.has("Widget C")).toBe(false);
    expect(result.computationOrder).toContain("Widget C");
  });

  test("cycle description includes widget names", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B", ["Widget A"]),
    ];
    const result = resolveWidgetIncludes(widgets);

    expect(result.cycleDescriptions.length).toBeGreaterThan(0);
    const desc = result.cycleDescriptions[0];
    expect(desc).toContain("Widget A");
    expect(desc).toContain("Widget B");
    expect(desc).toContain("->"); // Arrow notation
  });
});

// =============================================================================
// resolveWidgetIncludes Tests - Invalid Includes
// =============================================================================

describe("resolveWidgetIncludes - invalid includes", () => {
  test("detects single invalid include", () => {
    const widgets = [createLoadedWidget("Widget A", ["NonExistent"])];
    const result = resolveWidgetIncludes(widgets);

    expect(result.invalidIncludes.size).toBe(1);
    expect(result.invalidIncludes.get("Widget A")).toContain("NonExistent");
  });

  test("detects multiple invalid includes", () => {
    const widgets = [createLoadedWidget("Widget A", ["Foo", "Bar", "Widget B"]), createLoadedWidget("Widget B")];
    const result = resolveWidgetIncludes(widgets);

    expect(result.invalidIncludes.size).toBe(1);
    const invalid = result.invalidIncludes.get("Widget A")!;
    expect(invalid).toContain("Foo");
    expect(invalid).toContain("Bar");
    expect(invalid).not.toContain("Widget B"); // Valid include
  });

  test("widget with invalid include is still computed", () => {
    const widgets = [createLoadedWidget("Widget A", ["NonExistent"])];
    const result = resolveWidgetIncludes(widgets);

    expect(result.computationOrder).toContain("Widget A");
    expect(result.cycleWidgets.has("Widget A")).toBe(false);
  });

  test("no invalid includes when all includes exist", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B"),
    ];
    const result = resolveWidgetIncludes(widgets);

    expect(result.invalidIncludes.size).toBe(0);
  });
});

// =============================================================================
// getIncludeChain Tests
// =============================================================================

describe("getIncludeChain", () => {
  test("returns empty array for widget without includes", () => {
    const widgets = [createLoadedWidget("Widget A")];
    const { widgetsByName } = buildWidgetGraph(widgets);
    const chain = getIncludeChain("Widget A", widgetsByName, new Set());

    expect(chain).toHaveLength(0);
  });

  test("returns direct includes", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B"),
    ];
    const { widgetsByName } = buildWidgetGraph(widgets);
    const chain = getIncludeChain("Widget A", widgetsByName, new Set());

    expect(chain).toHaveLength(1);
    expect(chain).toContain("Widget B");
  });

  test("returns transitive includes in dependency order", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B", ["Widget C"]),
      createLoadedWidget("Widget C"),
    ];
    const { widgetsByName } = buildWidgetGraph(widgets);
    const chain = getIncludeChain("Widget A", widgetsByName, new Set());

    expect(chain).toHaveLength(2);
    expect(chain.indexOf("Widget C")).toBeLessThan(chain.indexOf("Widget B"));
  });

  test("excludes widgets in cycles", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B", "Widget C"]),
      createLoadedWidget("Widget B", ["Widget C"]),
      createLoadedWidget("Widget C", ["Widget B"]), // Cycle with B
    ];
    const { widgetsByName } = buildWidgetGraph(widgets);
    const cycleWidgets = new Set(["Widget B", "Widget C"]);
    const chain = getIncludeChain("Widget A", widgetsByName, cycleWidgets);

    expect(chain).toHaveLength(0); // All includes are in cycles
  });

  test("returns empty array for widget in cycle", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B", ["Widget A"]),
    ];
    const { widgetsByName } = buildWidgetGraph(widgets);
    const cycleWidgets = new Set(["Widget A", "Widget B"]);
    const chain = getIncludeChain("Widget A", widgetsByName, cycleWidgets);

    expect(chain).toHaveLength(0);
  });

  test("returns empty array for non-existent widget", () => {
    const widgets = [createLoadedWidget("Widget A")];
    const { widgetsByName } = buildWidgetGraph(widgets);
    const chain = getIncludeChain("NonExistent", widgetsByName, new Set());

    expect(chain).toHaveLength(0);
  });

  test("does not include the widget itself in its chain", () => {
    const widgets = [
      createLoadedWidget("Widget A", ["Widget B"]),
      createLoadedWidget("Widget B"),
    ];
    const { widgetsByName } = buildWidgetGraph(widgets);
    const chain = getIncludeChain("Widget A", widgetsByName, new Set());

    expect(chain).not.toContain("Widget A");
  });
});

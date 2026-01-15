/**
 * Dependency Graph Tests
 *
 * Unit tests for the dependency graph module that extracts field dependencies
 * from widget configurations.
 */

import { describe, test, expect } from "bun:test";
import { buildDependencyGraph } from "../dependency-graph";
import type { FieldConfig } from "../schemas";

// =============================================================================
// extractExpressionDependencies Tests (via buildDependencyGraph)
// =============================================================================

describe("extractExpressionDependencies", () => {
  // Since extractExpressionDependencies is a private function, we test it
  // indirectly through buildDependencyGraph which uses it internally.

  test("extracts single result.field dependency", () => {
    const fields: Record<string, FieldConfig> = {
      x: { sum: "this.value" },
      y: { expr: "result.x * 2" },
    };

    const graph = buildDependencyGraph(fields);

    // y should depend on x
    expect(graph.edges.get("y")).toEqual(new Set(["x"]));
    // x should have no dependencies
    expect(graph.edges.get("x")).toEqual(new Set());
  });

  test("extracts multiple result.field dependencies", () => {
    const fields: Record<string, FieldConfig> = {
      a: { sum: "this.val" },
      b: { avg: "this.val" },
      c: { expr: "result.a + result.b" },
    };

    const graph = buildDependencyGraph(fields);

    // c should depend on both a and b
    expect(graph.edges.get("c")).toEqual(new Set(["a", "b"]));
  });

  test("extracts nested result.field in function calls", () => {
    const fields: Record<string, FieldConfig> = {
      mean: { avg: "this.rating" },
      stddev: { stddev: "this.rating" },
      zscore: { expr: "zscore(this.rating, result.mean, result.stddev)" },
    };

    const graph = buildDependencyGraph(fields);

    // zscore should depend on mean and stddev
    expect(graph.edges.get("zscore")).toEqual(new Set(["mean", "stddev"]));
  });

  test("deduplicates repeated references to same field", () => {
    const fields: Record<string, FieldConfig> = {
      total: { sum: "this.value" },
      doubled: { expr: "result.total + result.total" },
    };

    const graph = buildDependencyGraph(fields);

    // Should have only one dependency on total (deduplicated)
    expect(graph.edges.get("doubled")).toEqual(new Set(["total"]));
  });

  test("ignores non-existent field references", () => {
    const fields: Record<string, FieldConfig> = {
      a: { sum: "this.value" },
      b: { expr: "result.a + result.nonexistent" },
    };

    const graph = buildDependencyGraph(fields);

    // b should only depend on a (nonexistent is filtered out)
    expect(graph.edges.get("b")).toEqual(new Set(["a"]));
  });

  test("returns empty set for expressions without result references", () => {
    const fields: Record<string, FieldConfig> = {
      normalized: { expr: "this.value / 100" },
    };

    const graph = buildDependencyGraph(fields);

    // No dependencies since no result.* references
    expect(graph.edges.get("normalized")).toEqual(new Set());
  });

  test("returns empty set for invalid expressions", () => {
    const fields: Record<string, FieldConfig> = {
      invalid: { expr: "(unclosed paren" },
    };

    const graph = buildDependencyGraph(fields);

    // Invalid expression should result in no dependencies (not throw)
    expect(graph.edges.get("invalid")).toEqual(new Set());
  });

  test("returns empty set for security-violating expressions", () => {
    const fields: Record<string, FieldConfig> = {
      malicious: { expr: "require('fs')" },
    };

    const graph = buildDependencyGraph(fields);

    // Security violation should result in no dependencies (not throw)
    expect(graph.edges.get("malicious")).toEqual(new Set());
  });
});

// =============================================================================
// buildDependencyGraph Tests
// =============================================================================

describe("buildDependencyGraph", () => {
  test("creates nodes for all fields", () => {
    const fields: Record<string, FieldConfig> = {
      field1: { count: true },
      field2: { sum: "this.value" },
      field3: { expr: "this.x * 2" },
    };

    const graph = buildDependencyGraph(fields);

    expect(graph.nodes).toEqual(new Set(["field1", "field2", "field3"]));
  });

  test("identifies collection scope for aggregator fields", () => {
    const fields: Record<string, FieldConfig> = {
      total: { count: true },
      sum_val: { sum: "this.value" },
      avg_val: { avg: "this.value" },
    };

    const graph = buildDependencyGraph(fields);

    expect(graph.scope.get("total")).toBe("collection");
    expect(graph.scope.get("sum_val")).toBe("collection");
    expect(graph.scope.get("avg_val")).toBe("collection");
  });

  test("identifies collection scope for similarity aggregator fields", () => {
    const fields: Record<string, FieldConfig> = {
      weighted_rating: {
        similarity: { ref: "Similar Items", field: "rating" },
      },
    };

    const graph = buildDependencyGraph(fields);

    expect(graph.scope.get("weighted_rating")).toBe("collection");
  });

  test("identifies item scope for expression-only fields", () => {
    const fields: Record<string, FieldConfig> = {
      normalized: { expr: "this.value / 100" },
      doubled: { expr: "this.x * 2" },
    };

    const graph = buildDependencyGraph(fields);

    expect(graph.scope.get("normalized")).toBe("item");
    expect(graph.scope.get("doubled")).toBe("item");
  });

  test("extracts aggregator path dependencies", () => {
    const fields: Record<string, FieldConfig> = {
      raw_score: { expr: "this.score" },
      total: { sum: "result.raw_score" },
    };

    const graph = buildDependencyGraph(fields);

    // total depends on raw_score through its aggregator path
    expect(graph.edges.get("total")).toEqual(new Set(["raw_score"]));
  });
});

